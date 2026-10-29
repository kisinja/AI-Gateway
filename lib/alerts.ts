// lib/alerts.ts
import { prisma } from "./db";

// Tune these to your environment. A local reasoning model is slow, so the
// slow-response limit is generous; lower it to test the alert.
export const THRESHOLDS = {
    budgetWarnPct: 80,
    errorRatePct: 10,
    minRequests: 5, // ignore error and latency rules until a team has this many requests in the last hour
    failedAuthCount: 5,
    failedAuthWindowMin: 10,
    slowResponseMs: 120_000,
};

export type Alert = {
    id: string;
    severity: "critical" | "warn";
    title: string;
    detail: string;
};

type TeamRow = { name: string; spend: number; budget: number; pctUsed: number };

export async function getAlerts(teams: TeamRow[]): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const now = Date.now();

    for (const t of teams) {
        const used = `$${t.spend.toFixed(4)} of $${t.budget.toFixed(2)} used.`;
        if (t.pctUsed >= 100) {
            alerts.push({
                id: `budget-${t.name}`,
                severity: "critical",
                title: `${t.name} has used its full budget`,
                detail: `${used} New requests from this team are blocked.`,
            });
        } else if (t.pctUsed >= THRESHOLDS.budgetWarnPct) {
            alerts.push({
                id: `budget-${t.name}`,
                severity: "warn",
                title: `${t.name} is at ${t.pctUsed.toFixed(0)}% of its budget`,
                detail: used,
            });
        }
    }

    const [recent, failedAuth] = await Promise.all([
        prisma.usageLog.findMany({
            where: { createdAt: { gte: new Date(now - 3_600_000) } },
            select: { status: true, latencyMs: true, team: { select: { name: true } } },
        }),
        prisma.failedAuth.count({
            where: { createdAt: { gte: new Date(now - THRESHOLDS.failedAuthWindowMin * 60_000) } },
        }),
    ]);

    const byTeam = new Map<string, { n: number; errors: number; ms: number }>();
    for (const r of recent) {
        const s = byTeam.get(r.team.name) ?? { n: 0, errors: 0, ms: 0 };
        s.n += 1;
        s.ms += r.latencyMs;
        // Budget blocks (429) already raise a budget alert, so they don't count as errors here.
        if (r.status >= 400 && r.status !== 429) s.errors += 1;
        byTeam.set(r.team.name, s);
    }

    for (const [name, s] of byTeam) {
        if (s.n < THRESHOLDS.minRequests) continue;
        const rate = (s.errors / s.n) * 100;
        if (rate > THRESHOLDS.errorRatePct) {
            alerts.push({
                id: `errors-${name}`,
                severity: "warn",
                title: `${name} is seeing failed requests`,
                detail: `${rate.toFixed(0)}% of its last ${s.n} requests in the past hour failed.`,
            });
        }
        const avg = s.ms / s.n;
        if (avg > THRESHOLDS.slowResponseMs) {
            alerts.push({
                id: `slow-${name}`,
                severity: "warn",
                title: `${name} is getting slow responses`,
                detail: `Average response over the past hour is ${(avg / 1000).toFixed(0)}s.`,
            });
        }
    }

    if (failedAuth >= THRESHOLDS.failedAuthCount) {
        alerts.push({
            id: "failed-auth",
            severity: "critical",
            title: "Repeated rejected key attempts",
            detail: `${failedAuth} requests with a missing, unknown or revoked key in the last ${THRESHOLDS.failedAuthWindowMin} minutes.`,
        });
    }

    return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}
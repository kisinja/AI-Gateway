// app/dashboard/page.tsx  (replaces your existing file)
import { Suspense } from "react";
import { connection } from "next/server";
import { getDashboardData } from "@/lib/stats";
import { isAdminToken } from "@/lib/admin";
import { getAlerts, THRESHOLDS } from "@/lib/alerts";

type Props = { searchParams: Promise<{ token?: string }> };
type Tone = "ok" | "warn" | "bad" | "idle";

const usd = (n: number, d = 4) => `$${n.toFixed(d)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const stamp = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const dotColor: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  idle: "bg-muted",
};

export default function DashboardPage({ searchParams }: Props) {
  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      <Suspense fallback={<p className="text-muted">Loading usage…</p>}>
        <Console searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Console({ searchParams }: Props) {
  await connection();
  const { token } = await searchParams;

  if (!isAdminToken(token)) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold">Gateway console</h1>
        <p className="mt-3 text-muted">
          This page needs your admin token. Add <code>?token=YOUR_ADMIN_TOKEN</code> to the address and reload.
        </p>
      </div>
    );
  }

  const { rows, totals, recent, keys } = await getDashboardData();
  const alerts = await getAlerts(rows);
  const month = new Date().toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const tone: Tone = critical ? "bad" : alerts.length ? "warn" : "ok";
  const budgetLine = alerts.length
    ? `${alerts.length} ${alerts.length === 1 ? "alert needs" : "alerts need"} attention.`
    : "All clear.";
  const healthLine = alerts.length
    ? critical
      ? `${critical} ${critical === 1 ? "is" : "are"} critical.`
      : "None are critical."
    : totals.requests === 0
      ? "No requests yet this month."
      : "Every team is within budget and requests are completing normally.";

  return (
    <>
      <header>
        <p className="text-muted">Gateway console, {month}</p>
        <h1 className="mt-4 flex items-start gap-4 text-3xl font-semibold leading-tight sm:text-5xl sm:leading-[1.1]">
          <span className={`mt-3 size-3 shrink-0 rounded-full sm:mt-5 sm:size-4 ${dotColor[tone]}`} aria-hidden />
          <span>
            {budgetLine} {healthLine}
          </span>
        </h1>
      </header>

      <Section
        title="Alerts"
        note={`Checked each time this page loads. Warnings start at ${THRESHOLDS.budgetWarnPct}% of a budget, a ${THRESHOLDS.errorRatePct}% failure rate, or ${THRESHOLDS.failedAuthCount} rejected key attempts in ${THRESHOLDS.failedAuthWindowMin} minutes.`}
      >
        {alerts.length === 0 ? (
          <Empty>No active alerts.</Empty>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-4 py-4">
                <span
                  className={`mt-2 size-2.5 shrink-0 rounded-full ${dotColor[a.severity === "critical" ? "bad" : "warn"]}`}
                  aria-hidden
                />
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-muted">{a.detail}</p>
                </div>
                <span className="ml-auto shrink-0 text-sm text-muted">
                  {a.severity === "critical" ? "Critical" : "Warning"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Budgets"
        note="Spend this month against each team's limit. The marker shows where warnings start, at 80%."
      >
        {rows.length === 0 ? (
          <Empty>No teams yet. Run the seed script to create one.</Empty>
        ) : (
          <ul className="space-y-7">
            {rows.map((r) => {
              const color = r.pctUsed >= 100 ? "bg-bad" : r.pctUsed >= 80 ? "bg-warn" : "bg-ok";
              const width = r.spend > 0 ? Math.max(Math.min(r.pctUsed, 100), 0.8) : 0;
              return (
                <li key={r.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-lg font-medium">{r.name}</span>
                    <span className="text-muted">
                      {usd(r.spend)} of ${r.budget.toFixed(2)} ({r.pctUsed.toFixed(1)}%)
                    </span>
                  </div>
                  <div
                    className="relative mt-3 h-3 rounded-full bg-line"
                    role="progressbar"
                    aria-label={`${r.name} budget used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(r.pctUsed)}
                  >
                    <div className={`fill h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
                    <span className="absolute -top-1 -bottom-1 w-px bg-muted" style={{ left: "80%" }} aria-hidden />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Activity" note="All teams, this month.">
        <dl className="grid grid-cols-2 gap-y-7 sm:grid-cols-5 sm:divide-x sm:divide-line">
          <Stat label="Requests" value={String(totals.requests)} />
          <Stat label="Spend" value={usd(totals.spend)} />
          <Stat label="Tokens" value={totals.tokens.toLocaleString()} />
          <Stat label="Failed requests" value={`${totals.errorRate.toFixed(1)}%`} />
          <Stat label="Average response" value={secs(totals.avgLatencyMs)} />
        </dl>
        {rows.length > 0 && (
          <div className="mt-10">
            <Table head={["Team", "Requests", "Failed", "Tokens in", "Tokens out", "Average response"]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 pr-6 font-medium">{r.name}</td>
                  <td className="py-3 pr-6">{r.requests}</td>
                  <td className="py-3 pr-6">{r.errors}</td>
                  <td className="py-3 pr-6">{r.inputTokens.toLocaleString()}</td>
                  <td className="py-3 pr-6">{r.outputTokens.toLocaleString()}</td>
                  <td className="py-3 pr-6">{secs(r.avgLatencyMs)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Section>

      <Section title="API keys" note="Only the start of each key is stored for display. Revoked keys stop working immediately.">
        {keys.length === 0 ? (
          <Empty>No keys yet. Create one with POST /api/admin/keys.</Empty>
        ) : (
          <Table head={["Key", "Team", "Label", "Status", "Last used"]}>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="py-3 pr-6 font-mono text-sm">{k.prefix}…</td>
                <td className="py-3 pr-6">{k.team.name}</td>
                <td className="py-3 pr-6">{k.label ?? "No label"}</td>
                <td className="py-3 pr-6">
                  <Status tone={k.status === "ACTIVE" ? "ok" : "bad"}>
                    {k.status === "ACTIVE" ? "Active" : "Revoked"}
                  </Status>
                </td>
                <td className="py-3 pr-6">{k.lastUsedAt ? stamp(k.lastUsedAt) : "Never"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Recent requests" note="The latest 10. Times are UTC.">
        {recent.length === 0 ? (
          <Empty>No requests yet. Send one to /api/v1/chat/completions and it will appear here.</Empty>
        ) : (
          <Table head={["Time", "Team", "Key", "Model", "Tokens", "Cost", "Response", "Result"]}>
            {recent.map((r) => (
              <tr key={r.id}>
                <td className="py-3 pr-6 whitespace-nowrap">{stamp(r.createdAt)}</td>
                <td className="py-3 pr-6">{r.team.name}</td>
                <td className="py-3 pr-6 font-mono text-sm">{r.key.prefix}…</td>
                <td className="py-3 pr-6">{r.model}</td>
                <td className="py-3 pr-6">{(r.inputTokens + r.outputTokens).toLocaleString()}</td>
                <td className="py-3 pr-6">{usd(Number(r.costUsd), 6)}</td>
                <td className="py-3 pr-6">{secs(r.latencyMs)}</td>
                <td className="py-3 pr-6">
                  <Status tone={r.status >= 400 ? "bad" : "ok"}>{r.status}</Status>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="text-xl font-semibold">{title}</h2>
      {note && <p className="mt-1 mb-7 max-w-prose text-muted">{note}</p>}
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:px-6 sm:first:pl-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-2 rounded-full ${dotColor[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-6 text-muted">{children}</p>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="pb-3 pr-6 font-normal text-muted whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
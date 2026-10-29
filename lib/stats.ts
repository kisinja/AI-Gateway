// lib/stats.ts
import { prisma } from "./db";

export async function getDashboardData() {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const where = { createdAt: { gte: start } };

  const [teams, usage, errors, recent, keys] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: "asc" } }),
    prisma.usageLog.groupBy({
      by: ["teamId"],
      where,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      _count: { _all: true },
      _avg: { latencyMs: true },
    }),
    prisma.usageLog.groupBy({
      by: ["teamId"],
      where: { ...where, status: { gte: 400 } },
      _count: { _all: true },
    }),
    prisma.usageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        team: { select: { name: true } },
        key: { select: { prefix: true } },
      },
    }),
    prisma.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      include: { team: { select: { name: true } } },
    }),
  ]);

  const rows = teams.map((t) => {
    const u = usage.find((x) => x.teamId === t.id);
    const e = errors.find((x) => x.teamId === t.id);
    const requests = u?._count._all ?? 0;
    const errorCount = e?._count._all ?? 0;
    const spend = Number(u?._sum.costUsd ?? 0);
    const budget = Number(t.monthlyBudgetUsd);
    return {
      id: t.id,
      name: t.name,
      budget,
      spend,
      pctUsed: budget > 0 ? (spend / budget) * 100 : 0,
      requests,
      errors: errorCount,
      errorRate: requests ? (errorCount / requests) * 100 : 0,
      inputTokens: u?._sum.inputTokens ?? 0,
      outputTokens: u?._sum.outputTokens ?? 0,
      avgLatencyMs: Math.round(u?._avg.latencyMs ?? 0),
    };
  });

  const requests = rows.reduce((s, r) => s + r.requests, 0);
  const errorCount = rows.reduce((s, r) => s + r.errors, 0);
  const totals = {
    requests,
    spend: rows.reduce((s, r) => s + r.spend, 0),
    tokens: rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0),
    errorRate: requests ? (errorCount / requests) * 100 : 0,
    avgLatencyMs: requests
      ? Math.round(rows.reduce((s, r) => s + r.avgLatencyMs * r.requests, 0) / requests)
      : 0,
  };

  return { rows, totals, recent, keys };
}
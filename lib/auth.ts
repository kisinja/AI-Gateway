import { prisma } from "./db";
import { hashKey } from "./keys";

export async function authenticate(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : req.headers.get("x-api-key");
  if (!key) return null;

  const record = await prisma.apiKey.findUnique({
    where: { hash: hashKey(key) },
    include: { team: true },
  });
  if (!record || record.status !== "ACTIVE") return null;
  return record;
}

export async function monthlySpendUsd(teamId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const agg = await prisma.usageLog.aggregate({
    _sum: { costUsd: true },
    where: { teamId, createdAt: { gte: start } },
  });
  return Number(agg._sum.costUsd ?? 0);
}
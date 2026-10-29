/* eslint-disable @typescript-eslint/no-explicit-any */
// scripts/test-alerts.ts
// Usage: npm run test:alerts -- <badkeys | errors | budget | restore | clean | all>
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { prisma } from "../lib/db";
import { hashKey } from "../lib/keys";

try {
  (process as any).loadEnvFile?.(); // reads TEST_KEY from .env (Node 20.12+)
} catch {}

const BASE = process.env.GATEWAY_URL ?? "http://localhost:3000";
const MODEL = process.env.TEST_MODEL ?? "qwen3.5:2b";
const STATE = ".test-alerts-state.json";

async function send(key: string, model: string, extra: object = {}) {
  const res = await fetch(`${BASE}/api/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Say hi" }], ...extra }),
  });
  await res.text();
  return res.status;
}

async function burst(label: string, n: number, key: string, model: string) {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) codes.push(await send(key, model));
  console.log(`${label}: ${codes.join(" ")}`);
}

async function badkeys() {
  await burst("rejected keys (expect 401s)", 6, "gw_not_a_real_key", MODEL);
}

async function errors(key: string) {
  await burst("unknown model (expect errors)", 6, key, "nope");
}

// Lowers the team's budget and raises the model price so one request blows past the budget.
// Leaves that state in place so you can see the alert; run "restore" afterwards.
async function budget(key: string) {
  if (existsSync(STATE)) throw new Error("A budget test is already active. Run 'restore' first.");
  const rec = await prisma.apiKey.findUnique({ where: { hash: hashKey(key) }, include: { team: true } });
  if (!rec) throw new Error("TEST_KEY does not match any key");
  const price = await prisma.modelPrice.findUnique({ where: { model: MODEL } });
  if (!price) throw new Error(`No price row for ${MODEL}. Run the seed script first.`);

  writeFileSync(
    STATE,
    JSON.stringify({
      teamId: rec.teamId,
      budget: rec.team.monthlyBudgetUsd.toString(),
      model: MODEL,
      inputPerMTok: price.inputPerMTok.toString(),
      outputPerMTok: price.outputPerMTok.toString(),
      startedAt: new Date().toISOString(),
    })
  );
  await prisma.team.update({ where: { id: rec.teamId }, data: { monthlyBudgetUsd: 0.01 } });
  await prisma.modelPrice.update({ where: { model: MODEL }, data: { outputPerMTok: 1000 } });

  console.log("budget: sending one real request (can take a while with a local model)...");
  console.log("budget: status", await send(key, MODEL, { max_tokens: 100, reasoning_effort: "none" }));
  console.log("budget: alert is live. Run 'restore' when you're done looking.");
}

async function restore() {
  if (!existsSync(STATE)) return console.log("restore: nothing to restore");
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  await prisma.team.update({ where: { id: s.teamId }, data: { monthlyBudgetUsd: s.budget } });
  await prisma.modelPrice.update({ where: { model: s.model }, data: { outputPerMTok: s.outputPerMTok } });

  // Re-price requests made during the test so they don't distort real spend.
  const rows = await prisma.usageLog.findMany({
    where: { teamId: s.teamId, createdAt: { gte: new Date(s.startedAt) }, status: 200 },
  });
  for (const r of rows) {
    const cost = (r.inputTokens * Number(s.inputPerMTok) + r.outputTokens * Number(s.outputPerMTok)) / 1e6;
    await prisma.usageLog.update({ where: { id: r.id }, data: { costUsd: cost } });
  }
  unlinkSync(STATE);
  console.log("restore: budget and price put back");
}

async function clean() {
  const a = await prisma.failedAuth.deleteMany({});
  const b = await prisma.usageLog.deleteMany({ where: { model: "nope" } });
  console.log(`clean: removed ${a.count} rejected-key records and ${b.count} test requests`);
}

async function main() {
  const cmd = process.argv[2];
  const key = process.env.TEST_KEY ?? "";
  const needsKey = ["errors", "budget", "all"].includes(cmd);
  if (needsKey && !key) throw new Error('Set TEST_KEY="gw_..." in .env (any active gateway key)');

  if (cmd === "badkeys") await badkeys();
  else if (cmd === "errors") await errors(key);
  else if (cmd === "budget") await budget(key);
  else if (cmd === "restore") await restore();
  else if (cmd === "clean") await clean();
  else if (cmd === "all") {
    await badkeys();
    await errors(key);
    await budget(key);
  } else {
    console.log("Usage: npm run test:alerts -- <badkeys | errors | budget | restore | clean | all>");
    return;
  }
  console.log("Done. Reload /dashboard to see the alerts.");
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
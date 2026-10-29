import { prisma } from "../lib/db";
import { generateKey } from "../lib/keys";

async function main() {
  // Notional prices (USD per million tokens) so the dashboard has numbers to show.
  await prisma.modelPrice.upsert({
    where: { model: "qwen3.5:2b" },
    update: {},
    create: { model: "qwen3.5:2b", inputPerMTok: 0.1, outputPerMTok: 0.3 },
  });

  const team = await prisma.team.upsert({
    where: { name: "demo-team" },
    update: {},
    create: { name: "demo-team", monthlyBudgetUsd: 5 },
  });

  const { key, prefix, hash } = generateKey();
  const record = await prisma.apiKey.create({
    data: { teamId: team.id, prefix, hash, label: "seed key" },
  });
  await prisma.auditLog.create({
    data: {
      actor: "seed-script",
      action: "KEY_CREATED",
      targetType: "ApiKey",
      targetId: record.id,
    },
  });

  console.log("\nGateway key (shown once, save it now):\n" + key + "\n");
}

main().finally(() => prisma.$disconnect());
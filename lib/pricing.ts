import { prisma } from "./db";

export async function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<number> {
  const price = await prisma.modelPrice.findUnique({ where: { model } });
  if (!price) return 0;
  return (
    (inputTokens * Number(price.inputPerMTok) +
      outputTokens * Number(price.outputPerMTok)) /
    1_000_000
  );
}
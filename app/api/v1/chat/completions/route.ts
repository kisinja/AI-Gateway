/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/v1/chat/completions/route.ts  (replaces your existing file)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticate, monthlySpendUsd } from "@/lib/auth";
import { computeCostUsd } from "@/lib/pricing";
import { callProvider } from "@/lib/providers";

function err(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(req: Request) {
  const started = Date.now();

  const key = await authenticate(req);
  if (!key) {
    const hadKey = req.headers.get("authorization") || req.headers.get("x-api-key");
    await prisma.failedAuth
      .create({
        data: {
          reason: hadKey ? "unknown_or_revoked_key" : "missing_key",
          ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        },
      })
      .catch(() => { });
    return err(401, "Invalid or revoked API key");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err(400, "Body must be valid JSON");
  }
  if (!body?.model) return err(400, "Missing 'model'");
  if (body.stream) return err(400, "Streaming is not supported yet");

  const log = (data: {
    provider: string;
    status: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    error?: string;
  }) =>
    prisma.usageLog.create({
      data: {
        teamId: key.teamId,
        keyId: key.id,
        model: body.model,
        latencyMs: Date.now() - started,
        ...data,
      },
    });

  // Budget check happens before the call, so one request can slightly overshoot.
  const spent = await monthlySpendUsd(key.teamId);
  if (spent >= Number(key.team.monthlyBudgetUsd)) {
    await log({
      provider: process.env.PROVIDER ?? "ollama",
      status: 429,
      error: "Monthly budget exceeded",
    });
    return err(429, "Monthly budget exceeded for this team");
  }

  let result;
  try {
    result = await callProvider(body);
  } catch {
    await log({ provider: process.env.PROVIDER ?? "ollama", status: 502, error: "Upstream unreachable" });
    return err(502, "Could not reach the model provider (is Ollama running?)");
  }

  const costUsd =
    result.status >= 200 && result.status < 300
      ? await computeCostUsd(body.model, result.inputTokens, result.outputTokens)
      : 0;

  await log({
    provider: result.provider,
    status: result.status,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd,
    error: result.errorMessage,
  });
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => { });

  return new NextResponse(result.text, {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}
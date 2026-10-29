/* eslint-disable @typescript-eslint/no-explicit-any */
// mcp/server.ts
// Read-only MCP server for the AI gateway. Runs over stdio.
// IMPORTANT: never console.log here (stdout carries the protocol). Use console.error.
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

async function main() {
  // Load .env by absolute path so this works no matter where the client launches it from.
  try {
    process.loadEnvFile(path.resolve(__dirname, "../.env"));
  } catch {}

  const { prisma } = await import("../lib/db");
  const { getDashboardData } = await import("../lib/stats");
  const { getAlerts } = await import("../lib/alerts");

  const server = new McpServer({ name: "ai-gateway", version: "0.1.0" });

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });
  const fail = (message: string) => ({
    isError: true,
    content: [{ type: "text" as const, text: message }],
  });

  // Every tool call is written to the same audit log the admin routes use.
  async function audit(tool: string, args: unknown) {
    try {
      await prisma.auditLog.create({
        data: {
          actor: "mcp",
          action: "MCP_TOOL_CALLED",
          targetType: "Tool",
          targetId: tool,
          meta: JSON.parse(JSON.stringify(args ?? {})),
        },
      });
    } catch (e) {
      console.error("Could not write audit log", e);
    }
  }

  const safe =
    <A>(tool: string, fn: (args: A) => Promise<any>) =>
    async (args: A) => {
      try {
        await audit(tool, args);
        return await fn(args);
      } catch (e) {
        console.error(`${tool} failed`, e);
        return fail("The tool failed. Check the MCP server logs.");
      }
    };

  server.registerTool(
    "get_usage_summary",
    {
      title: "Usage summary",
      description:
        "Spend, requests, tokens, failure rate and average latency for the current calendar month (UTC), per team. Read-only.",
      inputSchema: {
        team: z.string().optional().describe("Team name to filter by. Omit for all teams."),
      },
      annotations: { readOnlyHint: true },
    },
    safe("get_usage_summary", async ({ team }: { team?: string }) => {
      const { rows, totals } = await getDashboardData();
      const teams = team ? rows.filter((r) => r.name === team) : rows;
      if (team && teams.length === 0) return fail(`No team named "${team}".`);
      return ok({
        totals: team
          ? undefined
          : {
              requests: totals.requests,
              spend_usd: totals.spend,
              tokens: totals.tokens,
              failure_rate_percent: Number(totals.errorRate.toFixed(1)),
              avg_latency_ms: totals.avgLatencyMs,
            },
        teams: teams.map((r) => ({
          team: r.name,
          spend_usd: r.spend,
          budget_usd: r.budget,
          percent_of_budget_used: Number(r.pctUsed.toFixed(1)),
          requests: r.requests,
          failed_requests: r.errors,
          input_tokens: r.inputTokens,
          output_tokens: r.outputTokens,
          avg_latency_ms: r.avgLatencyMs,
        })),
      });
    })
  );

  server.registerTool(
    "list_alerts",
    {
      title: "Active alerts",
      description:
        "Active alerts: teams near or over budget, elevated failure rates, slow responses, and repeated rejected key attempts. Read-only.",
      inputSchema: {
        min_severity: z.enum(["warn", "critical"]).optional().describe("Only return alerts at or above this severity."),
      },
      annotations: { readOnlyHint: true },
    },
    safe("list_alerts", async ({ min_severity }: { min_severity?: "warn" | "critical" }) => {
      const { rows } = await getDashboardData();
      let alerts = await getAlerts(rows);
      if (min_severity === "critical") alerts = alerts.filter((a) => a.severity === "critical");
      return ok({ count: alerts.length, alerts });
    })
  );

  server.registerTool(
    "list_keys",
    {
      title: "API keys",
      description:
        "Gateway API keys with team, label, status and last-used time. Never returns key secrets or hashes. Read-only.",
      inputSchema: {
        team: z.string().optional().describe("Team name to filter by."),
        status: z.enum(["ACTIVE", "REVOKED"]).optional().describe("Filter by key status."),
      },
      annotations: { readOnlyHint: true },
    },
    safe("list_keys", async ({ team, status }: { team?: string; status?: "ACTIVE" | "REVOKED" }) => {
      const keys = await prisma.apiKey.findMany({
        where: { ...(status ? { status } : {}), ...(team ? { team: { name: team } } : {}) },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          prefix: true,
          label: true,
          status: true,
          createdAt: true,
          revokedAt: true,
          lastUsedAt: true,
          team: { select: { name: true } },
        },
      });
      return ok(keys.map((k) => ({ ...k, team: k.team.name })));
    })
  );

  server.registerTool(
    "get_recent_requests",
    {
      title: "Recent requests",
      description: "The most recent logged gateway requests, newest first. Read-only.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe("How many to return (1-50, default 10)."),
        failed_only: z.boolean().optional().describe("Only return requests that failed (HTTP status 400 or above)."),
      },
      annotations: { readOnlyHint: true },
    },
    safe("get_recent_requests", async ({ limit, failed_only }: { limit?: number; failed_only?: boolean }) => {
      const rows = await prisma.usageLog.findMany({
        where: failed_only ? { status: { gte: 400 } } : {},
        orderBy: { createdAt: "desc" },
        take: limit ?? 10,
        select: {
          createdAt: true,
          model: true,
          status: true,
          inputTokens: true,
          outputTokens: true,
          costUsd: true,
          latencyMs: true,
          error: true,
          team: { select: { name: true } },
          key: { select: { prefix: true } },
        },
      });
      return ok(
        rows.map((r) => ({
          time: r.createdAt,
          team: r.team.name,
          key_prefix: r.key.prefix,
          model: r.model,
          status: r.status,
          tokens: r.inputTokens + r.outputTokens,
          cost_usd: Number(r.costUsd),
          latency_ms: r.latencyMs,
          error: r.error,
        }))
      );
    })
  );

  await server.connect(new StdioServerTransport());
  console.error("ai-gateway MCP server running on stdio");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/admin/keys/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { generateKey } from "@/lib/keys";

function err(status: number, message: string) {
    return NextResponse.json({ error: { message } }, { status });
}

// Create a key for a team. The raw key is returned once and never stored.
export async function POST(req: Request) {
    if (!isAdmin(req)) return err(401, "Unauthorized");

    let body: any;
    try {
        body = await req.json();
    } catch {
        return err(400, "Body must be valid JSON");
    }

    const team = await prisma.team.findUnique({
        where: { name: String(body?.teamName ?? "") },
    });
    if (!team) return err(404, "Team not found");

    const label = typeof body?.label === "string" ? body.label : null;
    const { key, prefix, hash } = generateKey();

    const record = await prisma.apiKey.create({
        data: { teamId: team.id, prefix, hash, label },
    });
    await prisma.auditLog.create({
        data: {
            actor: "admin",
            action: "KEY_CREATED",
            targetType: "ApiKey",
            targetId: record.id,
            meta: { team: team.name, label, prefix },
        },
    });

    return NextResponse.json(
        {
            id: record.id,
            key,
            prefix,
            team: team.name,
            note: "Store this key now. It cannot be shown again.",
        },
        { status: 201 }
    );
}

// List keys (never returns hashes or raw keys).
export async function GET(req: Request) {
    if (!isAdmin(req)) return err(401, "Unauthorized");

    const keys = await prisma.apiKey.findMany({
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
    return NextResponse.json({ keys });
}
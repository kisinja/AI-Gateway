// app/api/admin/keys/[id]/revoke/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

function err(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) return err(401, "Unauthorized");

  const { id } = await params;
  const key = await prisma.apiKey.findUnique({
    where: { id },
    include: { team: true },
  });
  if (!key) return err(404, "Key not found");
  if (key.status === "REVOKED") return err(409, "Key is already revoked");

  await prisma.apiKey.update({
    where: { id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      actor: "admin",
      action: "KEY_REVOKED",
      targetType: "ApiKey",
      targetId: id,
      meta: { team: key.team.name, prefix: key.prefix },
    },
  });

  return NextResponse.json({ id, status: "REVOKED" });
}
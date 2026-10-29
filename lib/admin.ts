// lib/admin.ts  (replaces your existing file)
import { timingSafeEqual } from "crypto";

export function isAdminToken(given: string | null | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Admin API routes: expects "Authorization: Bearer <ADMIN_TOKEN>"
export function isAdmin(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return isAdminToken(auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
}
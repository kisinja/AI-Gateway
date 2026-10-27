import { createHash, randomBytes } from "crypto";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateKey() {
  const key = `gw_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 11), hash: hashKey(key) };
}
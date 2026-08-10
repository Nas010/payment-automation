import { randomBytes } from "node:crypto";

export function createPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

import { createHash, randomBytes } from "node:crypto";
import { decryptPrivateValue, encryptPrivateValue } from "@/lib/secrets/crypto";

export const LINE_CONNECTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function tokenContext(clientId: string): string {
  return `line-connection:${clientId}`;
}

export function createLineConnectionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashLineConnectionToken(token: string): string {
  if (!LINE_CONNECTION_TOKEN_PATTERN.test(token)) throw new Error("LINE connection token is malformed");
  return createHash("sha256").update(token).digest("hex");
}

export function lineConnectionExpiresAt(now: Date | string): string {
  const expiry = new Date(now);
  expiry.setUTCDate(expiry.getUTCDate() + 7);
  return expiry.toISOString();
}

export function createLineConnectionTokenFields({ clientId, now, tokenGenerator = createLineConnectionToken }: { clientId: string; now: Date | string; tokenGenerator?: () => string }): {
  line_link_token_hash: string;
  line_link_token_encrypted: string;
  line_link_token_expires_at: string;
  line_link_status: "LINK_ACTIVE";
} {
  const token = tokenGenerator();
  const tokenHash = hashLineConnectionToken(token);
  return {
    line_link_token_hash: tokenHash,
    line_link_token_encrypted: encryptPrivateValue({ context: tokenContext(clientId), plaintext: token }),
    line_link_token_expires_at: lineConnectionExpiresAt(now),
    line_link_status: "LINK_ACTIVE",
  };
}

export function recoverLineConnectionToken({ clientId, encryptedToken }: { clientId: string; encryptedToken: string }): string {
  const token = decryptPrivateValue({ context: tokenContext(clientId), encrypted: encryptedToken });
  hashLineConnectionToken(token);
  return token;
}

export function buildLineConnectUrl({ liffId, token }: { liffId: string; token: string }): string {
  if (!/^\d{5,}-[A-Za-z0-9]+$/.test(liffId)) throw new Error("LINE LIFF ID is malformed");
  hashLineConnectionToken(token);
  const url = new URL(`https://liff.line.me/${liffId}`);
  url.searchParams.set("token", token);
  return url.toString();
}

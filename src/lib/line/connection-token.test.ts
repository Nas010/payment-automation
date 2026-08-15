import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLineConnectUrl,
  createLineConnectionToken,
  createLineConnectionTokenFields,
  hashLineConnectionToken,
  recoverLineConnectionToken,
} from "./connection-token";

const encryptionKey = Buffer.alloc(32, 9).toString("base64");
const now = "2026-08-10T12:00:00.000Z";

afterEach(() => vi.unstubAllEnvs());

describe("LINE connection tokens", () => {
  it("creates 256-bit URL-safe tokens and stable one-way hashes", () => {
    const first = createLineConnectionToken();
    const second = createLineConnectionToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(second).not.toBe(first);
    expect(hashLineConnectionToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashLineConnectionToken(first)).toBe(hashLineConnectionToken(first));
  });

  it("stores only hash plus encrypted recoverable token with seven-day expiry", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
    const rawToken = "A".repeat(43);
    const fields = createLineConnectionTokenFields({ clientId: "client_1", now, tokenGenerator: () => rawToken });

    expect(fields).toMatchObject({
      line_link_token_hash: hashLineConnectionToken(rawToken),
      line_link_token_expires_at: "2026-08-17T12:00:00.000Z",
      line_link_status: "LINK_ACTIVE",
    });
    expect(JSON.stringify(fields)).not.toContain(rawToken);
    expect(recoverLineConnectionToken({ clientId: "client_1", encryptedToken: fields.line_link_token_encrypted })).toBe(rawToken);
    expect(() => recoverLineConnectionToken({ clientId: "client_2", encryptedToken: fields.line_link_token_encrypted })).toThrow(/authentication failed/i);
  });

  it("builds LIFF permanent link without client identity in URL", () => {
    const url = buildLineConnectUrl({ liffId: "1234567890-AbCdEf", token: "A".repeat(43) });

    expect(url).toBe(`https://liff.line.me/1234567890-AbCdEf?token=${"A".repeat(43)}`);
    expect(url).not.toContain("client_1");
  });
});

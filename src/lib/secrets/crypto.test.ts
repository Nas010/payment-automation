import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe("integration secret encryption", () => {
  it("round-trips AES-256-GCM records with a fresh IV for every write", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
    const input = { keyName: "line_channel_access_token", plaintext: "token-value" };

    const first = encryptSecret(input);
    const second = encryptSecret(input);

    expect(decryptSecret({ keyName: input.keyName, record: first })).toBe(input.plaintext);
    expect(first.iv).not.toBe(second.iv);
    expect(Buffer.from(first.iv, "base64")).toHaveLength(12);
    expect(first).toMatchObject({ algorithm: "aes-256-gcm", keyVersion: "1" });
  });

  it("fails closed when a record is swapped to another secret name", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
    const record = encryptSecret({ keyName: "line_channel_access_token", plaintext: "token-value" });

    expect(() => decryptSecret({ keyName: "line_channel_secret", record })).toThrow("Secret record authentication failed");
  });

  it("fails closed when GCM authentication data is corrupted", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
    const record = encryptSecret({ keyName: "line_channel_access_token", plaintext: "token-value" });
    const tag = Buffer.from(record.authTag, "base64");
    tag[0] ^= 0xff;

    expect(() => decryptSecret({ keyName: "line_channel_access_token", record: { ...record, authTag: tag.toString("base64") } })).toThrow("Secret record authentication failed");
  });

  it("rejects a key that does not decode to exactly 32 bytes", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", Buffer.alloc(31).toString("base64"));

    expect(() => encryptSecret({ keyName: "line_channel_access_token", plaintext: "token-value" })).toThrow("SETTINGS_ENCRYPTION_KEY must be base64-encoded 32 bytes");
  });

  it("can encrypt Drive connection payloads without storing token suffix metadata", () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
    const plaintext = JSON.stringify({ refreshToken: "refresh-secret", accountEmail: "coach@example.com", folderId: "folder-12345", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" });

    const record = encryptSecret({ keyName: "google_drive_connection", plaintext, exposeLastFour: false });

    expect(record.lastFour).toBe("");
    expect(decryptSecret({ keyName: "google_drive_connection", record })).toBe(plaintext);
  });
});

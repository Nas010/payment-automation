import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendAudit, getSecretRecord, listSecretMetadata, upsertSecretRecord } = vi.hoisted(() => ({ appendAudit: vi.fn(), getSecretRecord: vi.fn(), listSecretMetadata: vi.fn(), upsertSecretRecord: vi.fn() }));

vi.mock("./repository", () => ({ getSecretRecord, listSecretMetadata, upsertSecretRecord }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit }));

import { getLineChannelAccessToken, getLineCredentials, getSecret, setSecret } from "./service";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const validAccessToken = "line-access-token-value-1234567890";
const validChannelSecret = "A".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
  getSecretRecord.mockResolvedValue(null);
  upsertSecretRecord.mockResolvedValue(undefined);
});

describe("secret service", () => {
  it("uses an encrypted value before a legacy environment fallback", async () => {
    await setSecret({ keyName: "line_channel_access_token", plaintext: validAccessToken });
    getSecretRecord.mockResolvedValueOnce(upsertSecretRecord.mock.calls[0][0]);

    await expect(getLineChannelAccessToken({ LINE_CHANNEL_ACCESS_TOKEN: "legacy-token-value-1234567890" })).resolves.toBe(validAccessToken);
  });

  it("falls back to legacy LINE values only when encrypted records are absent", async () => {
    await expect(getLineCredentials({ LINE_CHANNEL_ACCESS_TOKEN: validAccessToken, LINE_CHANNEL_SECRET: validChannelSecret })).resolves.toEqual({ channelAccessToken: validAccessToken, channelSecret: validChannelSecret });
  });

  it("keeps an existing encrypted secret when only the other value is replaced", async () => {
    await setSecret({ keyName: "line_channel_access_token", plaintext: validAccessToken });

    expect(upsertSecretRecord).toHaveBeenCalledTimes(1);
    const persisted = upsertSecretRecord.mock.calls[0][0];
    expect(persisted).toMatchObject({ keyName: "line_channel_access_token", algorithm: "aes-256-gcm" });
    expect(persisted).not.toHaveProperty("plaintext");
    expect(JSON.stringify(persisted)).not.toContain(validAccessToken);
    expect(JSON.stringify(persisted)).not.toContain(encryptionKey);
  });

  it("audits only a secret key name after storing a replacement", async () => {
    await setSecret({ keyName: "line_channel_access_token", plaintext: validAccessToken });

    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "INTEGRATION_SECRET_UPDATED", metadata: JSON.stringify({ keyName: "line_channel_access_token" }) }));
    expect(JSON.stringify(appendAudit.mock.calls)).not.toContain(validAccessToken);
  });

  it("does not race first-time credential record reads", async () => {
    let releaseRead: (() => void) | undefined;
    const readReady = new Promise<void>((resolve) => { releaseRead = resolve; });
    getSecretRecord.mockImplementation(async () => {
      await readReady;
      return null;
    });

    const credentials = getLineCredentials({ LINE_CHANNEL_ACCESS_TOKEN: validAccessToken, LINE_CHANNEL_SECRET: validChannelSecret });
    await Promise.resolve();
    expect(getSecretRecord).toHaveBeenCalledTimes(1);
    releaseRead?.();
    await expect(credentials).resolves.toEqual({ channelAccessToken: validAccessToken, channelSecret: validChannelSecret });
  });

  it("rejects malformed credentials before storage or resolution", async () => {
    await expect(setSecret({ keyName: "line_channel_access_token", plaintext: "short" })).rejects.toThrow("LINE channel access token is malformed");
    await expect(setSecret({ keyName: "line_channel_secret", plaintext: "A".repeat(31) })).rejects.toThrow("LINE channel secret is malformed");
    await expect(getLineCredentials({ LINE_CHANNEL_ACCESS_TOKEN: `${validAccessToken}\n`, LINE_CHANNEL_SECRET: validChannelSecret })).rejects.toThrow("LINE channel access token is malformed");
    expect(upsertSecretRecord).not.toHaveBeenCalled();
  });

  it("rejects a corrupted encrypted credential instead of using legacy fallback", async () => {
    await setSecret({ keyName: "line_channel_access_token", plaintext: validAccessToken });
    const persisted = upsertSecretRecord.mock.calls[0][0];
    getSecretRecord.mockResolvedValueOnce({ ...persisted, authTag: "corrupted-tag" });

    await expect(getLineChannelAccessToken({ LINE_CHANNEL_ACCESS_TOKEN: "legacy-token-value-1234567890" })).rejects.toThrow("Secret record authentication failed");
  });

  it("fails clearly when a requested credential is absent", async () => {
    await expect(getSecret("line_channel_secret")).resolves.toBeNull();
    await expect(getLineCredentials({})).rejects.toThrow("LINE channel access token is not configured");
  });
});

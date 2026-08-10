import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendAudit, getSecretRecord, listSecretMetadata, upsertSecretRecord } = vi.hoisted(() => ({ appendAudit: vi.fn(), getSecretRecord: vi.fn(), listSecretMetadata: vi.fn(), upsertSecretRecord: vi.fn() }));

vi.mock("./repository", () => ({ getSecretRecord, listSecretMetadata, upsertSecretRecord }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit }));

import { getLineChannelAccessToken, getLineCredentials, getSecret, setSecret } from "./service";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", encryptionKey);
  getSecretRecord.mockResolvedValue(null);
  upsertSecretRecord.mockResolvedValue(undefined);
});

describe("secret service", () => {
  it("uses an encrypted value before a legacy environment fallback", async () => {
    await setSecret({ keyName: "line_channel_access_token", plaintext: "encrypted-token" });
    getSecretRecord.mockResolvedValueOnce(upsertSecretRecord.mock.calls[0][0]);

    await expect(getLineChannelAccessToken({ LINE_CHANNEL_ACCESS_TOKEN: "legacy-token" })).resolves.toBe("encrypted-token");
  });

  it("falls back to legacy LINE values only when encrypted records are absent", async () => {
    await expect(getLineCredentials({ LINE_CHANNEL_ACCESS_TOKEN: "legacy-token", LINE_CHANNEL_SECRET: "legacy-secret" })).resolves.toEqual({ channelAccessToken: "legacy-token", channelSecret: "legacy-secret" });
  });

  it("keeps an existing encrypted secret when only the other value is replaced", async () => {
    await setSecret({ keyName: "line_channel_access_token", plaintext: "new-token" });

    expect(upsertSecretRecord).toHaveBeenCalledTimes(1);
    expect(upsertSecretRecord).toHaveBeenCalledWith(expect.objectContaining({ keyName: "line_channel_access_token" }));
  });

  it("audits only a secret key name after storing a replacement", async () => {
    await setSecret({ keyName: "line_channel_access_token", plaintext: "encrypted-token" });

    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "INTEGRATION_SECRET_UPDATED", metadata: JSON.stringify({ keyName: "line_channel_access_token" }) }));
    expect(JSON.stringify(appendAudit.mock.calls)).not.toContain("encrypted-token");
  });

  it("fails clearly when a requested credential is absent", async () => {
    await expect(getSecret("line_channel_secret")).resolves.toBeNull();
    await expect(getLineCredentials({})).rejects.toThrow("LINE channel access token is not configured");
  });
});

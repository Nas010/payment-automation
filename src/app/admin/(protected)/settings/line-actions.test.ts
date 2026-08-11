import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), setSecret: vi.fn(), getLineChannelAccessToken: vi.fn(), upsertOperationalSetting: vi.fn(), revalidatePath: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/secrets/service", () => ({ setSecret: mocks.setSecret, getLineChannelAccessToken: mocks.getLineChannelAccessToken }));
vi.mock("@/lib/sheets/settings", () => ({ upsertOperationalSetting: mocks.upsertOperationalSetting }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveAndTestLineCredentialsAction } from "./line-actions";

const accessToken = "line-access-token-value-1234567890";
const channelSecret = "A".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.setSecret.mockResolvedValue(undefined);
  mocks.getLineChannelAccessToken.mockResolvedValue(accessToken);
  mocks.upsertOperationalSetting.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("saveAndTestLineCredentialsAction", () => {
  it("stores supplied values through encrypted service, validates with bot info, and returns sanitized metadata", async () => {
    const formData = new FormData();
    formData.set("channel_access_token", accessToken);
    formData.set("channel_secret", channelSecret);

    await expect(saveAndTestLineCredentialsAction(formData)).resolves.toMatchObject({ ok: true, status: "VALID" });

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.setSecret).toHaveBeenCalledWith({ keyName: "line_channel_access_token", plaintext: accessToken });
    expect(mocks.setSecret).toHaveBeenCalledWith({ keyName: "line_channel_secret", plaintext: channelSecret });
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(mocks.upsertOperationalSetting).toHaveBeenCalledWith("line_access_token_validation", expect.stringContaining('"status":"VALID"'));
    expect(JSON.stringify(mocks.upsertOperationalSetting.mock.calls)).not.toContain(accessToken);
    expect(JSON.stringify(mocks.upsertOperationalSetting.mock.calls)).not.toContain(channelSecret);
  });

  it("leaves absent fields unchanged and records a safe failed validation status", async () => {
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 401 }));
    const result = await saveAndTestLineCredentialsAction(new FormData());

    expect(mocks.setSecret).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(result).toMatchObject({ ok: false, status: "FAILED" });
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), setSecret: vi.fn(), getLineChannelAccessToken: vi.fn(), upsertOperationalSetting: vi.fn(), appendAudit: vi.fn(), revalidatePath: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/secrets/service", () => ({ setSecret: mocks.setSecret, getLineChannelAccessToken: mocks.getLineChannelAccessToken }));
vi.mock("@/lib/sheets/settings", () => ({ upsertOperationalSetting: mocks.upsertOperationalSetting }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { previewLineDueTemplateAction, resetLineDueTemplateAction, saveAndTestLineCredentialsAction, saveLineDueTemplateAction } from "./line-actions";

const accessToken = "line-access-token-value-1234567890";
const channelSecret = "A".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.setSecret.mockResolvedValue(undefined);
  mocks.getLineChannelAccessToken.mockResolvedValue(accessToken);
  mocks.upsertOperationalSetting.mockResolvedValue(undefined);
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("LINE due-message template actions", () => {
  it("previews a validated template with safe server-side sample values", async () => {
    const formData = new FormData();
    formData.set("template", "Hi {{client_name}}. {{amount}} due {{due_date}}: {{payment_url}}");

    await expect(previewLineDueTemplateAction(formData)).resolves.toMatchObject({ ok: true, preview: "Hi Nisa. ฿1,500.00 due 2026-08-15: https://payments.example/p/sample-token" });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.upsertOperationalSetting).not.toHaveBeenCalled();
  });

  it("persists a valid template and audits only its setting key", async () => {
    const formData = new FormData();
    const template = "Pay {{amount}} by {{due_date}}: {{payment_url}}";
    formData.set("template", template);

    await expect(saveLineDueTemplateAction(formData)).resolves.toMatchObject({ ok: true });

    expect(mocks.upsertOperationalSetting).toHaveBeenCalledWith("line_due_message_template", template);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ paymentId: "", clientId: "", action: "LINE_DUE_TEMPLATE_SAVED", metadata: JSON.stringify({ settingKey: "line_due_message_template" }) }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain(template);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("rejects an invalid save before overwriting the stored template", async () => {
    const formData = new FormData();
    formData.set("template", "Pay {{amount}} on {{due_date}}");

    await expect(saveLineDueTemplateAction(formData)).rejects.toThrow(/requires placeholder/i);
    expect(mocks.upsertOperationalSetting).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("restores documented default and audits only template setting key", async () => {
    const result = await resetLineDueTemplateAction();

    expect(result.preview).toContain("https://payments.example/p/sample-token");
    expect(mocks.upsertOperationalSetting).toHaveBeenCalledWith("line_due_message_template", expect.stringContaining("{{payment_url}}"));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_DUE_TEMPLATE_RESET", metadata: JSON.stringify({ settingKey: "line_due_message_template" }) }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("{{payment_url}}");
  });
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

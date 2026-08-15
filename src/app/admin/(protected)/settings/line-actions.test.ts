import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LINE_DUE_PROFILES, DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG } from "@/lib/line/message-profile";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), setSecret: vi.fn(), getLineChannelAccessToken: vi.fn(), upsertOperationalSetting: vi.fn(), saveLineDueMessageProfile: vi.fn(), saveLineInstallmentReminderConfig: vi.fn(), appendAudit: vi.fn(), revalidatePath: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/secrets/service", () => ({ setSecret: mocks.setSecret, getLineChannelAccessToken: mocks.getLineChannelAccessToken }));
vi.mock("@/lib/sheets/settings", () => ({ upsertOperationalSetting: mocks.upsertOperationalSetting, saveLineDueMessageProfile: mocks.saveLineDueMessageProfile, saveLineInstallmentReminderConfig: mocks.saveLineInstallmentReminderConfig }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  previewLineDueMessageProfileAction,
  previewLineInstallmentReminderAction,
  previewLineWelcomeTemplateAction,
  resetLineDueMessageProfileAction,
  resetLineInstallmentReminderConfigAction,
  resetLineWelcomeTemplateAction,
  saveAndTestLineCredentialsAction,
  saveLineDueMessageProfileAction,
  saveLineInstallmentReminderConfigAction,
  saveLineWelcomeTemplateAction,
} from "./line-actions";

const accessToken = "line-access-token-value-1234567890";
const channelSecret = "A".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.setSecret.mockResolvedValue(undefined);
  mocks.getLineChannelAccessToken.mockResolvedValue(accessToken);
  mocks.upsertOperationalSetting.mockResolvedValue(undefined);
  mocks.saveLineDueMessageProfile.mockResolvedValue(undefined);
  mocks.saveLineInstallmentReminderConfig.mockResolvedValue(undefined);
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("LINE due-message profile actions", () => {
  it("previews an installment profile with safe server sample data", async () => {
    const formData = new FormData();
    formData.set("payment_type", "INSTALLMENTS");
    formData.set("profile", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS));

    await expect(previewLineDueMessageProfileAction(formData)).resolves.toMatchObject({
      ok: true,
      paymentType: "INSTALLMENTS",
      preview: expect.stringContaining("2nd payment out of 3"),
    });
    expect(mocks.saveLineDueMessageProfile).not.toHaveBeenCalled();
  });

  it("saves one profile and audits only its key and payment type", async () => {
    const formData = new FormData();
    formData.set("payment_type", "ONE_TIME");
    formData.set("profile", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME));

    await saveLineDueMessageProfileAction(formData);

    expect(mocks.saveLineDueMessageProfile).toHaveBeenCalledWith("ONE_TIME", DEFAULT_LINE_DUE_PROFILES.ONE_TIME);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "LINE_DUE_PROFILE_SAVED",
      metadata: JSON.stringify({ settingKey: "line_due_message_profile_one_time", paymentType: "ONE_TIME" }),
    }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain(DEFAULT_LINE_DUE_PROFILES.ONE_TIME.message);
  });

  it("rejects an unknown profile placeholder before persistence or audit", async () => {
    const formData = new FormData();
    formData.set("payment_type", "ONE_TIME");
    formData.set("profile", JSON.stringify({ version: 1, message: "{{bank_name}}", customPlaceholders: [] }));

    await expect(saveLineDueMessageProfileAction(formData)).rejects.toThrow(/bank_name/);
    expect(mocks.saveLineDueMessageProfile).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("resets only the selected profile to its documented default", async () => {
    const formData = new FormData();
    formData.set("payment_type", "INSTALLMENTS");

    const result = await resetLineDueMessageProfileAction(formData);

    expect(mocks.saveLineDueMessageProfile).toHaveBeenCalledWith("INSTALLMENTS", DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
    expect(result.profile).toEqual(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_DUE_PROFILE_RESET" }));
  });
});

describe("LINE installment reminder actions", () => {
  it("previews only the selected reminder profile", async () => {
    const formData = new FormData();
    formData.set("slot", "T_MINUS_3_DAYS");
    formData.set("profile", JSON.stringify({ version: 1, message: "Three-day reminder", customPlaceholders: [] }));

    await expect(previewLineInstallmentReminderAction(formData)).resolves.toMatchObject({
      ok: true,
      slot: "T_MINUS_3_DAYS",
      preview: "Three-day reminder",
    });
    expect(mocks.saveLineInstallmentReminderConfig).not.toHaveBeenCalled();
  });

  it("saves the complete reminder configuration atomically", async () => {
    const config = structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
    config.enabled.T_MINUS_3_DAYS = false;
    config.profiles.T_MINUS_7_DAYS.message = "Seven-day reminder";
    const formData = new FormData();
    formData.set("slot", "DUE_DATE");
    formData.set("config", JSON.stringify(config));

    await saveLineInstallmentReminderConfigAction(formData);

    expect(mocks.saveLineInstallmentReminderConfig).toHaveBeenCalledOnce();
    expect(mocks.saveLineInstallmentReminderConfig).toHaveBeenCalledWith(config);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "LINE_INSTALLMENT_REMINDER_CONFIG_SAVED",
      metadata: JSON.stringify({ settingKey: "line_installment_reminder_config" }),
    }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("Seven-day reminder");
  });

  it("rejects an invalid complete configuration before persistence", async () => {
    const config = structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
    config.profiles.T_PLUS_1_DAY.message = "Unknown {{payment_label}}";
    const formData = new FormData();
    formData.set("slot", "DUE_DATE");
    formData.set("config", JSON.stringify(config));

    await expect(saveLineInstallmentReminderConfigAction(formData)).rejects.toThrow(/payment_label/);
    expect(mocks.saveLineInstallmentReminderConfig).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("requires admin access before parsing a reminder preview", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(previewLineInstallmentReminderAction(new FormData())).rejects.toThrow("Unauthorized");
    expect(mocks.saveLineInstallmentReminderConfig).not.toHaveBeenCalled();
  });

  it("restores the complete documented reminder configuration", async () => {
    const result = await resetLineInstallmentReminderConfigAction();

    expect(mocks.saveLineInstallmentReminderConfig).toHaveBeenCalledWith(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
    expect(result.config).toEqual(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  });
});

describe("LINE welcome-message template actions", () => {
  it("requires admin access before previewing", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error("Unauthorized"));
    const formData = new FormData();
    formData.set("template", "Connect: {{line_connect_url}}");

    await expect(previewLineWelcomeTemplateAction(formData)).rejects.toThrow("Unauthorized");
    expect(mocks.upsertOperationalSetting).not.toHaveBeenCalled();
  });

  it("previews using safe values for all approved placeholders", async () => {
    const formData = new FormData();
    formData.set("template", "Hi {{client_name}} from {{business_name}}: {{line_connect_url}}");

    await expect(previewLineWelcomeTemplateAction(formData)).resolves.toEqual({
      ok: true,
      template: "Hi {{client_name}} from {{business_name}}: {{line_connect_url}}",
      preview: "Hi Nisa from Coach Bee: https://liff.line.me/1234567890-AbCdEf?token=sample-token",
    });
    expect(mocks.upsertOperationalSetting).not.toHaveBeenCalled();
  });

  it("saves valid template and audits only setting key", async () => {
    const formData = new FormData();
    const template = "Welcome to {{business_name}}, {{client_name}}: {{line_connect_url}}";
    formData.set("template", template);

    await expect(saveLineWelcomeTemplateAction(formData)).resolves.toMatchObject({ ok: true, preview: expect.stringContaining("Coach Bee") });
    expect(mocks.upsertOperationalSetting).toHaveBeenCalledWith("line_welcome_message_template", template);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "LINE_WELCOME_TEMPLATE_SAVED",
      metadata: JSON.stringify({ settingKey: "line_welcome_message_template" }),
    }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain(template);
  });

  it("restores default and audits reset without template contents", async () => {
    const result = await resetLineWelcomeTemplateAction();

    expect(result.preview).toContain("https://liff.line.me/1234567890-AbCdEf?token=sample-token");
    expect(mocks.upsertOperationalSetting).toHaveBeenCalledWith("line_welcome_message_template", expect.stringContaining("{{line_connect_url}}"));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "LINE_WELCOME_TEMPLATE_RESET",
      metadata: JSON.stringify({ settingKey: "line_welcome_message_template" }),
    }));
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("{{line_connect_url}}");
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

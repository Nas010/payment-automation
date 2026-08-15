import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LINE_DUE_PROFILES, DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG, LINE_DUE_PROFILE_SETTING_KEYS } from "@/lib/line/message-profile";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";
import { DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG, LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY } from "@/lib/line/reply-config";
import { LINE_TERMS_ACTIVE_VERSION_KEY, LINE_TERMS_VERSIONS_KEY, type LineTermsImageVersion } from "@/lib/line/terms-image";
import { createDefaultLineMessageTestProfile, LINE_MESSAGE_TEST_PROFILE_SETTING_KEY } from "@/lib/line/message-test-profile";

const mocks = vi.hoisted(() => ({ get: vi.fn(), batchUpdate: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get: mocks.get, batchUpdate: mocks.batchUpdate } } } }),
}));

import { getLineAutomaticReplyConfig, getLineDueMessageProfiles, getLineTermsImageState, getLineWelcomeTemplate, resolveLineDueMessageProfiles, resolveLineInstallmentReminderConfig, resolveLineMessageTestProfile, saveLineAutomaticReplyConfig, saveLineDueMessageProfile, saveLineTermsImageVersion, upsertOperationalSetting, upsertOperationalSettings } from "./settings";

const termsVersion: LineTermsImageVersion = {
  versionId: "terms_abcdefghijklmnopqrstuvwxyzABCDEF",
  publicToken: "abcdefghijklmnopqrstuvwxyzABCDEF",
  driveFileId: "drive-file-123",
  mimeType: "image/png",
  byteLength: 9,
  originalName: "terms.png",
  uploadedAt: "2026-08-15T01:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ data: { values: [["key", "value"], ["existing_key", "old"], ["other_key", "keep"]] } });
  mocks.batchUpdate.mockResolvedValue({});
});

describe("operational settings writes", () => {
  it("updates existing and new keys in one batch without touching unrelated rows", async () => {
    await upsertOperationalSettings([
      { key: "existing_key", value: "new" },
      { key: "slip_storage_folder_id", value: "folder-12345" },
    ]);

    expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet_1",
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "Settings!A2:B2", values: [["existing_key", "new"]] },
          { range: "Settings!A4:B4", values: [["slip_storage_folder_id", "folder-12345"]] },
        ],
      },
    });
  });

  it("keeps the single-setting API on the same atomic write path", async () => {
    await upsertOperationalSetting("existing_key", "new");
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ data: [{ range: "Settings!A2:B2", values: [["existing_key", "new"]] }] }) }));
  });

  it("stores one validated automatic reply object atomically", async () => {
    const config = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
    config.slip.review = "Custom review";

    await saveLineAutomaticReplyConfig(config);

    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ data: [
      expect.objectContaining({ values: [[LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, JSON.stringify(config)]] }),
    ] }) }));
  });

  it("rejects malformed automatic replies before a Sheets write", async () => {
    const invalid = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
    invalid.connection.conflict = "   ";

    await expect(upsertOperationalSetting(LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, JSON.stringify(invalid)))
      .rejects.toThrow("LINE automatic reply configuration is invalid");
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it("loads saved automatic replies and safely falls back for malformed storage or Sheets errors", async () => {
    const custom = structuredClone(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
    custom.connection.linked = "Connected custom";
    mocks.get.mockResolvedValueOnce({ data: { values: [["key", "value"], [LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, JSON.stringify(custom)]] } });
    await expect(getLineAutomaticReplyConfig()).resolves.toEqual(custom);

    mocks.get.mockResolvedValueOnce({ data: { values: [["key", "value"], [LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, "invalid"]] } });
    await expect(getLineAutomaticReplyConfig()).resolves.toEqual(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);

    mocks.get.mockRejectedValueOnce(new Error("Sheets unavailable"));
    await expect(getLineAutomaticReplyConfig()).resolves.toEqual(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG);
  });

  it("resolves stored profiles independently and uses legacy fallback only for the absent type", () => {
    const storedOneTime = { ...DEFAULT_LINE_DUE_PROFILES.ONE_TIME, message: "One {{amount}} {{due_date}} {{payment_url}}" };
    const profiles = resolveLineDueMessageProfiles([
      { rowNumber: 2, key: LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, value: JSON.stringify(storedOneTime) },
      { rowNumber: 3, key: "line_due_message_template", value: "Legacy {{payment_label}} {{amount}} {{due_date}} {{payment_url}}" },
    ]);

    expect(profiles.ONE_TIME).toEqual({ kind: "VALID", profile: storedOneTime });
    expect(profiles.INSTALLMENTS).toMatchObject({ kind: "VALID", profile: { message: expect.stringContaining("Legacy"), customPlaceholders: [{ name: "payment_label", template: "{{due_month_name}} Coaching" }] } });
  });

  it("uses existing installment profile as deadline fallback before reminder config is saved", () => {
    const resolved = resolveLineInstallmentReminderConfig([
      { rowNumber: 2, key: LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, value: JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS) },
    ]);

    expect(resolved.kind).toBe("VALID");
    if (resolved.kind === "VALID") expect(resolved.config.profiles.DUE_DATE).toEqual(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
    expect(resolved).toMatchObject({
      kind: "VALID",
      config: {
        version: 2,
        enabled: {
          T_MINUS_7_DAYS: true,
          T_MINUS_3_DAYS: true,
          T_MINUS_1_DAY: true,
          DUE_DATE: true,
          T_PLUS_1_DAY: true,
        },
      },
    });
  });

  it("normalizes stored version one reminder settings without writing", () => {
    const legacy = {
      version: 1,
      profiles: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles,
    };
    const resolved = resolveLineInstallmentReminderConfig([
      { rowNumber: 2, key: "line_installment_reminder_config", value: JSON.stringify(legacy) },
    ]);

    expect(resolved).toEqual({ kind: "VALID", config: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG });
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it("resolves missing and corrupt LINE message test profiles independently", () => {
    const fallback = createDefaultLineMessageTestProfile("2026-08-15");
    expect(resolveLineMessageTestProfile([], fallback)).toEqual({ kind: "VALID", profile: fallback });
    expect(resolveLineMessageTestProfile([
      { rowNumber: 2, key: LINE_MESSAGE_TEST_PROFILE_SETTING_KEY, value: "not JSON" },
    ], fallback)).toEqual({ kind: "INVALID" });
  });

  it("isolates a corrupt stored type while preserving the other stored profile", () => {
    const profiles = resolveLineDueMessageProfiles([
      { rowNumber: 2, key: LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, value: JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME) },
      { rowNumber: 3, key: LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, value: "not JSON" },
    ]);

    expect(profiles.ONE_TIME).toEqual({ kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME });
    expect(profiles.INSTALLMENTS).toEqual({ kind: "INVALID" });
  });

  it("loads saved profiles through operational settings", async () => {
    mocks.get.mockResolvedValue({ data: { values: [["key", "value"], [LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)]] } });

    await expect(getLineDueMessageProfiles()).resolves.toEqual({
      ONE_TIME: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME },
      INSTALLMENTS: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS },
    });
  });

  it("saves one validated profile as versioned JSON without touching the other profile", async () => {
    await saveLineDueMessageProfile("INSTALLMENTS", DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);

    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ data: [
      expect.objectContaining({ values: [[LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)]] }),
    ] }) }));
  });

  it("rejects malformed profile JSON before writing settings", async () => {
    await expect(upsertOperationalSetting(LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, "not JSON")).rejects.toThrow("invalid JSON");
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it("loads a saved welcome template and falls back to the documented default", async () => {
    const template = "Welcome {{client_name}}: {{line_connect_url}}";
    mocks.get.mockResolvedValueOnce({ data: { values: [["key", "value"], ["line_welcome_message_template", template]] } });
    await expect(getLineWelcomeTemplate()).resolves.toBe(template);

    mocks.get.mockResolvedValueOnce({ data: { values: [["key", "value"]] } });
    await expect(getLineWelcomeTemplate()).resolves.toBe(DEFAULT_LINE_WELCOME_TEMPLATE);
  });

  it("rejects a welcome template without its secure connection URL before writing", async () => {
    await expect(upsertOperationalSetting("line_welcome_message_template", "Welcome {{client_name}}"))
      .rejects.toThrow("LINE welcome template requires placeholder: line_connect_url");
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it("loads the terms image registry from operational settings", async () => {
    mocks.get.mockResolvedValue({ data: { values: [["key", "value"],
      [LINE_TERMS_ACTIVE_VERSION_KEY, termsVersion.versionId],
      [LINE_TERMS_VERSIONS_KEY, JSON.stringify([termsVersion])],
    ] } });

    await expect(getLineTermsImageState()).resolves.toEqual({ activeVersionId: termsVersion.versionId, versions: [termsVersion] });
  });

  it("stores replacement terms image metadata and preserves old versions", async () => {
    const replacement = {
      ...termsVersion,
      versionId: "terms_0123456789abcdefghijklmnopqrstuvwxyzAB",
      publicToken: "0123456789abcdefghijklmnopqrstuvwxyzAB",
      driveFileId: "drive-file-456",
      originalName: "terms-v2.png",
    };
    mocks.get.mockResolvedValue({ data: { values: [["key", "value"],
      [LINE_TERMS_ACTIVE_VERSION_KEY, termsVersion.versionId],
      [LINE_TERMS_VERSIONS_KEY, JSON.stringify([termsVersion])],
    ] } });

    await saveLineTermsImageVersion(replacement);

    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ data: [
      { range: "Settings!A2:B2", values: [[LINE_TERMS_ACTIVE_VERSION_KEY, replacement.versionId]] },
      { range: "Settings!A3:B3", values: [[LINE_TERMS_VERSIONS_KEY, JSON.stringify([termsVersion, replacement])]] },
    ] }) }));
  });
});

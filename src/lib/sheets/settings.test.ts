import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS } from "@/lib/line/message-profile";
import { DEFAULT_LINE_WELCOME_TEMPLATE } from "@/lib/line/message-template";

const mocks = vi.hoisted(() => ({ get: vi.fn(), batchUpdate: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get: mocks.get, batchUpdate: mocks.batchUpdate } } } }),
}));

import { getLineDueMessageProfiles, getLineWelcomeTemplate, resolveLineDueMessageProfiles, saveLineDueMessageProfile, upsertOperationalSetting, upsertOperationalSettings } from "./settings";

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

  it("resolves stored profiles independently and uses legacy fallback only for the absent type", () => {
    const storedOneTime = { ...DEFAULT_LINE_DUE_PROFILES.ONE_TIME, message: "One {{amount}} {{due_date}} {{payment_url}}" };
    const profiles = resolveLineDueMessageProfiles([
      { rowNumber: 2, key: LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, value: JSON.stringify(storedOneTime) },
      { rowNumber: 3, key: "line_due_message_template", value: "Legacy {{payment_label}} {{amount}} {{due_date}} {{payment_url}}" },
    ]);

    expect(profiles.ONE_TIME).toEqual({ kind: "VALID", profile: storedOneTime });
    expect(profiles.INSTALLMENTS).toMatchObject({ kind: "VALID", profile: { message: expect.stringContaining("Legacy"), customPlaceholders: [{ name: "payment_label", template: "{{due_month_name}} Coaching" }] } });
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
});

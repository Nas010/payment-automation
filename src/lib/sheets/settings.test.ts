import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS } from "@/lib/line/message-profile";

const mocks = vi.hoisted(() => ({ get: vi.fn(), batchUpdate: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get: mocks.get, batchUpdate: mocks.batchUpdate } } } }),
}));

import { getLineDueMessageProfiles, resolveLineDueMessageProfiles, saveLineDueMessageProfile, upsertOperationalSetting, upsertOperationalSettings } from "./settings";

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

    expect(profiles.ONE_TIME.message).toBe(storedOneTime.message);
    expect(profiles.INSTALLMENTS.message).toContain("Legacy");
    expect(profiles.INSTALLMENTS.customPlaceholders).toContainEqual({ name: "payment_label", template: "{{due_month_name}} Coaching" });
  });

  it("loads saved profiles through operational settings", async () => {
    mocks.get.mockResolvedValue({ data: { values: [["key", "value"], [LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)]] } });

    await expect(getLineDueMessageProfiles()).resolves.toEqual({
      ONE_TIME: DEFAULT_LINE_DUE_PROFILES.ONE_TIME,
      INSTALLMENTS: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS,
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), batchUpdate: vi.fn() }));

vi.mock("./client", () => ({
  getGoogleSheets: () => ({ spreadsheetId: "spreadsheet_1", sheets: { spreadsheets: { values: { get: mocks.get, batchUpdate: mocks.batchUpdate } } } }),
}));

import { upsertOperationalSetting, upsertOperationalSettings } from "./settings";

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
        valueInputOption: "USER_ENTERED",
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
});

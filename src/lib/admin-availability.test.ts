import { describe, expect, it } from "vitest";
import { adminWorkbookAvailability } from "./admin-availability";

describe("adminWorkbookAvailability", () => {
  it("reports exactly missing workbook configuration without attempting a Sheets request", () => {
    expect(adminWorkbookAvailability({ SPREADSHEET_ID: "sheet", GOOGLE_SERVICE_ACCOUNT_JSON: "json", PROMPTPAY_IDENTIFIER: "CONFIG_REQUIRED", RECIPIENT_NAME_EN: "receiver", SLIP_STORAGE_FOLDER_ID: "folder" })).toEqual({ available: false, missing: ["PROMPTPAY_IDENTIFIER"] });
  });

  it("reports ready only when every Sheets dependency is configured", () => {
    expect(adminWorkbookAvailability({ SPREADSHEET_ID: "sheet", GOOGLE_SERVICE_ACCOUNT_JSON: "json", PROMPTPAY_IDENTIFIER: "promptpay", RECIPIENT_NAME_EN: "receiver", SLIP_STORAGE_FOLDER_ID: "folder" })).toEqual({ available: true, missing: [] });
  });
});

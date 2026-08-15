import { describe, expect, it } from "vitest";
import { adminWorkbookAvailability } from "./admin-availability";

describe("adminWorkbookAvailability", () => {
  it("reports exactly missing workbook configuration without attempting a Sheets request", () => {
    expect(adminWorkbookAvailability({ ...completeInfrastructure(), GOOGLE_SERVICE_ACCOUNT_JSON: "CONFIG_REQUIRED" })).toEqual({ available: false, missing: ["GOOGLE_SERVICE_ACCOUNT_JSON"] });
  });

  it("reports ready only when every Sheets dependency is configured", () => {
    expect(adminWorkbookAvailability(completeInfrastructure())).toEqual({ available: true, missing: [] });
  });
});

function completeInfrastructure(): Record<string, string> {
  return { SPREADSHEET_ID: "sheet", GOOGLE_SERVICE_ACCOUNT_JSON: "{}", ADMIN_SECRET: "admin", CRON_SECRET: "cron", SETTINGS_ENCRYPTION_KEY: "key", GOOGLE_DRIVE_OAUTH_CLIENT_ID: "client", GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "secret", GOOGLE_DRIVE_PICKER_API_KEY: "picker", GOOGLE_DRIVE_PROJECT_NUMBER: "123" };
}

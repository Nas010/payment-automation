import { describe, expect, it } from "vitest";
import { configuredSlipRetentionDays, paymentLinkBaseUrl, requiredConfiguration, sheetsConfig } from "./config";

describe("requiredConfiguration", () => {
  it("reports required values without exposing their values", () => {
    expect(requiredConfiguration({})).toEqual(["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "PROMPTPAY_IDENTIFIER", "RECIPIENT_NAME_EN", "SLIP_STORAGE_FOLDER_ID"]);
  });

  it("normalizes configured receiver aliases without exposing identifiers", async () => {
    const { configuredReceiverAliases } = await import("./config");
    expect(configuredReceiverAliases({ RECIPIENT_NAME_EN: "Nas O", RECIPIENT_NAME_TH: "นัส", RECIPIENT_NAME_ALIASES: "Nasreddine Ouchene, N. Ouchene" })).toEqual(["Nas O", "นัส", "Nasreddine Ouchene", "N. Ouchene"]);
  });

  it("uses a safe, configurable exception-slip retention period", () => {
    expect(configuredSlipRetentionDays({})).toBe(30);
    expect(configuredSlipRetentionDays({ SLIP_RETENTION_DAYS: "0" })).toBe(0);
    expect(configuredSlipRetentionDays({ SLIP_RETENTION_DAYS: "invalid" })).toBe(30);
  });

  it("allows Sheets reads without payment receiver configuration", () => {
    expect(sheetsConfig({ SPREADSHEET_ID: "sheet", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" })).toEqual({ spreadsheetId: "sheet", serviceAccountJson: "{}" });
    expect(() => sheetsConfig({ SPREADSHEET_ID: "sheet" })).toThrow("GOOGLE_SERVICE_ACCOUNT_JSON");
  });

  it("uses the current request origin for payment links when no canonical URL is configured", () => {
    expect(paymentLinkBaseUrl({ PRODUCTION_BASE_URL: "" }, "http://localhost:3000")).toBe("http://localhost:3000");
  });
});

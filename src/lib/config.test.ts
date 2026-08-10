import { describe, expect, it } from "vitest";
import { configuredSlipRetentionDays, requiredConfiguration } from "./config";

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
});

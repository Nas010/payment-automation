import { describe, expect, it } from "vitest";
import { cronSecret, googleDriveConfig, googleDriveRedirectUri, requiredConfiguration, sheetsConfig } from "./config";

const infrastructure = {
  SPREADSHEET_ID: "bootstrap-sheet",
  GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
  ADMIN_SECRET: "admin-secret",
  CRON_SECRET: "cron-secret",
  SETTINGS_ENCRYPTION_KEY: "encryption-key",
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_DRIVE_PICKER_API_KEY: "picker-key",
  GOOGLE_DRIVE_PROJECT_NUMBER: "123456789",
};

describe("developer infrastructure configuration", () => {
  it("requires only bootstrap, signing, encryption, cron, and Google OAuth values", () => {
    expect(requiredConfiguration(infrastructure)).toEqual([]);
    expect(requiredConfiguration({})).toEqual(Object.keys(infrastructure));
    expect(requiredConfiguration({ PROMPTPAY_IDENTIFIER: "0812345678", RECIPIENT_NAME_EN: "Receiver" })).not.toContain("PROMPTPAY_IDENTIFIER");
  });

  it("keeps the service account restricted to bootstrap Sheets configuration", () => {
    expect(sheetsConfig(infrastructure)).toEqual({ spreadsheetId: "bootstrap-sheet", serviceAccountJson: "{}" });
    expect(() => sheetsConfig({ SPREADSHEET_ID: "sheet" })).toThrow("GOOGLE_SERVICE_ACCOUNT_JSON");
  });

  it("reads cron and OAuth infrastructure without target settings", () => {
    expect(cronSecret(infrastructure)).toBe("cron-secret");
    expect(googleDriveConfig(infrastructure)).toEqual({ clientId: "client-id", clientSecret: "client-secret", pickerApiKey: "picker-key", projectNumber: "123456789" });
    expect(googleDriveConfig({ GOOGLE_DRIVE_OAUTH_CLIENT_ID: "CONFIG_REQUIRED" })).toBeNull();
  });

  it("uses the current request origin for the existing OAuth callback", () => {
    expect(googleDriveRedirectUri("https://pay.example.com")).toBe("https://pay.example.com/admin/google-drive/callback");
  });
});

import { describe, expect, it } from "vitest";
import { configuredSlipRetentionDays, lineChatPaymentsEnabled, lineConfig, lineLinkingEnabled, lineMessagingEnabled, paymentLinkBaseUrl, requiredConfiguration, sheetsConfig } from "./config";

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

  it("keeps LINE configuration optional while exposing only server-side values", () => {
    expect(lineConfig({})).toEqual({ settingsEncryptionKey: "", channelAccessToken: "", channelSecret: "" });
    expect(lineConfig({ SETTINGS_ENCRYPTION_KEY: "key", LINE_CHANNEL_ACCESS_TOKEN: "token", LINE_CHANNEL_SECRET: "secret" })).toEqual({ settingsEncryptionKey: "key", channelAccessToken: "token", channelSecret: "secret" });
    expect(requiredConfiguration({})).not.toContain("LINE_CHANNEL_SECRET");
  });

  it("enables LINE linking only for an explicit true server setting", () => {
    expect(lineLinkingEnabled({})).toBe(false);
    expect(lineLinkingEnabled({ LINE_LINKING_ENABLED: "false" })).toBe(false);
    expect(lineLinkingEnabled({ LINE_LINKING_ENABLED: " true " })).toBe(true);
    expect(requiredConfiguration({ LINE_LINKING_ENABLED: "true" })).not.toContain("LINE_CHANNEL_ACCESS_TOKEN");
  });

  it("keeps LINE messaging and chat payments off unless explicitly enabled", () => {
    expect(lineMessagingEnabled({})).toBe(false);
    expect(lineMessagingEnabled({ LINE_MESSAGING_ENABLED: " false " })).toBe(false);
    expect(lineMessagingEnabled({ LINE_MESSAGING_ENABLED: " true " })).toBe(true);
    expect(lineChatPaymentsEnabled({})).toBe(false);
    expect(lineChatPaymentsEnabled({ LINE_CHAT_PAYMENTS_ENABLED: "false" })).toBe(false);
    expect(lineChatPaymentsEnabled({ LINE_CHAT_PAYMENTS_ENABLED: "TRUE" })).toBe(true);
  });

  it("uses the current request origin for payment links when no canonical URL is configured", () => {
    expect(paymentLinkBaseUrl({ PRODUCTION_BASE_URL: "" }, "http://localhost:3000")).toBe("http://localhost:3000");
  });
});

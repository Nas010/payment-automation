import { beforeEach, describe, expect, it, vi } from "vitest";

const { listOperationalSettings } = vi.hoisted(() => ({ listOperationalSettings: vi.fn() }));
vi.mock("@/lib/sheets/settings", () => ({ listOperationalSettings }));

import { parseRuntimeConfig, runtimeConfig, runtimeConfigEntries } from "./runtime-config";

const valid = {
  businessDisplayName: "Coach Bee",
  promptPayType: "phone" as const,
  promptPayIdentifier: "0812345678",
  recipientNameEn: "Bee Example",
  recipientNameTh: "บี",
  recipientAliases: ["Coach Bee"],
  publicBaseUrl: "https://pay.example.com",
  slipRetentionDays: 30,
  ocrEnabled: true,
  lineLiffId: "",
  lineLoginChannelId: "",
  lineLinkingEnabled: false,
  lineMessagingEnabled: false,
  lineChatPaymentsEnabled: false,
};

describe("runtime configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes and validates a complete configuration using real PromptPay QR generation", () => {
    expect(parseRuntimeConfig(valid)).toEqual(valid);
    expect(runtimeConfigEntries(valid)).toEqual(expect.arrayContaining([
      { key: "recipient_aliases", value: "[\"Coach Bee\"]" },
      { key: "line_liff_id", value: "" },
      { key: "line_login_channel_id", value: "" },
    ]));
  });

  it("accepts formatted boolean values returned by Google Sheets", () => {
    expect(parseRuntimeConfig({
      ...valid,
      ocrEnabled: "TRUE",
      lineLiffId: "1234567890-AbCdEf",
      lineLoginChannelId: "1234567890",
      lineLinkingEnabled: "TRUE",
      lineMessagingEnabled: "TRUE",
      lineChatPaymentsEnabled: "FALSE",
    })).toMatchObject({
      ocrEnabled: true,
      lineLinkingEnabled: true,
      lineMessagingEnabled: true,
      lineChatPaymentsEnabled: false,
    });
  });

  it.each([
    [{ ...valid, businessDisplayName: "" }, "Business display name is required."],
    [{ ...valid, promptPayIdentifier: "123" }, "PromptPay phone number must contain 10 Thai digits"],
    [{ ...valid, recipientNameEn: "" }, "Recipient English name is required."],
    [{ ...valid, publicBaseUrl: "javascript:alert(1)" }, "Public base URL must use HTTP or HTTPS."],
    [{ ...valid, slipRetentionDays: 366 }, "Slip retention must be between 0 and 365 days."],
    [{ ...valid, lineLiffId: "bad" }, "LINE LIFF ID is malformed."],
    [{ ...valid, lineLoginChannelId: "channel-1" }, "LINE Login channel ID is malformed."],
    [{ ...valid, lineLinkingEnabled: true }, "LINE LIFF ID and LINE Login channel ID are required when LINE linking is enabled."],
    [{ ...valid, lineMessagingEnabled: true, lineLinkingEnabled: false }, "LINE messaging requires LINE linking."],
  ])("rejects invalid configuration: %s", (input, message) => {
    expect(() => parseRuntimeConfig(input)).toThrow(message as string);
  });

  it("prefers workbook LINE identifiers over environment fallbacks", async () => {
    listOperationalSettings.mockResolvedValue(operationalSettings([
      ["line_liff_id", "1234567890-Workbook"],
      ["line_login_channel_id", "1234567890"],
      ["line_linking_enabled", "TRUE"],
    ]));

    await expect(runtimeConfig({
      LINE_LIFF_ID: "9999999999-Environment",
      LINE_LOGIN_CHANNEL_ID: "9999999999",
    })).resolves.toMatchObject({
      lineLiffId: "1234567890-Workbook",
      lineLoginChannelId: "1234567890",
      lineLinkingEnabled: true,
    });
  });

  it("uses optional environment identifiers when an existing workbook has no LINE identifier keys", async () => {
    listOperationalSettings.mockResolvedValue(operationalSettings());

    await expect(runtimeConfig({
      LINE_LIFF_ID: "1234567890-Environment",
      LINE_LOGIN_CHANNEL_ID: "1234567890",
    })).resolves.toMatchObject({
      lineLiffId: "1234567890-Environment",
      lineLoginChannelId: "1234567890",
    });
  });

  it("fails closed without blocking Settings when a migrated workbook enabled LINE before identifier keys existed", async () => {
    listOperationalSettings.mockResolvedValue(operationalSettings([
      ["line_linking_enabled", "TRUE"],
      ["line_messaging_enabled", "TRUE"],
      ["line_chat_payments_enabled", "TRUE"],
    ]));

    await expect(runtimeConfig({})).resolves.toMatchObject({
      lineLiffId: "",
      lineLoginChannelId: "",
      lineLinkingEnabled: false,
      lineMessagingEnabled: false,
      lineChatPaymentsEnabled: false,
    });
  });
});

function operationalSettings(overrides: Array<[string, string]> = []) {
  const values: Array<[string, string]> = [
    ["business_display_name", "Coach Bee"],
    ["promptpay_type", "phone"],
    ["promptpay_identifier", "0812345678"],
    ["recipient_name_en", "Bee Example"],
    ["recipient_name_th", "บี"],
    ["recipient_aliases", "[\"Coach Bee\"]"],
    ["public_base_url", "https://pay.example.com"],
    ["slip_retention_days", "30"],
    ["ocr_enabled", "TRUE"],
    ["line_linking_enabled", "FALSE"],
    ["line_messaging_enabled", "FALSE"],
    ["line_chat_payments_enabled", "FALSE"],
  ];
  const merged = new Map([...values, ...overrides]);
  return [...merged].map(([key, value], index) => ({ rowNumber: index + 2, key, value }));
}

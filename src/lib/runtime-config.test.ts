import { describe, expect, it } from "vitest";
import { parseRuntimeConfig, runtimeConfigEntries } from "./runtime-config";

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
  lineLinkingEnabled: false,
  lineMessagingEnabled: false,
  lineChatPaymentsEnabled: false,
};

describe("runtime configuration", () => {
  it("normalizes and validates a complete configuration using real PromptPay QR generation", () => {
    expect(parseRuntimeConfig(valid)).toEqual(valid);
    expect(runtimeConfigEntries(valid)).toContainEqual({ key: "recipient_aliases", value: "[\"Coach Bee\"]" });
  });

  it("accepts formatted boolean values returned by Google Sheets", () => {
    expect(parseRuntimeConfig({
      ...valid,
      ocrEnabled: "TRUE",
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
    [{ ...valid, lineMessagingEnabled: true, lineLinkingEnabled: false }, "LINE messaging requires LINE linking."],
  ])("rejects invalid configuration: %s", (input, message) => {
    expect(() => parseRuntimeConfig(input)).toThrow(message as string);
  });
});

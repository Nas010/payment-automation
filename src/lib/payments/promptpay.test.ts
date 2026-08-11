import { describe, expect, it } from "vitest";
import { buildPaymentPromptPayPayload } from "./promptpay";

describe("buildPaymentPromptPayPayload", () => {
  it("uses the canonical payment amount in satang", () => {
    expect(buildPaymentPromptPayPayload({ amount_thb: "฿3,000.00" }, { promptPayIdentifier: "0812345678", promptPayType: "phone" })).toBe("00020101021229370016A000000677010111011300668123456785802TH53037645404300063045061");
  });

  it("rejects unavailable or non-positive payment amounts", () => {
    expect(() => buildPaymentPromptPayPayload({ amount_thb: "not money" }, { promptPayIdentifier: "0812345678", promptPayType: "phone" })).toThrow("Payment amount is invalid");
    expect(() => buildPaymentPromptPayPayload({ amount_thb: "0" }, { promptPayIdentifier: "0812345678", promptPayType: "phone" })).toThrow("Payment amount is invalid");
  });
});

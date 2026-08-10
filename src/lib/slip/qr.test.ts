import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "@/lib/promptpay/generate";
import { parseEmvQr, parseSlipVerifyQr, selectSlipQrPayload } from "./qr";

describe("parseEmvQr", () => {
  it("accepts valid TLV payload with CRC and rejects corrupt CRC", () => {
    const payload = buildPromptPayPayload("0812345678", "phone", 300000);
    expect(parseEmvQr(payload)?.valid).toBe(true);
    expect(parseEmvQr(`${payload.slice(0, -1)}0`)).toBeNull();
  });

  it("decodes a standard Slip Verify mini-QR and validates its CRC", () => {
    const payload = "004000060000010103002021900021231231212000115102TH91049C30";
    expect(parseSlipVerifyQr(payload)).toMatchObject({
      valid: true,
      sendingBankCode: "002",
      transactionReference: "0002123123121200011",
      countryCode: "TH",
    });
    expect(parseSlipVerifyQr(`${payload.slice(0, -1)}1`)).toBeNull();
  });

  it("selects the slip-verification QR instead of a payable PromptPay QR", () => {
    const paymentQr = buildPromptPayPayload("0812345678", "phone", 300000);
    const slipQr = "004000060000010103002021900021231231212000115102TH91049C30";
    expect(selectSlipQrPayload([paymentQr, slipQr])).toMatchObject({ payload: slipQr, qrValid: true, ambiguous: false });
    expect(selectSlipQrPayload([paymentQr])).toMatchObject({ payload: paymentQr, qrValid: false, ambiguous: false });
  });

  it("refuses an ambiguous unknown set", () => {
    expect(selectSlipQrPayload(["opaque-one", "opaque-two"])).toMatchObject({ payload: null, qrValid: false, ambiguous: true });
  });

  it("keeps a single unknown payload only for privacy-safe duplicate hashing", () => {
    expect(selectSlipQrPayload(["opaque-bank-payload"])).toMatchObject({ payload: "opaque-bank-payload", qrValid: false, ambiguous: false });
  });
});

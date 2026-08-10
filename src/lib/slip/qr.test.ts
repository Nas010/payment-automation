import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "@/lib/promptpay/generate";
import { parseEmvQr, selectSlipQrPayload } from "./qr";

describe("parseEmvQr", () => {
  it("accepts valid TLV payload with CRC and rejects corrupt CRC", () => {
    const payload = buildPromptPayPayload("0812345678", "phone", 300000);
    expect(parseEmvQr(payload)?.valid).toBe(true);
    expect(parseEmvQr(`${payload.slice(0, -1)}0`)).toBeNull();
  });

  it("prefers one structurally valid payload and refuses an ambiguous unknown set", () => {
    const valid = buildPromptPayPayload("0812345678", "phone", 300000);
    expect(selectSlipQrPayload(["opaque-bank-payload", valid])).toMatchObject({ payload: valid, qrValid: true, ambiguous: false });
    expect(selectSlipQrPayload(["opaque-one", "opaque-two"])).toMatchObject({ payload: null, qrValid: false, ambiguous: true });
  });

  it("keeps a single unknown payload only for privacy-safe duplicate hashing", () => {
    expect(selectSlipQrPayload(["opaque-bank-payload"])).toMatchObject({ payload: "opaque-bank-payload", qrValid: false, ambiguous: false });
  });
});

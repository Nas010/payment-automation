import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "@/lib/promptpay/generate";
import { parseEmvQr } from "./qr";

describe("parseEmvQr", () => {
  it("accepts valid TLV payload with CRC and rejects corrupt CRC", () => {
    const payload = buildPromptPayPayload("0812345678", "phone", 300000);
    expect(parseEmvQr(payload)?.valid).toBe(true);
    expect(parseEmvQr(`${payload.slice(0, -1)}0`)).toBeNull();
  });
});

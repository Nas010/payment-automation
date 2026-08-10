import { describe, expect, it } from "vitest";
import { buildPromptPayPayload, isValidEmvCrc } from "./generate";

describe("buildPromptPayPayload", () => {
  it("encodes a Thai mobile number and exact amount with valid CRC", () => {
    const payload = buildPromptPayPayload("0812345678", "phone", 300000);
    expect(payload).toContain("01130066812345678");
    expect(payload).toContain("54043000");
    expect(isValidEmvCrc(payload)).toBe(true);
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineSignature } from "./signature";

const secret = "12345678901234567890123456789012";
const body = '{"events":[]}';

function signatureFor(value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64");
}

describe("verifyLineSignature", () => {
  it("accepts the base64 HMAC-SHA256 for the exact raw body", () => {
    expect(verifyLineSignature(body, signatureFor(body), secret)).toBe(true);
  });

  it("rejects missing, malformed, and mismatched signatures", () => {
    expect(verifyLineSignature(body, null, secret)).toBe(false);
    expect(verifyLineSignature(body, "not-base64", secret)).toBe(false);
    expect(verifyLineSignature(`${body}\n`, signatureFor(body), secret)).toBe(false);
  });
});

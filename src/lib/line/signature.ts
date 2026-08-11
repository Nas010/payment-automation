import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLineSignature(rawBody: string, receivedSignature: string | null, channelSecret: string): boolean {
  if (!receivedSignature) return false;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(receivedSignature)) return false;

  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  const received = Buffer.from(receivedSignature, "base64");

  return received.length === expected.length && timingSafeEqual(received, expected);
}

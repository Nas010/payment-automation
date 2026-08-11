import { randomBytes } from "node:crypto";

export const LINE_LINK_CODE_PATTERN = /^[A-F0-9]{10}$/;

export function createLineLinkCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

export function expiresAt(now: Date | string): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString();
}

export function normalizeLineLinkCode(value: string): string | null {
  const code = value.toUpperCase();
  return LINE_LINK_CODE_PATTERN.test(code) ? code : null;
}

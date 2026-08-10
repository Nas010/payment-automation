import { isValidEmvCrc } from "@/lib/promptpay/generate";

export interface EmvQr {
  valid: true;
  fields: Record<string, string>;
  transactionReference: string | null;
}

export function parseEmvQr(payload: string): EmvQr | null {
  if (!payload.startsWith("000201") || !isValidEmvCrc(payload)) return null;
  const data = payload.slice(0, -8);
  const fields: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const id = data.slice(offset, offset + 2);
    const length = Number(data.slice(offset + 2, offset + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(length) || length < 0) return null;
    const value = data.slice(offset + 4, offset + 4 + length);
    if (value.length !== length) return null;
    fields[id] = value;
    offset += 4 + length;
  }
  const additional = fields["62"];
  const reference = additional?.match(/05(\d{2})([^]{0,99})/)?.[2]?.slice(0, Number(additional.match(/05(\d{2})/)?.[1] ?? 0)) ?? null;
  return { valid: true, fields, transactionReference: reference || null };
}

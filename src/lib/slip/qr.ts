import { isValidEmvCrc } from "@/lib/promptpay/generate";

export interface EmvQr {
  valid: true;
  fields: Record<string, string>;
  transactionReference: string | null;
}

export interface SlipQrSelection {
  payload: string | null;
  parsed: EmvQr | null;
  qrValid: boolean;
  ambiguous: boolean;
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

/**
 * Never blindly use the first decoded QR: a screenshot can include a payment
 * QR as well as the bank's verification QR. A single opaque bank payload is
 * retained only as a hash; multiple opaque candidates remain ambiguous.
 */
export function selectSlipQrPayload(payloads: string[]): SlipQrSelection {
  const unique = [...new Set(payloads.filter(Boolean))];
  const structurallyValid = unique.map((payload) => ({ payload, parsed: parseEmvQr(payload) })).filter((entry): entry is { payload: string; parsed: EmvQr } => Boolean(entry.parsed));
  if (structurallyValid.length === 1) return { payload: structurallyValid[0].payload, parsed: structurallyValid[0].parsed, qrValid: true, ambiguous: false };
  if (structurallyValid.length > 1 || unique.length > 1) return { payload: null, parsed: null, qrValid: false, ambiguous: true };
  if (unique.length === 1) return { payload: unique[0], parsed: null, qrValid: false, ambiguous: false };
  return { payload: null, parsed: null, qrValid: false, ambiguous: false };
}

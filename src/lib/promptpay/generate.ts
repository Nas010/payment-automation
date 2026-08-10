export type PromptPayType = "phone" | "national_id" | "ewallet";

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

export function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  for (const char of input) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normalizeIdentifier(identifier: string, type: PromptPayType): string {
  const digits = identifier.replace(/\D/g, "");
  if (type === "phone") {
    const local = digits.startsWith("0") ? digits.slice(1) : digits.replace(/^66/, "");
    if (local.length !== 9) throw new Error("PromptPay phone number must contain 10 Thai digits");
    return `0066${local}`;
  }
  if (digits.length < 10 || digits.length > 15) throw new Error("PromptPay identifier has invalid length");
  return digits;
}

export function buildPromptPayPayload(identifier: string, type: PromptPayType, amountSatang: number): string {
  if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) throw new Error("Amount must be a positive satang integer");
  const proxyType = type === "phone" ? "01" : type === "national_id" ? "02" : "03";
  const account = field("00", "A000000677010111") + field(proxyType, normalizeIdentifier(identifier, type));
  const amount = (amountSatang / 100).toFixed(2).replace(/\.00$/, "");
  const base = field("00", "01") + field("01", "12") + field("29", account) + field("58", "TH") + field("53", "764") + field("54", amount) + "6304";
  return `${base}${crc16CcittFalse(base)}`;
}

export function isValidEmvCrc(payload: string): boolean {
  return /6304[0-9A-F]{4}$/.test(payload) && crc16CcittFalse(payload.slice(0, -4)) === payload.slice(-4);
}

import { parseThaiSlipDate } from "@/lib/date";
import { parseSatang } from "@/lib/money";

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\p{P}\s]/gu, "").toUpperCase();
}

export interface CommonThaiSlipFields {
  bank: string | null;
  success: boolean;
  reference: string | null;
  amountSatang: number | null;
  recipientProxySuffix: string | null;
  transactionDate: string | null;
}

function bankFromText(text: string): string | null {
  if (/krungthai/i.test(text)) return "Krungthai";
  if (/\b(?:make\s+by\s+)?kbank\b/i.test(text)) return "KBank";
  if (/\bK\+/i.test(text)) return "K+";
  if (/\bSCB\b/i.test(text)) return "SCB";
  return null;
}

function timestampFromText(text: string): string | null {
  const match = text.match(/(\d{1,2}\s+(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+(?:\d{2}|\d{4}))(?:\s*[-–]?\s*)(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const date = parseThaiSlipDate(match[1], "Asia/Bangkok");
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!date || hour > 23 || minute > 59) return null;
  date.setUTCHours(date.getUTCHours() + hour, minute, 0, 0);
  return date.toISOString();
}

export function extractCommonThaiSlipFields(text: string): CommonThaiSlipFields {
  const compact = text.replace(/\s+/g, " ").trim();
  const reference = compact.match(/(?:รหัสอ้างอิง|เลขที่รายการ|reference|transaction\s*(?:id|no|number)?)[\s:.-]*([A-Z0-9][A-Z0-9-]{5,})/i)?.[1] ?? null;
  const amount = compact.match(/(?:จำนวนเงิน|จำนวน|amount)[\s:.-]*(?:฿\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(?:\s*(?:บาท|THB))?/i)?.[1] ?? null;
  const recipientProxySuffix = compact.match(/(?:X{2,3}[\s-]*){2,4}(\d{4})\b/i)?.[1] ?? null;
  return {
    bank: bankFromText(compact),
    success: /โอนเงินสำเร็จ|transfer\s+(?:was\s+)?successful/i.test(compact),
    reference,
    amountSatang: amount ? parseSatang(amount) : null,
    recipientProxySuffix,
    transactionDate: timestampFromText(compact),
  };
}

export function receiverFromOcrText(text: string, aliases: string[]): string | null {
  const haystack = normalized(text);
  return aliases.find((alias) => {
    const needle = normalized(alias);
    return needle.length >= 3 && haystack.includes(needle);
  }) ?? null;
}

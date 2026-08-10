import { parseThaiSlipDate } from "@/lib/date";
import { parseSatang } from "@/lib/money";

function normalized(value: string): string {
  return normalizeOcrText(value).normalize("NFKD").replace(/[\p{P}\s]/gu, "").toUpperCase();
}

/** Repair the inter-character whitespace commonly emitted by Thai Tesseract. */
export function normalizeOcrText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/(?<=[\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])/g, "")
    .replace(/\u0E4D\u0E32/g, "\u0E33")
    .replace(/\s+([.:/\-])/g, "$1")
    .normalize("NFC");
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
  if (/\bK\+/i.test(text)) return "K+";
  if (/\b(?:make\s+by\s+)?kbank\b/i.test(text) || /กสิกรไทย/.test(text)) return "KBank";
  if (/\bSCB\b/i.test(text)) return "SCB";
  return null;
}

function timestampFromText(text: string): string | null {
  const match = text.match(/(\d{1,2})\s+([\u0E00-\u0E7F.\s]{2,10}?)\s+(\d{2}|\d{4})(?:\s*[-–]?\s*)(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const monthKey = match[2].replace(/[.\s]/g, "");
  const monthAliases: Record<string, string> = {
    "มค": "ม.ค.", "กพ": "ก.พ.", "มีค": "มี.ค.", "เมย": "เม.ย.", "พค": "พ.ค.", "มิย": "มิ.ย.",
    "กค": "ก.ค.", "สค": "ส.ค.", "สุค": "ส.ค.", "กย": "ก.ย.", "ตค": "ต.ค.", "พย": "พ.ย.", "ธค": "ธ.ค.",
  };
  const month = monthAliases[monthKey];
  if (!month) return null;
  const date = parseThaiSlipDate(`${match[1]} ${month} ${match[3]}`, "Asia/Bangkok");
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!date || hour > 23 || minute > 59) return null;
  date.setUTCHours(date.getUTCHours() + hour, minute, 0, 0);
  return date.toISOString();
}

export function extractCommonThaiSlipFields(text: string): CommonThaiSlipFields {
  const compact = normalizeOcrText(text).replace(/\s+/g, " ").trim();
  const reference = compact.match(/(?:รหัสอ้างอิง|เลขที่รายการ|reference|transaction\s*(?:id|no|number)?)[\s:.-]*([A-Z0-9][A-Z0-9-]{5,})/i)?.[1] ?? null;
  const labelledAmount = compact.match(/(?:จำนวนเงิน|จำนวน|amount)[\s:.-]*(?:฿\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(?:\s*(?:บาท|THB))?/i)?.[1] ?? null;
  const monetaryCandidates = [...compact.matchAll(/(?:฿\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:บาท|THB)/gi)]
    .map((match) => parseSatang(match[1]))
    .filter((amount): amount is number => amount !== null && amount > 0);
  const amountSatang = labelledAmount ? parseSatang(labelledAmount) : monetaryCandidates[0] ?? null;
  const recipientProxySuffix = compact.match(/(?:X{2,3}[\s-]*){2,4}(\d{4})\b/i)?.[1] ?? null;
  return {
    bank: bankFromText(compact),
    success: /โอนเงินสำเร็จ|transfer\s+(?:was\s+)?successful/i.test(compact),
    reference,
    amountSatang,
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

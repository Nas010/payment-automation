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

export type OcrBoundingBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrTextLine = { text: string; confidence: number; bbox: OcrBoundingBox };
export type OcrImageRegion = { left: number; top: number; width: number; height: number };
export type AmountRecovery = { amountSatang: number | null; status: "RECOVERED" | "NO_CANDIDATE" | "AMBIGUOUS" };

const AMOUNT_LABEL = /(?:จำนวนเงิน|จำนวน|amount)/iu;
const FIELD_BOUNDARY = /(?:ค่าธรรมเนียม|fee|บันทึกช่วยจำ|memo|เลขที่รายการ|reference|รหัสอ้างอิง|ผู้รับ(?:เงิน)?|ไปยัง|recipient|\bto\b|\bfrom\b)/iu;
const RECOVERY_MONEY = /(?<![\d.,])((?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})(?![\d.,])/gu;

function compactLabel(value: string): string {
  return normalizeOcrText(value).replace(/\s+/g, "").toLowerCase();
}

/** Finds the smallest labelled amount area while excluding the following field. */
export function amountRegionFromOcrLines(lines: readonly OcrTextLine[], imageWidth: number, imageHeight: number): OcrImageRegion | null {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return null;
  const ordered = [...lines]
    .filter((line) => line.text.trim() && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0)
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
  const label = ordered
    .filter((line) => AMOUNT_LABEL.test(compactLabel(line.text)))
    .sort((left, right) => right.confidence - left.confidence || left.bbox.y0 - right.bbox.y0)[0];
  if (!label) return null;
  const labelIndex = ordered.indexOf(label);
  const maximumBottom = Math.min(imageHeight, label.bbox.y1 + imageHeight * 0.12);
  const selected = [label];
  for (const line of ordered.slice(labelIndex + 1)) {
    if (line.bbox.y0 >= maximumBottom) break;
    if (FIELD_BOUNDARY.test(compactLabel(line.text))) break;
    selected.push(line);
  }
  const padding = 8;
  const left = Math.max(0, Math.floor(Math.min(...selected.map((line) => line.bbox.x0)) - padding));
  const top = Math.max(0, Math.floor(Math.min(...selected.map((line) => line.bbox.y0)) - padding));
  const right = Math.min(imageWidth, Math.ceil(Math.max(...selected.map((line) => line.bbox.x1)) + padding));
  const bottom = Math.min(imageHeight, Math.ceil(Math.max(...selected.map((line) => line.bbox.y1)) + padding));
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function recoveredMoneyCandidates(text: string): number[] {
  const candidates = [...normalizeOcrText(text).matchAll(RECOVERY_MONEY)]
    .map((match) => parseSatang(match[1]!.replace(/\s/g, "")))
    .filter((amount): amount is number => amount !== null && amount > 0);
  return [...new Set(candidates)];
}

function labelledMoneyCandidates(text: string): number[] {
  const compact = normalizeOcrText(text).replace(/\s+/g, " ").trim();
  const label = AMOUNT_LABEL.exec(compact);
  if (!label) return [];
  const remainder = compact.slice((label.index ?? 0) + label[0].length);
  const boundary = FIELD_BOUNDARY.exec(remainder);
  return recoveredMoneyCandidates(boundary ? remainder.slice(0, boundary.index) : remainder);
}

function amountAgreement(candidates: number[][]): AmountRecovery {
  if (candidates.length < 2) return { amountSatang: null, status: "NO_CANDIDATE" };
  if (candidates.some((pass) => pass.length > 1)) return { amountSatang: null, status: "AMBIGUOUS" };
  if (candidates.some((pass) => pass.length === 0)) return { amountSatang: null, status: "NO_CANDIDATE" };
  const [normal, thresholded] = candidates;
  if (normal![0] !== thresholded![0]) return { amountSatang: null, status: "AMBIGUOUS" };
  return { amountSatang: normal![0]!, status: "RECOVERED" };
}

export function amountFromLabelledOcrLines(lines: readonly OcrTextLine[]): number | null {
  const candidates = lines
    .filter((line) => AMOUNT_LABEL.test(compactLabel(line.text)))
    .flatMap((line) => recoveredMoneyCandidates(line.text));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0]! : null;
}

/** Requires two preprocessing passes to independently produce one identical amount. */
export function recoverAmountFromOcrTexts(texts: readonly string[]): AmountRecovery {
  return amountAgreement(texts.slice(0, 2).map(recoveredMoneyCandidates));
}

export function recoverLabelledAmountFromOcrTexts(texts: readonly string[]): AmountRecovery {
  return amountAgreement(texts.slice(0, 2).map(labelledMoneyCandidates));
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
  const labelledAmount = compact.match(/(?:จำนวนเงิน|จำนวน|amount)(?:(?!ค่าธรรมเนียม|fee)\D){0,24}(?:฿\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*(?:บาท|THB))?/i)?.[1] ?? null;
  const monetaryCandidates = [...compact.matchAll(/(?:฿\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:บาท|THB)/gi)]
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

const RECIPIENT_LABEL = /(?:ไปยัง|ผู้รับ(?:เงิน)?|recipient|to)\s*[:\-]?\s*/giu;
const RECIPIENT_END = /(?:จำนวนเงิน|amount|บันทึกช่วยจำ|memo|(?:[X%]{2,3}[\s-]*){2,4})/iu;
const THAI_TITLE = /^(?:นางสาว|นาย|นาง)/u;
const THAI_CHARACTERS = /[\u0E00-\u0E7F]/gu;
const THAI_COMBINING_MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/gu;
const RECOVERY_SCORE_FLOOR = 0.72;
const RECOVERY_AVERAGE_FLOOR = 0.8;
const RECOVERY_MARGIN = 0.1;

function thaiName(value: string): string {
  return (normalizeOcrText(value).match(THAI_CHARACTERS) ?? []).join("").replace(THAI_TITLE, "").replace(THAI_COMBINING_MARKS, "");
}

function recipientRegions(text: string): string[] {
  const compact = normalizeOcrText(text).replace(/\s+/g, " ").trim();
  const matches = [...compact.matchAll(RECIPIENT_LABEL)];
  return matches.map((match) => {
    const start = (match.index ?? 0) + match[0].length;
    const remainder = compact.slice(start);
    const end = remainder.search(RECIPIENT_END);
    return (end === -1 ? remainder : remainder.slice(0, end)).trim();
  }).filter(Boolean);
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function similarity(left: string, right: string): number {
  const length = Math.max(left.length, right.length);
  return length ? 1 - editDistance(left, right) / length : 0;
}

type AliasScore = { alias: string; average: number };

/**
 * Resolves a configured Thai recipient only when two OCR passes independently
 * produce a close, unambiguous candidate. This deliberately returns the
 * configured alias, never untrusted OCR text.
 */
export function recoverReceiverFromOcrTexts(texts: readonly string[], aliases: readonly string[]): string | null {
  for (const text of texts) {
    const exact = receiverFromOcrText(text, [...aliases]);
    if (exact) return exact;
  }

  const thaiAliases = aliases.map((alias) => ({ alias, name: thaiName(alias) })).filter((entry) => entry.name.length >= 6);
  if (!thaiAliases.length) return null;
  const candidates = texts.map(recipientRegions).filter((regions) => regions.length > 0);
  if (candidates.length < 2) return null;

  const scores: AliasScore[] = thaiAliases.map(({ alias, name }) => {
    const passScores = candidates.map((regions) => Math.max(...regions.map((region) => similarity(thaiName(region), name))));
    const approved = passScores.filter((score) => score >= RECOVERY_SCORE_FLOOR).sort((left, right) => right - left);
    return { alias, average: approved.length >= 2 ? (approved[0]! + approved[1]!) / 2 : 0 };
  }).sort((left, right) => right.average - left.average);
  const winner = scores[0];
  const runnerUp = scores[1];
  if (!winner || winner.average < RECOVERY_AVERAGE_FLOOR) return null;
  if (runnerUp && winner.average - runnerUp.average < RECOVERY_MARGIN) return null;
  return winner.alias;
}

import { bangkokDateKey, parseThaiSlipDate } from "@/lib/date";
import { parseSatang } from "@/lib/money";

function normalized(value: string): string {
  return normalizeOcrText(value).normalize("NFKD").replace(/[\p{P}\s]/gu, "").toUpperCase();
}

/** Repair the inter-character whitespace commonly emitted by Thai Tesseract. */
export function normalizeOcrText(value: string): string {
  return value
    .normalize("NFC")
    // Only remove horizontal inter-character spacing. A newline is a field
    // boundary and must remain available to the spatial/labelled parsers.
    .replace(/(?<=[\u0E00-\u0E7F])[ \t]+(?=[\u0E00-\u0E7F])/g, "")
    .replace(/\u0E4D\u0E32/g, "\u0E33")
    .replace(/[ \t]+([.:/\-])/g, "$1")
    // Thai month abbreviations are often emitted as `ก . ค .`. Remove only
    // spaces around punctuation between Thai letters; preserve the boundary
    // before the year/time.
    .replace(/(?<=[\u0E00-\u0E7F])\s*\.\s*(?=[\u0E00-\u0E7F])/g, ".")
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
export type OcrEngine = "TESSERACT" | "PADDLE";
export type OcrVariant = "BASELINE" | "CLAHE" | "SAUVOLA" | "SCB_RECIPIENT";

/** A privacy-safe, source-labelled OCR line. Raw lines are request-scoped only. */
export type OcrEvidenceLine = {
  text: string;
  /** Confidence is always normalized to the inclusive range 0..1. */
  confidence: number;
  bbox: OcrBoundingBox;
  engine: OcrEngine;
  variant: OcrVariant;
};

/** Backwards-compatible fixture shape used by the pure layout helpers. */
export type OcrTextLine = Omit<OcrEvidenceLine, "engine" | "variant"> & {
  engine?: OcrEngine;
  variant?: OcrVariant;
};
export type OcrImageRegion = { left: number; top: number; width: number; height: number };
export type AmountRecovery = { amountSatang: number | null; status: "RECOVERED" | "NO_CANDIDATE" | "AMBIGUOUS" };
export type ConsensusStatus = "AGREED" | "MISSING" | "CONFLICT" | "AMBIGUOUS";
export type EvidenceConsensus<T> = { value: T | null; status: ConsensusStatus; sources: number };
export type TransferStatus = "SUCCESS" | "NOT_SUCCESS" | "UNKNOWN";

const AMOUNT_LABEL = /(?:จำนวนเงิน|จำนวน|amount)/iu;
const FIELD_BOUNDARY = /(?:ค่าธรรมเนียม|fee|บันทึกช่วยจำ|memo|เลขที่รายการ|reference|รหัสอ้างอิง|ผู้รับ(?:เงิน)?|ไปยัง|ผู้ส่ง|จาก|sender|recipient|\bto\b|\bfrom\b|จำนวนเงิน|จำนวน|amount)/iu;
const RECOVERY_MONEY = /(?<![\d.,])((?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})(?![\d.,])/gu;
const THAI_OCR_MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/gu;
const THAI_AMOUNT_LABELS = ["จำนวนเงิน", "จำนวน"];
const RECIPIENT_LABELS = ["ไปยัง", "ผู้รับ", "ผู้รับเงิน", "recipient", "to"];
const RECIPIENT_END_LABELS = ["จำนวนเงิน", "จำนวน", "amount", "ค่าธรรมเนียม", "fee", "บันทึกช่วยจำ", "memo", "เลขที่รายการ", "reference", "รหัสอ้างอิง", "จาก", "from"];
const FIELD_LABELS = [
  ...THAI_AMOUNT_LABELS,
  ...RECIPIENT_LABELS,
  ...RECIPIENT_END_LABELS,
  "วันที่ทำรายการ",
  "วันเวลาทำรายการ",
  "date",
  "สถานะ",
  "status",
];
// PromptPay masks are printed with hyphens, spaces, or (occasionally from
// OCR) equals signs. Capture exactly the final four Arabic digits and strip
// inter-digit whitespace before comparing with the configured suffix.
const MASKED_PROXY_SUFFIX = /(?:(?:x|%|\*){2,3}[\s\-=_]*){2,4}((?:\d[\s]*){4})(?!\d)/iu;

function maskedProxySuffix(match: RegExpMatchArray | null): string | null {
  const suffix = match?.[1]?.replace(/\s/gu, "");
  return suffix && /^\d{4}$/u.test(suffix) ? suffix : null;
}

function maskedProxySuffixFromLine(value: string): string | null {
  const direct = maskedProxySuffix(value.match(MASKED_PROXY_SUFFIX));
  if (direct) return direct;
  // When Tesseract turns the leading mask into mixed Thai/Arabic glyphs, the
  // final four Arabic digits and a separator are still reliable inside the
  // already-scoped recipient region.
  const tail = value.match(/(?:[-=_]\s*)(\d{4})(?!\d)/u)?.[1];
  return tail && /^\d{4}$/u.test(tail) ? tail : null;
}

function compactLabel(value: string): string {
  return normalizeOcrText(value).replace(/\s+/g, "").toLowerCase();
}

export function normalizeOcrLabel(value: string): string {
  return compactLabel(value).replace(/[.:：()\[\]{}]/gu, "");
}

function thaiSkeleton(value: string): string {
  return normalizeOcrText(value).normalize("NFKD").replace(THAI_OCR_MARKS, "").replace(/[^\u0E00-\u0E7F]/gu, "");
}

function resemblesThaiAmountLabel(value: string): boolean {
  const source = thaiSkeleton(value);
  return THAI_AMOUNT_LABELS.some((label) => {
    const target = thaiSkeleton(label);
    const minimumLength = Math.max(1, target.length - 1);
    const maximumLength = Math.min(source.length, target.length + 2);
    for (let length = minimumLength; length <= maximumLength; length += 1) {
      if (similarity(source.slice(0, length), target) >= 0.65) return true;
    }
    return false;
  });
}

function hasAmountLabel(value: string): boolean {
  return AMOUNT_LABEL.test(compactLabel(value)) || resemblesThaiAmountLabel(value);
}

/** Finds the smallest labelled amount area while excluding the following field. */
export function amountRegionFromOcrLines(lines: readonly OcrTextLine[], imageWidth: number, imageHeight: number): OcrImageRegion | null {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return null;
  const ordered = [...lines]
    .filter((line) => line.text.trim() && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0)
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
  const label = ordered
    .filter((line) => hasAmountLabel(line.text))
    .sort((left, right) => right.confidence - left.confidence || left.bbox.y0 - right.bbox.y0)[0];
  if (!label) return null;
  const labelIndex = ordered.indexOf(label);
  const maximumBottom = Math.min(imageHeight, label.bbox.y1 + imageHeight * 0.12);
  const selected = [
    label,
    ...ordered.filter((line) => line !== label
      && line.bbox.y0 < label.bbox.y0
      && line.bbox.y1 >= label.bbox.y0
      && recoveredMoneyCandidates(line.text).length === 1),
  ];
  for (const line of ordered.slice(labelIndex + 1)) {
    if (line.bbox.y0 >= maximumBottom) break;
    if (FIELD_BOUNDARY.test(compactLabel(line.text))) break;
    if (!selected.includes(line)) selected.push(line);
  }
  const padding = 8;
  const left = Math.min(Math.max(0, imageWidth - 1), Math.max(0, Math.floor(Math.min(...selected.map((line) => line.bbox.x0)) - padding)));
  const top = Math.min(Math.max(0, imageHeight - 1), Math.max(0, Math.floor(Math.min(...selected.map((line) => line.bbox.y0)) - padding)));
  const right = Math.min(imageWidth, Math.ceil(Math.max(...selected.map((line) => line.bbox.x1)) + padding));
  const bottom = Math.min(imageHeight, Math.ceil(Math.max(...selected.map((line) => line.bbox.y1)) + padding));
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function verticalOverlap(left: OcrBoundingBox, right: OcrBoundingBox): number {
  const overlap = Math.max(0, Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0));
  const smallerHeight = Math.min(left.y1 - left.y0, right.y1 - right.y0);
  return smallerHeight > 0 ? overlap / smallerHeight : 0;
}

function isRecognizedFieldLabel(text: string): boolean {
  if (FIELD_LABELS.some((label) => matchesAnyLabel(text, [label]))) return true;
  return resemblesThaiAmountLabel(text)
    || similarity(thaiSkeleton(text), thaiSkeleton("ไปยัง")) >= 0.68
    || similarity(thaiSkeleton(text), thaiSkeleton("ผู้รับ")) >= 0.68;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAnyLabel(text: string, labels: readonly string[]): boolean {
  const source = normalizeOcrText(text);
  const normalizedText = normalizeOcrLabel(source);
  return labels.some((label) => {
    const normalizedLabel = normalizeOcrLabel(label);
    if (!normalizedLabel) return false;
    // English labels must be whole words. Substring matching `to` would turn
    // arbitrary OCR words into a recipient/field label.
    if (/^[A-Za-z]+$/u.test(normalizedLabel)) {
      return new RegExp(`\\b${escapeRegExp(normalizedLabel)}\\b`, "iu").test(source);
    }
    return normalizedText.includes(normalizedLabel);
  });
}

/**
 * Selects the value lines belonging to a labelled field. A value is kept on
 * the same row when boxes overlap vertically by 50%; otherwise it may be
 * below the label by at most 15% of the image height. The next field label
 * and an 18% height guard terminate the search.
 */
export function fieldLinesFromOcrLines(
  lines: readonly OcrTextLine[],
  labels: readonly string[],
  imageHeight: number,
): OcrTextLine[] {
  if (!Number.isFinite(imageHeight) || imageHeight <= 0) return [];
  const ordered = [...lines]
    .filter((line) => line.text.trim() && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0)
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
  const label = ordered.find((line) => matchesAnyLabel(line.text, labels));
  if (!label) return [];
  const maxBottom = Math.min(imageHeight, label.bbox.y1 + imageHeight * 0.18);
  const linesForField = [label];
  for (const line of ordered) {
    if (line === label) continue;
    if (line.bbox.y0 >= maxBottom) break;
    if (line.bbox.y0 >= label.bbox.y0 && isRecognizedFieldLabel(line.text)) break;
    const sameRow = verticalOverlap(label.bbox, line.bbox) >= 0.5;
    const below = line.bbox.y0 >= label.bbox.y0 && line.bbox.y0 <= label.bbox.y1 + imageHeight * 0.15;
    if (sameRow || below) linesForField.push(line);
  }
  return linesForField.sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
}

/** Returns the spatial recipient region, including its adjacent masked line. */
export function recipientLinesFromOcrLines(lines: readonly OcrTextLine[], imageHeight: number): OcrTextLine[] {
  return fieldLinesFromOcrLines(lines, RECIPIENT_LABELS, imageHeight);
}

export function recipientSuffixCandidatesFromOcrLines(lines: readonly OcrTextLine[], imageHeight: number): string[] {
  const region = recipientLinesFromOcrLines(lines, imageHeight);
  const labelled = [...new Set(region.flatMap((line) => {
    const suffix = maskedProxySuffixFromLine(normalizeOcrText(line.text));
    return suffix ? [suffix] : [];
  }))];
  if (labelled.length) return labelled;

  // K+ and a few wallet variants omit a recipient label. Only accept a
  // masked suffix on the same/next line as a Thai name; multiple pairs remain
  // ambiguous instead of accidentally selecting the sender account.
  const ordered = [...lines].sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
  const nameIndexes = ordered.map((line, index) => likelyThaiNameLine(line.text) ? index : -1).filter((index) => index >= 0);
  const lastNameIndex = nameIndexes.at(-1);
  const unlabelled: Array<{ index: number; suffix: string }> = [];
  for (let index = 0; index < ordered.length; index += 1) {
    if (!likelyThaiNameLine(ordered[index]!.text)) continue;
    for (const candidate of [ordered[index]!, ordered[index + 1]]) {
      if (!candidate) continue;
      const suffix = maskedProxySuffixFromLine(normalizeOcrText(candidate.text));
      if (suffix) unlabelled.push({ index, suffix });
    }
  }
  const scoped = lastNameIndex === undefined ? unlabelled : unlabelled.filter((candidate) => candidate.index >= lastNameIndex);
  return [...new Set(scoped.map((candidate) => candidate.suffix))];
}

function recoveredMoneyCandidates(text: string): number[] {
  const moneyText = normalizeOcrText(text).replace(/(\.\d{2})\.+(?!\d)/g, "$1 ");
  const candidates = [...moneyText.matchAll(RECOVERY_MONEY)]
    .map((match) => parseSatang(match[1]!.replace(/\s/g, "")))
    .filter((amount): amount is number => amount !== null && amount > 0);
  return [...new Set(candidates)];
}

function labelledMoneyCandidates(text: string): number[] {
  const lines = normalizeOcrText(text).split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  const labelIndex = lines.findIndex((line) => hasAmountLabel(line));
  if (labelIndex < 0) return [];
  const fieldLines: string[] = [];
  for (let index = labelIndex; index < Math.min(lines.length, labelIndex + 5); index += 1) {
    const line = lines[index]!;
    if (index > labelIndex && FIELD_BOUNDARY.test(compactLabel(line))) break;
    fieldLines.push(line);
  }
  return recoveredMoneyCandidates(fieldLines.join(" "));
}

function amountAgreement(candidates: number[][]): AmountRecovery {
  if (candidates.length < 2) return { amountSatang: null, status: "NO_CANDIDATE" };
  if (candidates.some((pass) => pass.length > 1)) return { amountSatang: null, status: "AMBIGUOUS" };
  if (candidates.some((pass) => pass.length === 0)) return { amountSatang: null, status: "NO_CANDIDATE" };
  const [normal, thresholded] = candidates;
  if (normal![0] !== thresholded![0]) return { amountSatang: null, status: "AMBIGUOUS" };
  return { amountSatang: normal![0]!, status: "RECOVERED" };
}

export function consensusFromCandidates<T>(
  candidates: readonly { value: T | null; source: string }[],
  equals: (left: T, right: T) => boolean = (left, right) => left === right,
): EvidenceConsensus<T> {
  const available = candidates.filter((candidate): candidate is { value: T; source: string } => candidate.value !== null);
  const distinctSources = new Set(available.map((candidate) => candidate.source)).size;
  if (available.length < 2 || distinctSources < 2) return { value: null, status: "MISSING", sources: distinctSources };
  const groups: { value: T; count: number; sources: Set<string> }[] = [];
  for (const candidate of available) {
    const group = groups.find((entry) => equals(entry.value, candidate.value));
    if (group) {
      group.count += 1;
      group.sources.add(candidate.source);
    } else groups.push({ value: candidate.value, count: 1, sources: new Set([candidate.source]) });
  }
  const agreed = groups.filter((group) => group.sources.size >= 2);
  // Consensus is strict: a two-source majority cannot override a third
  // source that disagrees. Any conflicting value keeps payment in REVIEW.
  if (groups.length === 1 && agreed.length === 1) return { value: agreed[0]!.value, status: "AGREED", sources: agreed[0]!.sources.size };
  if (agreed.length > 1) return { value: null, status: "AMBIGUOUS", sources: distinctSources };
  return { value: null, status: groups.length > 1 ? "CONFLICT" : "AMBIGUOUS", sources: distinctSources };
}

export function consensusAmountFromCandidates(candidates: readonly { amountSatang: number | null; source: string }[]): EvidenceConsensus<number> {
  return consensusFromCandidates(candidates.map((candidate) => ({ value: candidate.amountSatang, source: candidate.source })));
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

export function transferStatusFromText(text: string): TransferStatus {
  const normalizedText = normalizeOcrText(text);
  const thaiText = thaiSkeleton(normalizedText);
  const thaiSuccess = ["โอนเงินสำเร็จ", "โอนสำเร็จ", "รายการสำเร็จ"].some((phrase) => thaiText.includes(thaiSkeleton(phrase)));
  const thaiFailure = ["ไม่สำเร็จ", "ล้มเหลว", "ยกเลิก", "กำลังดำเนินการ", "รอดำเนินการ"].some((phrase) => thaiText.includes(thaiSkeleton(phrase)));
  const fuzzyThaiSuccess = ["โอนเงินสำเร็จ", "โอนสำเร็จ", "รายการสำเร็จ"].some((phrase) => {
    const target = thaiSkeleton(phrase);
    const start = thaiText.indexOf(target.slice(0, Math.min(4, target.length)));
    if (start < 0) return false;
    const window = thaiText.slice(start, start + target.length + 2);
    return similarity(window, target) >= 0.78;
  });
  if (thaiSuccess || fuzzyThaiSuccess
    || /transfer\s+(?:was\s+)?successful|success(?:ful)?/iu.test(normalizedText)) return "SUCCESS";
  if (thaiFailure
    || /pending|failed|failure|cancelled|canceled|unsuccessful/iu.test(normalizedText)) return "NOT_SUCCESS";
  return "UNKNOWN";
}

export function consensusTransferStatus(candidates: readonly { status: TransferStatus; source: string }[]): { status: TransferStatus; consensus: ConsensusStatus } {
  const available = candidates.filter((candidate) => candidate.status !== "UNKNOWN");
  const consensus = consensusFromCandidates(available.map((candidate) => ({ value: candidate.status, source: candidate.source })));
  if (consensus.status === "AGREED" && consensus.value) return { status: consensus.value, consensus: "AGREED" };
  if (available.length === 0) return { status: "UNKNOWN", consensus: "MISSING" };
  if (consensus.status === "CONFLICT") return { status: "UNKNOWN", consensus: "CONFLICT" };
  return { status: "UNKNOWN", consensus: consensus.status };
}

function timestampFromText(text: string): string | null {
  const normalizedText = normalizeOcrText(text);
  const monthAliases: Record<string, string> = {
    "มค": "ม.ค.", "กพ": "ก.พ.", "มีค": "มี.ค.", "เมย": "เม.ย.", "พค": "พ.ค.", "มิย": "มิ.ย.",
    "กค": "ก.ค.", "สค": "ส.ค.", "สุค": "ส.ค.", "กย": "ก.ย.", "ตค": "ต.ค.", "พย": "พ.ย.", "ธค": "ธ.ค.",
    "an": "ส.ค.", "na": "ก.ค.",
  };
  // OCR text often contains reference/account digits before the actual date.
  // Try every date-shaped match and keep the first one with a recognized Thai
  // month and valid clock instead of failing on an earlier false start.
  const matches = normalizedText.matchAll(/(\d{1,2})\s+([\u0E00-\u0E7FA-Za-z.\s]{2,10}?)\s+(\d{2}|\d{4})(?:\s*[-–]?\s*)(\d{1,2}):(\d{2})/g);
  for (const match of matches) {
    const monthKey = match[2]!.replace(/[.\s]/g, "").toLowerCase();
    const month = monthAliases[monthKey];
    if (!month) continue;
    const date = parseThaiSlipDate(`${match[1]} ${month} ${match[3]}`, "Asia/Bangkok");
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (!date || hour > 23 || minute > 59) continue;
    date.setUTCHours(date.getUTCHours() + hour, minute, 0, 0);
    return date.toISOString();
  }
  return null;
}

export function transactionDateFromText(text: string): string | null {
  return timestampFromText(normalizeOcrText(text));
}

export function consensusTransactionDate(candidates: readonly { date: string | null; source: string }[]): EvidenceConsensus<string> {
  const available = candidates.filter((candidate): candidate is { date: string; source: string } => candidate.date !== null);
  const days = consensusFromCandidates(available.map((candidate) => ({ value: bangkokDateKey(new Date(candidate.date)), source: candidate.source })));
  if (days.status !== "AGREED" || !days.value) return { value: null, status: days.status, sources: days.sources };
  const first = available.find((candidate) => bangkokDateKey(new Date(candidate.date)) === days.value);
  return first ? { value: first.date, status: "AGREED", sources: days.sources } : { value: null, status: "CONFLICT", sources: days.sources };
}

function recipientSuffixCandidatesFromText(text: string): string[] {
  const regions = recipientRegions(text);
  const source = regions.length ? regions.join("\n") : unlabelledRecipientRegions(text).join("\n");
  const labelledSuffix = maskedProxySuffixFromLine(source);
  if (labelledSuffix) return [labelledSuffix];

  // Some K+ receipts print the recipient name and the masked PromptPay line
  // on adjacent unlabelled lines. Keep the suffix scoped to that pair rather
  // than falling back to the sender/account section elsewhere on the slip.
  const lines = text.split(/\r?\n/).map((line) => normalizeOcrText(line).trim()).filter(Boolean);
  const nameIndexes = lines.map((line, index) => likelyThaiNameLine(line) ? index : -1).filter((index) => index >= 0);
  const lastNameIndex = nameIndexes.at(-1);
  const suffixes: Array<{ index: number; suffix: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!likelyThaiNameLine(lines[index]!)) continue;
    // K+ puts `รหัสพร้อมเพย์` between the recipient name and its masked
    // number. Keep this look-ahead bounded, then select the lowest scoped
    // candidate so the sender's account cannot satisfy recipient evidence.
    for (const candidate of [lines[index]!, lines[index + 1] ?? "", lines[index + 2] ?? "", lines[index + 3] ?? ""]) {
      const suffix = maskedProxySuffixFromLine(candidate);
      if (suffix) suffixes.push({ index, suffix });
    }
  }
  if (lastNameIndex === undefined) {
    const direct = lines.map((line) => maskedProxySuffixFromLine(line)).filter((suffix): suffix is string => Boolean(suffix));
    return direct.length ? [direct[direct.length - 1]!] : [];
  }
  const scoped = suffixes.filter((candidate) => candidate.index >= lastNameIndex);
  return scoped.length ? [scoped[scoped.length - 1]!.suffix] : [];
}

export function recipientSuffixCandidatesFromOcrText(text: string): string[] {
  return recipientSuffixCandidatesFromText(normalizeOcrText(text));
}

export function consensusRecipientSuffix(candidates: readonly { suffix: string | null; source: string }[], expectedSuffix?: string | null): { match: boolean | null; status: ConsensusStatus; suffix: string | null } {
  const consensus = consensusFromCandidates(candidates.map((candidate) => ({ value: candidate.suffix, source: candidate.source })));
  if (consensus.status !== "AGREED" || !consensus.value) return { match: null, status: consensus.status, suffix: null };
  return { match: expectedSuffix ? consensus.value === expectedSuffix : null, status: "AGREED", suffix: consensus.value };
}

export function extractCommonThaiSlipFields(text: string): CommonThaiSlipFields {
  const normalizedText = normalizeOcrText(text);
  const compact = normalizedText.replace(/\s+/g, " ").trim();
  const reference = compact.match(/(?:รหัสอ้างอิง|เลขที่รายการ|reference|transaction\s*(?:id|no|number)?)[\s:.-]*([A-Z0-9][A-Z0-9-]{5,})/i)?.[1] ?? null;
  const labelledAmount = compact.match(/(?:จำนวนเงิน|จำนวน|amount)(?:(?!ค่าธรรมเนียม|fee)\D){0,24}(?:฿\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*(?:บาท|THB))?/i)?.[1] ?? null;
  const monetaryCandidates = [...compact.matchAll(/(?:฿\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:บาท|THB)/gi)]
    .map((match) => parseSatang(match[1]))
    .filter((amount): amount is number => amount !== null && amount > 0);
  const amountSatang = labelledAmount ? parseSatang(labelledAmount) : monetaryCandidates[0] ?? null;
  const recipientProxySuffix = recipientSuffixCandidatesFromText(normalizedText)[0] ?? null;
  return {
    bank: bankFromText(compact),
    success: transferStatusFromText(compact) === "SUCCESS",
    reference,
    amountSatang,
    recipientProxySuffix,
    transactionDate: timestampFromText(compact),
  };
}

const THAI_TITLE = /^(?:นางสาว|นาย|นาง|น\.ส\.?|นส)/u;

export function receiverFromOcrText(text: string, aliases: string[]): string | null {
  const haystack = normalized(text);
  return aliases.find((alias) => {
    const needle = normalized(alias.replace(THAI_TITLE, ""));
    return needle.length >= 3 && haystack.includes(needle);
  }) ?? null;
}

const RECIPIENT_LABEL = /(?:ไปยัง|ผู้รับ(?:เงิน)?|\brecipient\b|\bto\b)\s*[:\-]?\s*/giu;
const RECIPIENT_END = /(?:จำนวนเงิน|จำนวน|\bamount\b|ค่าธรรมเนียม|\bfee\b|บันทึกช่วยจำ|\bmemo\b|เลขที่รายการ|\breference\b|รหัสอ้างอิง|จาก|\bfrom\b|วันที่ทำรายการ|\bdate\b|สถานะ|\bstatus\b)/iu;
const THAI_CHARACTERS = /[\u0E00-\u0E7F]/gu;
const THAI_COMBINING_MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/gu;
const RECOVERY_SCORE_FLOOR = 0.72;
const RECOVERY_AVERAGE_FLOOR = 0.8;
const RECOVERY_MARGIN = 0.1;

function thaiName(value: string): string {
  const normalizedValue = normalizeOcrText(value);
  // Fuzzy regions may retain a noisy `ไปยัง`/digit prefix before the title.
  // Start at the first Thai title when present so labels do not lower the
  // configured-name similarity score.
  const titleIndex = normalizedValue.search(/(?:นางสาว|นาย|นาง)/u);
  const nameSource = titleIndex >= 0 ? normalizedValue.slice(titleIndex) : normalizedValue;
  return (nameSource.match(THAI_CHARACTERS) ?? []).join("").replace(/[๐-๙]/gu, "").replace(THAI_TITLE, "").replace(THAI_COMBINING_MARKS, "");
}

function likelyThaiNameLine(value: string): boolean {
  const normalizedValue = normalizeOcrText(value);
  const name = thaiName(normalizedValue);
  if (name.length < 6 || name.length > 40) return false;
  // A recipient label can be polluted by one or two OCR digits (for example
  // `ไปยัง 0 นางสาว ...`). Reject account/date-shaped lines, not those small
  // label artefacts.
  if ((normalizedValue.match(/[0-9๐-๙]/gu) ?? []).length > 2) return false;
  return !/(?:โอนเงิน|สำเร็จ|จำนวน|ค่าธรรมเนียม|บันทึกช่วยจำ|รหัส|เลขที่รายการ|วันที่ทำรายการ|ธนาคาร|พร้อมเพย์|กสิกรไทย|กรุงไทย|สถานะ)/u.test(normalizedValue);
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

export function recipientTextRegions(text: string): string[] {
  const labelled = recipientRegions(text);
  return labelled.length ? labelled : unlabelledRecipientRegions(text);
}

/** Exact configured-name matching constrained to the recipient region. */
export function receiverFromRecipientOcrText(text: string, aliases: readonly string[]): string | null {
  for (const region of recipientTextRegions(text)) {
    const exact = receiverFromOcrText(region, [...aliases]);
    if (exact) return exact;
  }
  return null;
}

function unlabelledRecipientRegions(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => normalizeOcrText(line).trim()).filter(Boolean);
  const looksLikeMaskedAccount = (line: string): boolean =>
    (line.match(/[0-9๐-๙]/gu) ?? []).length >= 4 && /[Xx%*<>-]/u.test(line);
  return lines.filter((line, index) => {
    return likelyThaiNameLine(line)
      && (looksLikeMaskedAccount(line)
        || looksLikeMaskedAccount(lines[index + 1] ?? "")
        || looksLikeMaskedAccount(lines[index + 2] ?? "")
        || looksLikeMaskedAccount(lines[index + 3] ?? ""));
  });
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
    const exact = receiverFromRecipientOcrText(text, aliases);
    if (exact) return exact;
  }

  const thaiAliases = aliases.map((alias) => ({ alias, name: thaiName(alias) })).filter((entry) => entry.name.length >= 6);
  if (!thaiAliases.length) return null;
  const candidates = texts
    .map((text) => {
      const labelled = recipientTextRegions(text);
      return labelled.length ? labelled : unlabelledRecipientRegions(text);
    })
    .filter((regions) => regions.length > 0);
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

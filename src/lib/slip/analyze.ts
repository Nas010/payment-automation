import sharp from "sharp";
import { BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { sha256 } from "./hash";
import { validateImageUpload } from "./validate";
import { selectSlipQrPayload } from "./qr";
import { localTesseractOptions } from "./tessdata";
import { runPaddleOcr } from "./paddle";
import {
  amountFromLabelledOcrLines,
  amountRegionFromOcrLines,
  consensusAmountFromCandidates,
  consensusRecipientSuffix,
  consensusTransactionDate,
  consensusTransferStatus,
  extractCommonThaiSlipFields,
  recoverAmountFromOcrTexts,
  recoverLabelledAmountFromOcrTexts,
  recoverReceiverFromOcrTexts,
  recipientSuffixCandidatesFromOcrLines,
  recipientSuffixCandidatesFromOcrText,
  recipientLinesFromOcrLines,
  recipientTextRegions,
  receiverFromRecipientOcrText,
  transactionDateFromText,
  transferStatusFromText,
  type AmountRecovery,
  type OcrBoundingBox,
  type OcrEvidenceLine,
  type OcrVariant,
  type TransferStatus,
} from "./ocr";

export interface SlipAnalysis {
  imageHash: string;
  qrPayloadHash: string | null;
  qrValid: boolean;
  transactionRef: string | null;
  originatingBank: string | null;
  ocrAmountSatang: number | null;
  ocrReceiver: string | null;
  ocrTransactionDate: string | null;
  recipientProxyMatch: boolean | null;
  transferStatus: TransferStatus;
  reasons: string[];
}

export type OcrDiagnostic =
  | "OCR_LAYOUT_UNAVAILABLE"
  | "OCR_PASS_FAILED"
  | "OCR_PASS_TIMEOUT"
  | "OCR_AMOUNT_LABEL_MISSING"
  | "OCR_AMOUNT_NO_CANDIDATE"
  | "OCR_AMOUNT_AMBIGUOUS"
  | "OCR_RECEIVER_NO_MATCH"
  | "OCR_RECEIVER_AMBIGUOUS"
  | "OCR_RECEIVER_SUFFIX_MISSING"
  | "OCR_RECEIVER_SUFFIX_AMBIGUOUS"
  | "OCR_RECEIVER_SUFFIX_MISMATCH"
  | "OCR_DATE_NO_MATCH"
  | "OCR_DATE_AMBIGUOUS"
  | "OCR_TRANSFER_STATUS_UNKNOWN"
  | "OCR_TRANSFER_STATUS_CONFLICT"
  | "OCR_TRANSFER_NOT_SUCCESS"
  | "OCR_PADDLE_UNAVAILABLE";

type OcrResult = {
  amount: number | null;
  receiver: string | null;
  date: string | null;
  reference: string | null;
  bank: string | null;
  recipientProxyMatch: boolean | null;
  transferStatus: TransferStatus;
  diagnostics: OcrDiagnostic[];
};

type OcrWorker = {
  recognize: (image: unknown, options?: unknown, output?: unknown) => Promise<{ data: { text?: unknown; blocks?: unknown } }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
  reinitialize?: (langs?: string | string[], oem?: unknown, config?: unknown) => Promise<unknown>;
};

const MAX_DIMENSION = 2000;
const ANALYSIS_BUDGET_MS = 45_000;
const PRIMARY_OCR_BUDGET_MS = 20_000;
const FIELD_RECOVERY_BUDGET_MS = 15_000;

function noOcrResult(diagnostics: OcrDiagnostic[] = []): OcrResult {
  return { amount: null, receiver: null, date: null, reference: null, bank: null, recipientProxyMatch: null, transferStatus: "UNKNOWN", diagnostics };
}

function hasThaiAlias(aliases: readonly string[]): boolean {
  return aliases.some((alias) => /[\u0E00-\u0E7F]/u.test(alias));
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "OCR_PASS_TIMEOUT";
}

class OcrTimeoutError extends Error {
  constructor() {
    super("OCR pass timed out");
    this.name = "OCR_PASS_TIMEOUT";
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  if (milliseconds <= 0) throw new OcrTimeoutError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new OcrTimeoutError()), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function normalizeOcrImage(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .toColourspace("srgb")
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}

export async function preprocessOcrImage(bytes: Uint8Array, variant: Exclude<OcrVariant, "SCB_RECIPIENT">): Promise<Buffer> {
  const image = sharp(bytes).greyscale().normalize().sharpen().toColourspace("b-w");
  const baseline = await image.toBuffer();
  if (variant === "CLAHE") return sharp(baseline).clahe({ width: 3, height: 3, maxSlope: 3 }).toBuffer();
  return baseline;
}

async function renderScbRecipient(bytes: Uint8Array, width: number, height: number, threshold = false): Promise<{ image: Buffer; offset: { x: number; y: number } }> {
  const region = {
    left: Math.floor(width * 0.4),
    top: Math.floor(height * 0.38),
    width: Math.max(1, Math.floor(width * 0.58)),
    height: Math.max(1, Math.floor(height * 0.14)),
  };
  const cropped = sharp(bytes).extract(region).greyscale().normalize().sharpen();
  return { image: threshold ? await cropped.threshold(185).toBuffer() : await cropped.toBuffer(), offset: { x: region.left, y: region.top } };
}

function recipientRecoveryRegion(lines: OcrEvidenceLine[], width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  const ordered = [...lines]
    .filter((line) => line.text.trim() && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0)
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);
  let selected = recipientLinesFromOcrLines(ordered, height);
  if (selected.length < 2) {
    // Wallet layouts without a visible `ไปยัง` label (notably K+) still have
    // a Thai name followed shortly by its masked PromptPay number. Select the
    // lowest such pair, never the sender/account pair above it.
    const looksMasked = (text: string): boolean => /(?:[xX%*][\s\-=_]*){2,}\d[\s\d]{3,}(?!\d)/u.test(text);
    for (let index = 0; index < ordered.length; index += 1) {
      const thaiLength = (ordered[index]!.text.match(/[\u0E00-\u0E7F]/gu) ?? []).length;
      if (thaiLength < 6) continue;
      const nearby = ordered.slice(index, Math.min(ordered.length, index + 4));
      if (nearby.some((line) => looksMasked(line.text))) selected = nearby;
    }
  }
  if (selected.length < 2) return null;
  const paddingX = Math.max(8, Math.round(width * 0.015));
  const paddingY = Math.max(8, Math.round(height * 0.012));
  const left = Math.max(0, Math.floor(Math.min(...selected.map((line) => line.bbox.x0)) - paddingX));
  const top = Math.max(0, Math.floor(Math.min(...selected.map((line) => line.bbox.y0)) - paddingY));
  const right = Math.min(width, Math.ceil(Math.max(...selected.map((line) => line.bbox.x1)) + paddingX));
  const bottom = Math.min(height, Math.ceil(Math.max(...selected.map((line) => line.bbox.y1)) + paddingY));
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

async function renderRecipientRecovery(bytes: Uint8Array, lines: OcrEvidenceLine[], width: number, height: number): Promise<{ normal: Buffer; thresholded: Buffer; clahe: Buffer; offset: { x: number; y: number } } | null> {
  const region = recipientRecoveryRegion(lines, width, height);
  if (!region) return null;
  const cropped = sharp(bytes).extract(region).greyscale().normalize().sharpen();
  const normal = await cropped.toBuffer();
  const thresholded = await sharp(normal).threshold(185).toBuffer();
  const clahe = await sharp(normal).clahe({ width: 3, height: 3, maxSlope: 3 }).toBuffer();
  return { normal, thresholded, clahe, offset: { x: region.left, y: region.top } };
}

function dateRecoveryRegion(lines: OcrEvidenceLine[], width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  const candidates = lines
    .filter((line) => /\d{1,2}/u.test(line.text) && /(?:^|[^0-9])\d{1,2}:\s*\d{2}(?:[^0-9]|$)/u.test(line.text))
    .sort((left, right) => left.bbox.y0 - right.bbox.y0);
  const line = candidates[0];
  if (!line) return null;
  const paddingX = Math.max(10, Math.round(width * 0.02));
  const paddingY = Math.max(8, Math.round(height * 0.012));
  const left = Math.max(0, Math.floor(line.bbox.x0 - paddingX));
  const top = Math.max(0, Math.floor(line.bbox.y0 - paddingY));
  const right = Math.min(width, Math.ceil(line.bbox.x1 + paddingX));
  const bottom = Math.min(height, Math.ceil(line.bbox.y1 + paddingY));
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

async function renderDateRecovery(bytes: Uint8Array, lines: OcrEvidenceLine[], width: number, height: number): Promise<{ normal: Buffer; thresholded: Buffer; highThreshold: Buffer; clahe: Buffer; offset: { x: number; y: number } } | null> {
  const region = dateRecoveryRegion(lines, width, height);
  if (!region) return null;
  const cropped = sharp(bytes).extract(region).greyscale().normalize().sharpen();
  const normal = await cropped.toBuffer();
  const thresholded = await sharp(normal).threshold(185).toBuffer();
  const highThreshold = await sharp(normal).threshold(220).toBuffer();
  const clahe = await sharp(normal).clahe({ width: 3, height: 3, maxSlope: 3 }).toBuffer();
  return { normal, thresholded, highThreshold, clahe, offset: { x: region.left, y: region.top } };
}

function confidence(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function validBox(value: unknown): value is OcrBoundingBox {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  return [box.x0, box.y0, box.x1, box.y1].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

function evidenceLine(text: unknown, rawConfidence: unknown, box: unknown, engine: "TESSERACT" | "PADDLE", variant: OcrVariant, offsetX = 0, offsetY = 0): OcrEvidenceLine | null {
  if (typeof text !== "string" || !text.trim() || !validBox(box)) return null;
  const candidate = box as OcrBoundingBox;
  return {
    text,
    confidence: confidence(rawConfidence),
    bbox: { x0: candidate.x0 + offsetX, y0: candidate.y0 + offsetY, x1: candidate.x1 + offsetX, y1: candidate.y1 + offsetY },
    engine,
    variant,
  };
}

function ocrLines(blocks: unknown, variant: OcrVariant, offsetX = 0, offsetY = 0): OcrEvidenceLine[] {
  if (!Array.isArray(blocks)) return [];
  const lines: OcrEvidenceLine[] = [];
  const add = (line: unknown) => {
    if (!line || typeof line !== "object") return;
    const candidate = line as { text?: unknown; confidence?: unknown; bbox?: unknown };
    const parsed = evidenceLine(candidate.text, candidate.confidence, candidate.bbox, "TESSERACT", variant, offsetX, offsetY);
    if (parsed) lines.push(parsed);
  };
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const paragraphs = (block as { paragraphs?: unknown }).paragraphs;
    if (!Array.isArray(paragraphs)) continue;
    for (const paragraph of paragraphs) {
      const paragraphLines = paragraph && typeof paragraph === "object" ? (paragraph as { lines?: unknown }).lines : null;
      if (Array.isArray(paragraphLines)) paragraphLines.forEach(add);
    }
  }
  return lines;
}

async function recognizeEvidence(worker: OcrWorker, image: Buffer, variant: OcrVariant, offsetX = 0, offsetY = 0): Promise<{ text: string; lines: OcrEvidenceLine[] }> {
  const result = await worker.recognize(image, {}, { text: true, blocks: true });
  return { text: typeof result.data.text === "string" ? result.data.text : "", lines: ocrLines(result.data.blocks, variant, offsetX, offsetY) };
}

function amountDiagnostic(recovery: AmountRecovery): OcrDiagnostic | null {
  if (recovery.status === "AMBIGUOUS") return "OCR_AMOUNT_AMBIGUOUS";
  if (recovery.status === "NO_CANDIDATE") return "OCR_AMOUNT_NO_CANDIDATE";
  return null;
}

async function numericPass(worker: OcrWorker, image: Buffer, variant: OcrVariant): Promise<string> {
  await worker.setParameters({ tessedit_char_whitelist: "0123456789,. ", tessedit_pageseg_mode: "6", thresholding_method: variant === "SAUVOLA" ? "2" : "0" });
  try {
    const result = await worker.recognize(image);
    return typeof result.data.text === "string" ? result.data.text : "";
  } finally {
    // Do not leak the numeric whitelist into later Thai/date/status passes if
    // a crop recognition throws. The request-scoped worker remains reusable.
    await worker.setParameters({ tessedit_char_whitelist: "", thresholding_method: "" });
  }
}

async function structuredAmount(input: {
  primaryImage: Buffer;
  evidence: Array<{ source: string; text: string; lines: OcrEvidenceLine[]; image: Buffer }>;
  worker: OcrWorker;
  width: number;
  height: number;
}): Promise<{ amount: number | null; diagnostics: OcrDiagnostic[] }> {
  const baseline = input.evidence.find((entry) => entry.source === "TESSERACT:BASELINE") ?? input.evidence[0];
  const alternate = input.evidence.find((entry) => entry.source === "TESSERACT:SAUVOLA") ?? input.evidence[1];
  if (!baseline || !alternate) return { amount: null, diagnostics: ["OCR_PASS_FAILED"] };
  const region = amountRegionFromOcrLines(baseline.lines, input.width, input.height);
  if (!region) {
    // A damaged label (for example character-spaced `จํานวน`) can make the
    // geometry unavailable even though both full-receipt passes contain one
    // clear money value. Keep the two-source agreement requirement while
    // falling back to the bounded money-shape parser; it excludes fees,
    // references, account numbers, and dates.
    const labelled = recoverLabelledAmountFromOcrTexts([baseline.text, alternate.text]);
    const recovery = labelled.status === "RECOVERED"
      ? labelled
      : recoverAmountFromOcrTexts([baseline.text, alternate.text]);
    const diagnostic = amountDiagnostic(recovery);
    return {
      amount: recovery.amountSatang,
      diagnostics: ["OCR_LAYOUT_UNAVAILABLE", ...(labelled.status === "RECOVERED" ? [] : ["OCR_AMOUNT_LABEL_MISSING" as OcrDiagnostic]), ...(diagnostic ? [diagnostic] : [])],
    };
  }
  try {
    const normal = await numericPass(input.worker, await sharp(input.primaryImage).extract(region).toBuffer(), "BASELINE");
    const thresholded = await numericPass(input.worker, await sharp(input.primaryImage).extract(region).threshold(185).toBuffer(), "SAUVOLA");
    const recovery = recoverAmountFromOcrTexts([normal, thresholded]);
    if (recovery.status === "RECOVERED") return { amount: recovery.amountSatang, diagnostics: [] };
    // If the baseline boxes were themselves degraded, use the alternate
    // full-receipt pass only to relocate the labelled region. The same normal
    // and thresholded crop agreement rule still applies; this branch is
    // enabled only for the real reinitializable worker so test/legacy mocks
    // retain their bounded call contract.
    if (input.worker.reinitialize) {
      const alternateRegion = amountRegionFromOcrLines(alternate.lines, input.width, input.height);
      const regionDiffers = alternateRegion && (alternateRegion.left !== region.left || alternateRegion.top !== region.top || alternateRegion.width !== region.width || alternateRegion.height !== region.height);
      if (regionDiffers) {
        const alternateNormal = await numericPass(input.worker, await sharp(input.primaryImage).extract(alternateRegion).toBuffer(), "BASELINE");
        const alternateThresholded = await numericPass(input.worker, await sharp(input.primaryImage).extract(alternateRegion).threshold(185).toBuffer(), "SAUVOLA");
        const alternateRecovery = recoverAmountFromOcrTexts([alternateNormal, alternateThresholded]);
        if (alternateRecovery.status === "RECOVERED") return { amount: alternateRecovery.amountSatang, diagnostics: [] };
      }
    }
    // If a crop pass fails, retain the same two-source requirement using the
    // already captured full-receipt evidence. This is a safe degradation, not
    // a one-pass approval: both independent variants must still agree.
    const labelledFallback = recoverLabelledAmountFromOcrTexts([baseline.text, alternate.text]);
    const fallback = labelledFallback.status === "RECOVERED"
      ? labelledFallback
      : recoverAmountFromOcrTexts([baseline.text, alternate.text]);
    const isolatedCandidates = [
      recoverAmountFromOcrTexts([normal, normal]),
      recoverAmountFromOcrTexts([thresholded, thresholded]),
    ].filter((candidate) => candidate.status === "RECOVERED").map((candidate) => candidate.amountSatang);
    if (fallback.status === "RECOVERED" && isolatedCandidates.some((candidate) => candidate !== fallback.amountSatang)) {
      return { amount: null, diagnostics: ["OCR_AMOUNT_AMBIGUOUS"] };
    }
    const diagnostic = amountDiagnostic(fallback);
    return { amount: fallback.amountSatang, diagnostics: diagnostic ? [diagnostic] : [] };
  } catch (error) {
    const passDiagnostic: OcrDiagnostic = isTimeout(error) ? "OCR_PASS_TIMEOUT" : "OCR_PASS_FAILED";
    return { amount: null, diagnostics: [passDiagnostic] };
  }
}

function sourceSuffix(evidence: { text: string; lines: OcrEvidenceLine[] }, height: number): string | null {
  const candidates = recipientSuffixCandidatesFromOcrLines(evidence.lines, height);
  const textCandidates = recipientSuffixCandidatesFromOcrText(evidence.text);
  // Legacy flat-text helper can expose a standalone masked number for field
  // extraction. Automatic evidence must additionally prove that number sits
  // in a recipient-labelled/name-and-mask region; otherwise sender accounts
  // could satisfy suffix consensus when the recipient name is unreadable.
  const scopedTextCandidates = recipientTextRegions(evidence.text).length ? textCandidates : [];
  return candidates.length === 1 ? candidates[0]! : scopedTextCandidates.length === 1 ? scopedTextCandidates[0]! : null;
}

function sourceDate(evidence: { text: string }): string | null {
  const date = transactionDateFromText(evidence.text);
  return date;
}

function sourceStatus(evidence: { text: string }): TransferStatus {
  return transferStatusFromText(evidence.text);
}

function dedupeDiagnostics(diagnostics: OcrDiagnostic[]): OcrDiagnostic[] {
  return [...new Set(diagnostics)];
}

async function readOcr(
  bytes: Uint8Array,
  receiverAliases: string[],
  enabled: boolean,
  isScb: boolean,
  width: number,
  height: number,
  expectedSuffix: string | null,
  qrValid: boolean,
): Promise<OcrResult> {
  if (!enabled) return noOcrResult();
  const startedAt = Date.now();
  let fieldRecoveryDeadline = 0;
  let worker: OcrWorker | null = null;
  let secondaryWorker: OcrWorker | null = null;
  const diagnostics: OcrDiagnostic[] = [];
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await withTimeout(createWorker(["eng", "tha"], undefined, localTesseractOptions()), PRIMARY_OCR_BUDGET_MS) as unknown as OcrWorker;
    const baselineImage = await preprocessOcrImage(bytes, "BASELINE");
    const sauvolaImage = await preprocessOcrImage(bytes, "SAUVOLA");
    const baseline = await withTimeout(recognizeEvidence(worker, baselineImage, "BASELINE"), PRIMARY_OCR_BUDGET_MS - (Date.now() - startedAt));
    const evidence: Array<{ source: string; text: string; lines: OcrEvidenceLine[]; image: Buffer }> = [{ source: "TESSERACT:BASELINE", ...baseline, image: baselineImage }];
    await worker.setParameters({ thresholding_method: "2" });
    const sauvola = await withTimeout(recognizeEvidence(worker, sauvolaImage, "SAUVOLA"), PRIMARY_OCR_BUDGET_MS - (Date.now() - startedAt));
    evidence.push({ source: "TESSERACT:SAUVOLA", ...sauvola, image: sauvolaImage });
    await worker.setParameters({ thresholding_method: "" });

    // All progressive field views share one budget. Without a shared
    // deadline, amount + recipient + date + bank crops could each consume
    // fifteen seconds and exceed the request's safety window.
    fieldRecoveryDeadline = Date.now() + FIELD_RECOVERY_BUDGET_MS;
    const remainingFieldBudget = (): number => Math.min(
      Math.max(0, fieldRecoveryDeadline - Date.now()),
      Math.max(0, ANALYSIS_BUDGET_MS - (Date.now() - startedAt)),
    );
    let amount: { amount: number | null; diagnostics: OcrDiagnostic[] };
    try {
      amount = await withTimeout(structuredAmount({ primaryImage: baselineImage, evidence, worker, width, height }), remainingFieldBudget());
    } catch (error) {
      amount = { amount: null, diagnostics: [isTimeout(error) ? "OCR_PASS_TIMEOUT" : "OCR_PASS_FAILED"] };
    }
    diagnostics.push(...amount.diagnostics);

    if (isScb && remainingFieldBudget() > 0 && !evidence.some((entry) => receiverFromRecipientOcrText(entry.text, receiverAliases))) {
      try {
        let cropWorker = worker;
        if (worker.reinitialize) await worker.reinitialize(["tha"]);
        else {
          const { createWorker } = await import("tesseract.js");
          secondaryWorker = await createWorker(["tha"]) as unknown as OcrWorker;
          cropWorker = secondaryWorker;
        }
        await cropWorker.setParameters({ tessedit_pageseg_mode: "6" });
        const crop = await renderScbRecipient(bytes, width, height);
        const cropThresholded = await renderScbRecipient(bytes, width, height, true);
        const cropNormal = await withTimeout(recognizeEvidence(cropWorker, crop.image, "SCB_RECIPIENT", crop.offset.x, crop.offset.y), remainingFieldBudget());
        const cropThreshold = await withTimeout(recognizeEvidence(cropWorker, cropThresholded.image, "SAUVOLA", crop.offset.x, crop.offset.y), remainingFieldBudget());
        evidence.push({ source: "TESSERACT:SCB_RECIPIENT", ...cropNormal, image: crop.image }, { source: "TESSERACT:SCB_RECIPIENT_SAUVOLA", ...cropThreshold, image: cropThresholded.image });
      } catch (error) {
        diagnostics.push(isTimeout(error) ? "OCR_PASS_TIMEOUT" : "OCR_PASS_FAILED");
      }
    }

    const receiverTexts = evidence.map((entry) => entry.text);
    let receiver = receiverFromRecipientOcrText(receiverTexts[0] ?? "", receiverAliases) ?? receiverFromRecipientOcrText(receiverTexts[1] ?? "", receiverAliases);
    const suffixEvidenceCount = evidence.filter((entry) => sourceSuffix(entry, height) !== null).length;
    if ((!receiver || suffixEvidenceCount < 2) && hasThaiAlias(receiverAliases) && worker.reinitialize && remainingFieldBudget() > 0) {
      // Thai-only CLAHE is the progressive recovery view for character-level
      // errors such as `Wsws`. Crop from the baseline boxes first: a full
      // receipt CLAHE pass is noisy on illustrated backgrounds and would
      // repeatedly OCR fields that already have evidence.
      const crop = await renderRecipientRecovery(bytes, evidence[0]?.lines ?? [], width, height);
      if (crop) {
        try {
          const remaining = remainingFieldBudget();
          await withTimeout(worker.reinitialize(["tha"]), remaining);
          await worker.setParameters({ tessedit_pageseg_mode: "6" });
          const thaiCrop = await withTimeout(recognizeEvidence(worker, crop.normal, "BASELINE", crop.offset.x, crop.offset.y), remainingFieldBudget());
          const thaiCropThreshold = await withTimeout(recognizeEvidence(worker, crop.thresholded, "SAUVOLA", crop.offset.x, crop.offset.y), remainingFieldBudget());
          const thaiClahe = await withTimeout(recognizeEvidence(worker, crop.clahe, "CLAHE", crop.offset.x, crop.offset.y), remainingFieldBudget());
          evidence.push({ source: "TESSERACT:RECIPIENT_CROP", ...thaiCrop, image: crop.normal }, { source: "TESSERACT:RECIPIENT_CROP_THRESHOLD", ...thaiCropThreshold, image: crop.thresholded }, { source: "TESSERACT:RECIPIENT_CROP_CLAHE", ...thaiClahe, image: crop.clahe });
        } catch (error) {
          diagnostics.push(isTimeout(error) ? "OCR_PASS_TIMEOUT" : "OCR_PASS_FAILED");
        }
      }
    }
    if (!receiver && hasThaiAlias(receiverAliases) && !worker.reinitialize && !secondaryWorker) {
      // Compatibility fallback for runtimes whose worker wrapper cannot
      // reinitialize languages. The production Tesseract worker supports
      // reinitialize and never creates a second worker.
      const { createWorker } = await import("tesseract.js");
      const candidateWorker = await createWorker(["tha"]) as unknown as OcrWorker | undefined;
      if (candidateWorker) {
        secondaryWorker = candidateWorker;
        const thaiBaseline = await recognizeEvidence(secondaryWorker, baselineImage, "BASELINE");
        const thaiSauvola = await recognizeEvidence(secondaryWorker, sauvolaImage, "SAUVOLA");
        evidence.push({ source: "TESSERACT:THA_BASELINE", ...thaiBaseline, image: baselineImage }, { source: "TESSERACT:THA_SAUVOLA", ...thaiSauvola, image: sauvolaImage });
      }
    }
    const refreshedReceiverTexts = evidence.map((entry) => entry.text);
    receiver = receiver ?? evidence
      .map((entry) => receiverFromRecipientOcrText(entry.text, receiverAliases))
      .find((value): value is string => Boolean(value)) ?? null;
    if (!receiver && receiverAliases.length) receiver = recoverReceiverFromOcrTexts(refreshedReceiverTexts, receiverAliases);

    let amountValue = amount.amount;
    const suffixCandidates = evidence.map((entry) => ({ suffix: sourceSuffix(entry, height), source: entry.source }));
    let suffixConsensus = consensusRecipientSuffix(suffixCandidates, expectedSuffix);
    let dateConsensus = consensusTransactionDate(evidence.map((entry) => ({ date: sourceDate(entry), source: entry.source })));
    let statusConsensus = consensusTransferStatus(evidence.map((entry) => ({ status: sourceStatus(entry), source: entry.source })));

    if (dateConsensus.value === null && worker.reinitialize && remainingFieldBudget() > 0) {
      const dateCrop = await renderDateRecovery(bytes, evidence[0]?.lines ?? [], width, height);
      if (dateCrop) {
        try {
          const remaining = remainingFieldBudget();
          await withTimeout(worker.reinitialize(["eng", "tha"]), remaining);
          const dateNormal = await withTimeout(recognizeEvidence(worker, dateCrop.normal, "BASELINE", dateCrop.offset.x, dateCrop.offset.y), remainingFieldBudget());
          const dateThresholded = await withTimeout(recognizeEvidence(worker, dateCrop.thresholded, "SAUVOLA", dateCrop.offset.x, dateCrop.offset.y), remainingFieldBudget());
          const dateHighThreshold = await withTimeout(recognizeEvidence(worker, dateCrop.highThreshold, "SAUVOLA", dateCrop.offset.x, dateCrop.offset.y), remainingFieldBudget());
          const dateClahe = await withTimeout(recognizeEvidence(worker, dateCrop.clahe, "CLAHE", dateCrop.offset.x, dateCrop.offset.y), remainingFieldBudget());
          evidence.push({ source: "TESSERACT:DATE_CROP", ...dateNormal, image: dateCrop.normal }, { source: "TESSERACT:DATE_CROP_THRESHOLD", ...dateThresholded, image: dateCrop.thresholded }, { source: "TESSERACT:DATE_CROP_HIGH_THRESHOLD", ...dateHighThreshold, image: dateCrop.highThreshold }, { source: "TESSERACT:DATE_CROP_CLAHE", ...dateClahe, image: dateCrop.clahe });
          dateConsensus = consensusTransactionDate(evidence.map((entry) => ({ date: sourceDate(entry), source: entry.source })));
        } catch (error) {
          diagnostics.push(isTimeout(error) ? "OCR_PASS_TIMEOUT" : "OCR_PASS_FAILED");
        }
      }
    }

    if (qrValid && (!receiver || amountValue === null || suffixConsensus.match === null || dateConsensus.value === null || statusConsensus.status === "UNKNOWN")) {
      try {
        const paddle = await withTimeout(runPaddleOcr(bytes), Math.min(12_000, Math.max(1, ANALYSIS_BUDGET_MS - (Date.now() - startedAt))));
        if (paddle.diagnostic) diagnostics.push(paddle.diagnostic);
        if (paddle.lines.length) {
          const paddleByVariant = ["BASELINE", "CLAHE"]
            .map((variant) => paddle.lines.filter((line) => line.variant === variant))
            .filter((lines) => lines.length);
          // A fallback endpoint must not claim one model invocation is two
          // independent views. Drop byte-for-byte duplicate variants; a
          // single remaining view cannot satisfy any two-source consensus.
          const fingerprints = new Set<string>();
          const paddleEvidence = paddleByVariant.map((lines, index) => ({
            source: `PADDLE:${index === 0 ? "BASELINE" : "CLAHE"}`,
            text: lines.map((line) => line.text).join("\n"),
            lines,
            image: baselineImage,
          })).filter((entry) => {
            const fingerprint = entry.lines.map((line) => `${line.text}\u0000${line.bbox.x0},${line.bbox.y0},${line.bbox.x1},${line.bbox.y1}`).join("\u0001");
            if (fingerprints.has(fingerprint)) return false;
            fingerprints.add(fingerprint);
            return true;
          });
          evidence.push(...paddleEvidence);
          const paddleNames = paddleEvidence.map((entry) => receiverFromRecipientOcrText(entry.text, receiverAliases)).filter((value): value is string => Boolean(value));
          const paddleReceiver = paddleNames.length >= 2 && new Set(paddleNames).size === 1
            ? paddleNames[0]!
            : paddleEvidence.length >= 2 ? recoverReceiverFromOcrTexts(paddleEvidence.map((entry) => entry.text), receiverAliases) : null;
          if (receiver && paddleReceiver && receiver !== paddleReceiver) {
            receiver = null;
            diagnostics.push("OCR_RECEIVER_AMBIGUOUS");
          } else receiver = receiver ?? paddleReceiver;
          const paddleAmounts = paddleEvidence.map((entry) => ({ amountSatang: amountFromLabelledOcrLines(entry.lines), source: entry.source }));
          const paddleAmountConsensus = consensusAmountFromCandidates(paddleAmounts);
          if (amountValue === null && paddleAmountConsensus.value !== null) amountValue = paddleAmountConsensus.value;
          else if (amountValue !== null && paddleAmountConsensus.value !== null && amountValue !== paddleAmountConsensus.value) {
            amountValue = null;
            diagnostics.push("OCR_AMOUNT_AMBIGUOUS");
          }
          suffixConsensus = consensusRecipientSuffix(evidence.map((entry) => ({ suffix: sourceSuffix(entry, height), source: entry.source })), expectedSuffix);
          dateConsensus = consensusTransactionDate(evidence.map((entry) => ({ date: sourceDate(entry), source: entry.source })));
          statusConsensus = consensusTransferStatus(evidence.map((entry) => ({ status: sourceStatus(entry), source: entry.source })));
        }
      } catch (error) {
        // Paddle is optional. Its timeout/failure must preserve all Tesseract
        // and QR evidence already collected, then degrade to REVIEW.
        diagnostics.push(isTimeout(error) ? "OCR_PASS_TIMEOUT" : "OCR_PADDLE_UNAVAILABLE");
      }
    }

    if (!receiver && receiverAliases.length) diagnostics.push("OCR_RECEIVER_NO_MATCH");
    if (expectedSuffix === null || suffixConsensus.status === "MISSING") diagnostics.push("OCR_RECEIVER_SUFFIX_MISSING");
    if (suffixConsensus.status === "CONFLICT" || suffixConsensus.status === "AMBIGUOUS") diagnostics.push("OCR_RECEIVER_SUFFIX_AMBIGUOUS");
    if (suffixConsensus.match === false) diagnostics.push("OCR_RECEIVER_SUFFIX_MISMATCH");
    if (dateConsensus.status === "MISSING") diagnostics.push("OCR_DATE_NO_MATCH");
    if (dateConsensus.status === "CONFLICT" || dateConsensus.status === "AMBIGUOUS") diagnostics.push("OCR_DATE_AMBIGUOUS");
    if (statusConsensus.consensus === "MISSING") diagnostics.push("OCR_TRANSFER_STATUS_UNKNOWN");
    if (statusConsensus.consensus === "CONFLICT" || statusConsensus.consensus === "AMBIGUOUS") diagnostics.push("OCR_TRANSFER_STATUS_CONFLICT");
    if (statusConsensus.status === "NOT_SUCCESS") diagnostics.push("OCR_TRANSFER_NOT_SUCCESS");

    const fields = extractCommonThaiSlipFields(receiverTexts[0] ?? "");
    return {
      amount: amountValue,
      receiver,
      date: dateConsensus.value,
      reference: fields.reference,
      bank: fields.bank,
      recipientProxyMatch: suffixConsensus.match,
      transferStatus: statusConsensus.status,
      diagnostics: dedupeDiagnostics(diagnostics),
    };
  } catch (error) {
    return noOcrResult([isTimeout(error) ? "OCR_PASS_TIMEOUT" : "OCR_PASS_FAILED"]);
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* fail closed; the request is ending */ }
    }
    if (secondaryWorker) {
      try { await secondaryWorker.terminate(); } catch { /* fail closed */ }
    }
  }
}

function decodeQr(greyscale: Buffer, width: number, height: number): string | null {
  try {
    const source = new RGBLuminanceSource(new Uint8ClampedArray(greyscale), width, height);
    const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
    return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
  } catch { return null; }
}

async function decodeQrAttempt(image: Buffer): Promise<string[]> {
  const metadata = await sharp(image).metadata();
  if (!metadata.width || !metadata.height) return [];
  const width = metadata.width;
  const height = metadata.height;
  const halfWidth = Math.ceil(width / 2);
  const halfHeight = Math.ceil(height / 2);
  const regions = [
    { left: 0, top: 0, width, height },
    { left: 0, top: 0, width: halfWidth, height: halfHeight },
    { left: Math.floor(width / 2), top: 0, width: width - Math.floor(width / 2), height: halfHeight },
    { left: 0, top: Math.floor(height / 2), width: halfWidth, height: height - Math.floor(height / 2) },
    { left: Math.floor(width / 2), top: Math.floor(height / 2), width: width - Math.floor(width / 2), height: height - Math.floor(height / 2) },
  ];
  const payloads = await Promise.all(regions.map(async (region) => {
    const greyscale = await sharp(image).extract(region).greyscale().raw().toBuffer();
    return decodeQr(greyscale, region.width, region.height);
  }));
  return payloads.filter((payload): payload is string => Boolean(payload));
}

async function decodeQrCandidates(image: Buffer, rotated = false): Promise<string[]> {
  const attempts: Array<{ angle: number; negate: boolean }> = rotated
    ? [0, 90, 180, 270].flatMap((angle) => [{ angle, negate: false }, { angle, negate: true }])
    : [{ angle: 0, negate: false }];
  const payloads = await Promise.all(attempts.map(async ({ angle, negate }) => {
    const transformed = sharp(image).rotate(angle);
    if (negate) transformed.negate();
    return decodeQrAttempt(await transformed.toBuffer());
  }));
  return [...new Set(payloads.flat())];
}

function extractReference(payload: string | null): { reference: string | null; bank: string | null } {
  if (!payload) return { reference: null, bank: null };
  const reference = payload.match(/(?:transaction|txn|ref(?:erence)?)[=:|\s-]*([A-Z0-9-]{6,})/i)?.[1] ?? null;
  const bank = payload.match(/(?:bank|sender|origin)[=:|\s-]*([A-Z]{2,6}|\d{3})/i)?.[1] ?? null;
  return { reference, bank };
}

export async function analyzeSlip(
  bytes: Uint8Array,
  declaredType: string,
  receiverAliases: string[] = [],
  options: { ocrEnabled?: boolean; recipientProxySuffix?: string | null } = {},
): Promise<SlipAnalysis> {
  const validation = await validateImageUpload({ bytes, declaredType, size: bytes.byteLength });
  if (!validation.ok) throw new Error(validation.reason);
  const normalized = await normalizeOcrImage(bytes);
  const metadata = await sharp(normalized).metadata();
  if (!metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > 4_000_000) throw new Error("Slip image dimensions exceed the allowed limit");

  let candidates = await decodeQrCandidates(normalized);
  let selection = selectSlipQrPayload(candidates);
  if (!selection.qrValid || selection.ambiguous) {
    candidates = [...new Set([...candidates, ...(await decodeQrCandidates(normalized, true))])];
    selection = selectSlipQrPayload(candidates);
  }
  const parsed = extractReference(selection.payload);
  const ocr = await readOcr(normalized, receiverAliases, options.ocrEnabled ?? true, selection.parsed?.sendingBankCode === "014", metadata.width, metadata.height, options.recipientProxySuffix ?? null, selection.qrValid);
  const transactionRef = selection.parsed?.transactionReference ?? parsed.reference ?? ocr.reference;
  const originatingBank = selection.parsed?.sendingBankCode ?? parsed.bank ?? ocr.bank;
  const reasons = selection.qrValid
    ? ["Structurally valid EMV slip QR decoded locally; no bank confirmation"]
    : ["No structurally valid slip verification QR found; local OCR used as heuristic"];
  if (selection.ambiguous) reasons.push("Multiple QR candidates were found; no ambiguous QR payload was used");
  reasons.push(...ocr.diagnostics);
  return {
    imageHash: sha256(bytes),
    qrPayloadHash: selection.payload ? sha256(new TextEncoder().encode(selection.payload)) : null,
    qrValid: selection.qrValid,
    transactionRef,
    originatingBank,
    ocrAmountSatang: ocr.amount,
    ocrReceiver: ocr.receiver,
    ocrTransactionDate: ocr.date,
    recipientProxyMatch: ocr.recipientProxyMatch,
    transferStatus: ocr.transferStatus,
    reasons,
  };
}

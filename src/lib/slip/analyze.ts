import sharp from "sharp";
import { BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { sha256 } from "./hash";
import { validateImageUpload } from "./validate";
import { selectSlipQrPayload } from "./qr";
import {
  amountFromLabelledOcrLines,
  amountRegionFromOcrLines,
  extractCommonThaiSlipFields,
  recoverAmountFromOcrTexts,
  recoverLabelledAmountFromOcrTexts,
  recoverReceiverFromOcrTexts,
  receiverFromOcrText,
  type AmountRecovery,
  type OcrTextLine,
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
  reasons: string[];
}

function decodeQr(greyscale: Buffer, width: number, height: number): string | null {
  try {
    const source = new RGBLuminanceSource(new Uint8ClampedArray(greyscale), width, height);
    const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
    return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
  } catch { return null; }
}

async function decodeQrCandidates(image: Buffer, width: number, height: number): Promise<string[]> {
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
  return [...new Set(payloads.filter((payload): payload is string => Boolean(payload)))];
}

function extractReference(payload: string | null): { reference: string | null; bank: string | null } {
  if (!payload) return { reference: null, bank: null };
  const reference = payload.match(/(?:transaction|txn|ref(?:erence)?)[=:|\s-]*([A-Z0-9-]{6,})/i)?.[1] ?? null;
  const bank = payload.match(/(?:bank|sender|origin)[=:|\s-]*([A-Z]{2,6}|\d{3})/i)?.[1] ?? null;
  return { reference, bank };
}

type OcrDiagnostic =
  | "OCR_LAYOUT_UNAVAILABLE"
  | "OCR_PASS_FAILED"
  | "OCR_AMOUNT_LABEL_MISSING"
  | "OCR_AMOUNT_NO_CANDIDATE"
  | "OCR_AMOUNT_AMBIGUOUS"
  | "OCR_RECEIVER_NO_MATCH"
  | "OCR_DATE_NO_MATCH";

type OcrResult = {
  amount: number | null;
  receiver: string | null;
  date: string | null;
  reference: string | null;
  bank: string | null;
  success: boolean;
  diagnostics: OcrDiagnostic[];
};

function noOcrResult(diagnostics: OcrDiagnostic[] = []): OcrResult {
  return { amount: null, receiver: null, date: null, reference: null, bank: null, success: false, diagnostics };
}

function hasThaiAlias(aliases: readonly string[]): boolean {
  return aliases.some((alias) => /[\u0E00-\u0E7F]/u.test(alias));
}

async function ocrImage(bytes: Uint8Array, threshold = false): Promise<Buffer> {
  const image = sharp(bytes)
    .resize({ width: 2000, fit: "inside", withoutEnlargement: false })
    .greyscale()
    .normalize()
    .sharpen();
  return threshold ? image.threshold(185).toBuffer() : image.toBuffer();
}

function ocrLines(blocks: unknown): OcrTextLine[] {
  if (!Array.isArray(blocks)) return [];
  const lines: OcrTextLine[] = [];
  for (const block of blocks) {
    const paragraphs = typeof block === "object" && block !== null && "paragraphs" in block
      ? (block as { paragraphs?: unknown }).paragraphs
      : null;
    if (!Array.isArray(paragraphs)) continue;
    for (const paragraph of paragraphs) {
      const paragraphLines = typeof paragraph === "object" && paragraph !== null && "lines" in paragraph
        ? (paragraph as { lines?: unknown }).lines
        : null;
      if (!Array.isArray(paragraphLines)) continue;
      for (const line of paragraphLines) {
        if (typeof line !== "object" || line === null) continue;
        const candidate = line as { text?: unknown; confidence?: unknown; bbox?: { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown } };
        const box = candidate.bbox;
        if (typeof candidate.text !== "string" || typeof candidate.confidence !== "number" || !box
          || typeof box.x0 !== "number" || typeof box.y0 !== "number" || typeof box.x1 !== "number" || typeof box.y1 !== "number") continue;
        lines.push({ text: candidate.text, confidence: candidate.confidence, bbox: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 } });
      }
    }
  }
  return lines;
}

function amountDiagnostic(recovery: AmountRecovery): OcrDiagnostic | null {
  if (recovery.status === "AMBIGUOUS") return "OCR_AMOUNT_AMBIGUOUS";
  if (recovery.status === "NO_CANDIDATE") return "OCR_AMOUNT_NO_CANDIDATE";
  return null;
}

async function structuredAmount(input: {
  primaryImage: Buffer;
  primaryText: string;
  blocks: unknown;
  worker: { recognize: (...args: Parameters<Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>["recognize"]>) => ReturnType<Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>["recognize"]>; setParameters: (params: Record<string, string>) => Promise<unknown> };
  psmSingleBlock: string;
}): Promise<{ amount: number | null; diagnostics: OcrDiagnostic[] }> {
  const lines = ocrLines(input.blocks);
  if (!lines.length) {
    try {
      const thresholded = await sharp(input.primaryImage).threshold(185).toBuffer();
      const second = await input.worker.recognize(thresholded);
      const recovery = recoverLabelledAmountFromOcrTexts([input.primaryText, second.data.text]);
      const diagnostic = amountDiagnostic(recovery);
      return { amount: recovery.amountSatang, diagnostics: ["OCR_LAYOUT_UNAVAILABLE", ...(diagnostic ? [diagnostic] : [])] };
    } catch {
      return { amount: null, diagnostics: ["OCR_LAYOUT_UNAVAILABLE", "OCR_PASS_FAILED"] };
    }
  }

  const strongAmount = amountFromLabelledOcrLines(lines);
  if (strongAmount !== null) return { amount: strongAmount, diagnostics: [] };
  const metadata = await sharp(input.primaryImage).metadata();
  const region = metadata.width && metadata.height ? amountRegionFromOcrLines(lines, metadata.width, metadata.height) : null;
  if (!region) return { amount: null, diagnostics: ["OCR_AMOUNT_LABEL_MISSING"] };
  try {
    const normal = await sharp(input.primaryImage).extract(region).toBuffer();
    const thresholded = await sharp(normal).threshold(185).toBuffer();
    await input.worker.setParameters({ tessedit_pageseg_mode: input.psmSingleBlock, tessedit_char_whitelist: "0123456789,. " });
    const normalResult = await input.worker.recognize(normal);
    const thresholdedResult = await input.worker.recognize(thresholded);
    const recovery = recoverAmountFromOcrTexts([normalResult.data.text, thresholdedResult.data.text]);
    const diagnostic = amountDiagnostic(recovery);
    return { amount: recovery.amountSatang, diagnostics: diagnostic ? [diagnostic] : [] };
  } catch {
    return { amount: null, diagnostics: ["OCR_PASS_FAILED"] };
  }
}

async function thaiReceiverTexts(bytes: Uint8Array, isScb: boolean, width: number, height: number): Promise<string[]> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker(["tha"]);
  try {
    const full = await ocrImage(bytes);
    const thresholded = await ocrImage(bytes, true);
    const texts = [
      (await worker.recognize(full)).data.text,
      (await worker.recognize(thresholded)).data.text,
    ];
    if (isScb) {
      const crop = {
        left: Math.floor(width * 0.4),
        top: Math.floor(height * 0.38),
        width: Math.max(1, Math.floor(width * 0.58)),
        height: Math.max(1, Math.floor(height * 0.14)),
      };
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const recipient = await sharp(bytes).extract(crop).resize({ width: 1800, withoutEnlargement: false }).greyscale().normalize().sharpen().toBuffer();
      const recipientThresholded = await sharp(recipient).threshold(185).toBuffer();
      texts.push((await worker.recognize(recipient)).data.text, (await worker.recognize(recipientThresholded)).data.text);
    }
    return texts;
  } finally {
    await worker.terminate();
  }
}

async function readOcr(bytes: Uint8Array, receiverAliases: string[], enabled: boolean, isScb: boolean, width: number, height: number): Promise<OcrResult> {
  if (!enabled) return noOcrResult();
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker(["eng", "tha"]);
    let result: Awaited<ReturnType<typeof worker.recognize>>;
    let amount: { amount: number | null; diagnostics: OcrDiagnostic[] };
    try {
      const primaryImage = await ocrImage(bytes);
      result = await worker.recognize(primaryImage, {}, { text: true, blocks: true });
      amount = await structuredAmount({ primaryImage, primaryText: result.data.text, blocks: result.data.blocks, worker, psmSingleBlock: String(PSM.SINGLE_BLOCK) });
    } finally {
      await worker.terminate();
    }
    const text = result.data.text;
    const fields = extractCommonThaiSlipFields(text);
    let receiver = receiverFromOcrText(text, receiverAliases);
    const diagnostics = [...amount.diagnostics];
    if (!receiver && hasThaiAlias(receiverAliases)) {
      try {
        receiver = recoverReceiverFromOcrTexts(await thaiReceiverTexts(bytes, isScb, width, height), receiverAliases);
      } catch {
        diagnostics.push("OCR_PASS_FAILED");
      }
    }
    if (!receiver && receiverAliases.length) diagnostics.push("OCR_RECEIVER_NO_MATCH");
    if (!fields.transactionDate) diagnostics.push("OCR_DATE_NO_MATCH");
    return { amount: amount.amount, receiver, date: fields.transactionDate, reference: fields.reference, bank: fields.bank, success: fields.success, diagnostics: [...new Set(diagnostics)] };
  } catch { return noOcrResult(["OCR_PASS_FAILED"]); }
}

export async function analyzeSlip(bytes: Uint8Array, declaredType: string, receiverAliases: string[] = [], options: { ocrEnabled?: boolean } = {}): Promise<SlipAnalysis> {
  const validation = await validateImageUpload({ bytes, declaredType, size: bytes.byteLength });
  if (!validation.ok) throw new Error(validation.reason);
  const normalized = await sharp(bytes).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).toBuffer();
  const metadata = await sharp(normalized).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 4000 || metadata.height > 4000 || metadata.width * metadata.height > 16_000_000) throw new Error("Slip image dimensions exceed the allowed limit");
  const candidates = await decodeQrCandidates(normalized, metadata.width, metadata.height);
  const selection = selectSlipQrPayload(candidates);
  const parsed = extractReference(selection.payload);
  const ocr = await readOcr(normalized, receiverAliases, options.ocrEnabled ?? true, selection.parsed?.sendingBankCode === "014", metadata.width, metadata.height);
  const transactionRef = selection.parsed?.transactionReference ?? parsed.reference ?? ocr.reference;
  const originatingBank = selection.parsed?.sendingBankCode ?? parsed.bank ?? ocr.bank;
  const reasons = selection.qrValid
    ? ["Structurally valid EMV slip QR decoded locally; no bank confirmation"]
    : ["No structurally valid slip verification QR found; local OCR used as heuristic"];
  if (selection.ambiguous) reasons.push("Multiple QR candidates were found; no ambiguous QR payload was used");
  if (!ocr.success) reasons.push("OCR could not confirm a transfer-success label");
  reasons.push(...ocr.diagnostics);
  return { imageHash: sha256(bytes), qrPayloadHash: selection.payload ? sha256(new TextEncoder().encode(selection.payload)) : null, qrValid: selection.qrValid, transactionRef, originatingBank, ocrAmountSatang: ocr.amount, ocrReceiver: ocr.receiver, ocrTransactionDate: ocr.date, reasons };
}

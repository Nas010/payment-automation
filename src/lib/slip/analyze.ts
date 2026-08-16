import sharp from "sharp";
import { BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { sha256 } from "./hash";
import { validateImageUpload } from "./validate";
import { selectSlipQrPayload } from "./qr";
import { extractCommonThaiSlipFields, recoverReceiverFromOcrTexts, receiverFromOcrText } from "./ocr";

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

type OcrResult = { amount: number | null; receiver: string | null; date: string | null; reference: string | null; bank: string | null; success: boolean };

function noOcrResult(): OcrResult {
  return { amount: null, receiver: null, date: null, reference: null, bank: null, success: false };
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
  if (!enabled) return { amount: null, receiver: null, date: null, reference: null, bank: null, success: false };
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["eng", "tha"]);
    let result: Awaited<ReturnType<typeof worker.recognize>>;
    try {
      result = await worker.recognize(await ocrImage(bytes));
    } finally {
      await worker.terminate();
    }
    const text = result.data.text.replace(/\s+/g, " ");
    const fields = extractCommonThaiSlipFields(text);
    let receiver = receiverFromOcrText(text, receiverAliases);
    if (!receiver && hasThaiAlias(receiverAliases)) {
      try {
        receiver = recoverReceiverFromOcrTexts(await thaiReceiverTexts(bytes, isScb, width, height), receiverAliases);
      } catch {
        // Thai receiver recovery is additive; retain all primary OCR fields.
      }
    }
    return { amount: fields.amountSatang, receiver, date: fields.transactionDate, reference: fields.reference, bank: fields.bank, success: fields.success };
  } catch { return noOcrResult(); }
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
  return { imageHash: sha256(bytes), qrPayloadHash: selection.payload ? sha256(new TextEncoder().encode(selection.payload)) : null, qrValid: selection.qrValid, transactionRef, originatingBank, ocrAmountSatang: ocr.amount, ocrReceiver: ocr.receiver, ocrTransactionDate: ocr.date, reasons };
}

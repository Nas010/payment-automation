import sharp from "sharp";
import { BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { sha256 } from "./hash";
import { validateImageUpload } from "./validate";
import { selectSlipQrPayload } from "./qr";
import { extractCommonThaiSlipFields, receiverFromOcrText } from "./ocr";

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

async function readOcr(bytes: Uint8Array, receiverAliases: string[]): Promise<{ amount: number | null; receiver: string | null; date: string | null; reference: string | null; bank: string | null; success: boolean }> {
  if (process.env.OCR_ENABLED === "false") return { amount: null, receiver: null, date: null, reference: null, bank: null, success: false };
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["eng", "tha"]);
    const ocrInput = await sharp(bytes)
      .resize({ width: 2000, fit: "inside", withoutEnlargement: false })
      .greyscale()
      .normalize()
      .sharpen()
      .toBuffer();
    const result = await worker.recognize(ocrInput);
    await worker.terminate();
    const text = result.data.text.replace(/\s+/g, " ");
    const fields = extractCommonThaiSlipFields(text);
    return { amount: fields.amountSatang, receiver: receiverFromOcrText(text, receiverAliases), date: fields.transactionDate, reference: fields.reference, bank: fields.bank, success: fields.success };
  } catch { return { amount: null, receiver: null, date: null, reference: null, bank: null, success: false }; }
}

export async function analyzeSlip(bytes: Uint8Array, declaredType: string, receiverAliases: string[] = []): Promise<SlipAnalysis> {
  const validation = await validateImageUpload({ bytes, declaredType, size: bytes.byteLength });
  if (!validation.ok) throw new Error(validation.reason);
  const normalized = await sharp(bytes).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).toBuffer();
  const metadata = await sharp(normalized).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 4000 || metadata.height > 4000 || metadata.width * metadata.height > 16_000_000) throw new Error("Slip image dimensions exceed the allowed limit");
  const candidates = await decodeQrCandidates(normalized, metadata.width, metadata.height);
  const selection = selectSlipQrPayload(candidates);
  const parsed = extractReference(selection.payload);
  const ocr = await readOcr(normalized, receiverAliases);
  const transactionRef = selection.parsed?.transactionReference ?? parsed.reference ?? ocr.reference;
  const originatingBank = selection.parsed?.sendingBankCode ?? parsed.bank ?? ocr.bank;
  const reasons = selection.qrValid
    ? ["Structurally valid EMV slip QR decoded locally; no bank confirmation"]
    : ["No structurally valid slip verification QR found; local OCR used as heuristic"];
  if (selection.ambiguous) reasons.push("Multiple QR candidates were found; no ambiguous QR payload was used");
  if (!ocr.success) reasons.push("OCR could not confirm a transfer-success label");
  return { imageHash: sha256(bytes), qrPayloadHash: selection.payload ? sha256(new TextEncoder().encode(selection.payload)) : null, qrValid: selection.qrValid, transactionRef, originatingBank, ocrAmountSatang: ocr.amount, ocrReceiver: ocr.receiver, ocrTransactionDate: ocr.date, reasons };
}

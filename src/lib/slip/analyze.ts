import sharp from "sharp";
import { BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import { sha256 } from "./hash";
import { validateImageUpload } from "./validate";
import { parseSatang } from "@/lib/money";
import { parseThaiSlipDate } from "@/lib/date";
import { parseEmvQr } from "./qr";

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

function extractReference(payload: string | null): { reference: string | null; bank: string | null } {
  if (!payload) return { reference: null, bank: null };
  const reference = payload.match(/(?:transaction|txn|ref(?:erence)?)[=:|\s-]*([A-Z0-9-]{6,})/i)?.[1] ?? null;
  const bank = payload.match(/(?:bank|sender|origin)[=:|\s-]*([A-Z]{2,6}|\d{3})/i)?.[1] ?? null;
  return { reference, bank };
}

async function readOcr(bytes: Uint8Array): Promise<{ amount: number | null; receiver: string | null; date: string | null }> {
  if (process.env.OCR_ENABLED === "false") return { amount: null, receiver: null, date: null };
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["eng", "tha"]);
    const result = await worker.recognize(Buffer.from(bytes));
    await worker.terminate();
    const text = result.data.text.replace(/\s+/g, " ");
    const amountCandidate = text.match(/(?:฿|THB|บาท)?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/i)?.[0] ?? "";
    const dateCandidate = text.match(/\b\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})\b/)?.[0] ?? "";
    const date = dateCandidate && dateCandidate.length >= 8 ? parseThaiSlipDate(dateCandidate, "Asia/Bangkok")?.toISOString() ?? null : null;
    return { amount: parseSatang(amountCandidate), receiver: null, date };
  } catch { return { amount: null, receiver: null, date: null }; }
}

export async function analyzeSlip(bytes: Uint8Array, declaredType: string): Promise<SlipAnalysis> {
  const validation = await validateImageUpload({ bytes, declaredType, size: bytes.byteLength });
  if (!validation.ok) throw new Error(validation.reason);
  const normalized = await sharp(bytes).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).toBuffer();
  const metadata = await sharp(normalized).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 4000 || metadata.height > 4000 || metadata.width * metadata.height > 16_000_000) throw new Error("Slip image dimensions exceed the allowed limit");
  const greyscale = await sharp(normalized).greyscale().raw().toBuffer();
  const payload = decodeQr(greyscale, metadata.width, metadata.height);
  const emv = payload ? parseEmvQr(payload) : null;
  const parsed = extractReference(payload);
  const ocr = await readOcr(normalized);
  return { imageHash: sha256(bytes), qrPayloadHash: payload ? sha256(new TextEncoder().encode(payload)) : null, qrValid: Boolean(emv), transactionRef: emv?.transactionReference ?? parsed.reference, originatingBank: parsed.bank, ocrAmountSatang: ocr.amount, ocrReceiver: ocr.receiver, ocrTransactionDate: ocr.date, reasons: emv ? ["Structurally valid EMV slip QR decoded locally; no bank confirmation"] : ["No structurally valid slip verification QR found; local OCR used as heuristic"] };
}

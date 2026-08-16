import { createHmac, createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { OcrEvidenceLine, OcrBoundingBox } from "./ocr";

const MAX_PADDLE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

const paddleResponseSchema = z.object({
  version: z.literal(1),
  variants: z.array(z.object({
    id: z.enum(["PADDLE_COLOR", "PADDLE_CLAHE"]),
    items: z.array(z.object({
      text: z.string().max(256),
      score: z.number().finite().min(0).max(1),
      box: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
        .refine(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0),
    })).max(200),
  })).max(2),
});

export type PaddleResponse = z.infer<typeof paddleResponseSchema>;

export type PaddleRunResult = {
  lines: OcrEvidenceLine[];
  diagnostic: "OCR_PADDLE_UNAVAILABLE" | "OCR_PASS_TIMEOUT" | null;
};

function enabled(): boolean {
  return process.env.PADDLE_OCR_FALLBACK_ENABLED === "true";
}

function signature(timestamp: string, body: Uint8Array, secret: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}.${bodyHash}`).digest("hex");
}

function validResponse(value: unknown): PaddleResponse | null {
  const parsed = paddleResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function boxFromPaddle(box: [number, number, number, number]): OcrBoundingBox {
  return { x0: box[0], y0: box[1], x1: box[2], y1: box[3] };
}

export function mapPaddleResponse(response: PaddleResponse): OcrEvidenceLine[] {
  return response.variants.flatMap((variant) => variant.items.map((item) => ({
    text: item.text,
    confidence: item.score,
    bbox: boxFromPaddle(item.box),
    engine: "PADDLE" as const,
    variant: variant.id === "PADDLE_CLAHE" ? "CLAHE" as const : "BASELINE" as const,
  })));
}

/** Calls the private fallback only when explicitly enabled and configured. */
export async function runPaddleOcr(image: Uint8Array): Promise<PaddleRunResult> {
  if (!enabled()) return { lines: [], diagnostic: null };
  const secret = process.env.OCR_INTERNAL_SECRET;
  const url = process.env.OCR_INTERNAL_URL || `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""}/api/paddle-ocr`;
  if (!secret || !url || !url.startsWith("http")) return { lines: [], diagnostic: "OCR_PADDLE_UNAVAILABLE" };
  let body: Buffer;
  try {
    body = await sharp(image).rotate().flatten({ background: "#ffffff" }).removeAlpha().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    return { lines: [], diagnostic: "OCR_PADDLE_UNAVAILABLE" };
  }
  if (body.byteLength > MAX_PADDLE_BYTES) return { lines: [], diagnostic: "OCR_PADDLE_UNAVAILABLE" };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-ocr-timestamp": timestamp,
        "x-ocr-signature": signature(timestamp, body, secret),
        "cache-control": "no-store",
      },
      body: body as unknown as BodyInit,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { lines: [], diagnostic: "OCR_PADDLE_UNAVAILABLE" };
    const parsed = validResponse(await response.json());
    return parsed ? { lines: mapPaddleResponse(parsed), diagnostic: null } : { lines: [], diagnostic: "OCR_PADDLE_UNAVAILABLE" };
  } catch (error) {
    return { lines: [], diagnostic: error instanceof Error && error.name === "AbortError" ? "OCR_PASS_TIMEOUT" : "OCR_PADDLE_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}

import QRCode from "qrcode";
import { runtimeConfig } from "@/lib/runtime-config";
import { buildPaymentPromptPayPayload, InvalidPaymentAmountError } from "@/lib/payments/promptpay";
import { getPaymentByToken } from "@/lib/sheets/payments";

const QR_OPTIONS = { width: 720, margin: 1, errorCorrectionLevel: "M" as const, color: { dark: "#000000", light: "#FFFFFF" } };
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(_request: Request, { params }: { params: Promise<{ publicToken: string }> }): Promise<Response> {
  const { publicToken } = await params;
  let payment;
  try {
    payment = await getPaymentByToken(publicToken);
  } catch {
    return textResponse("Internal Server Error", 500);
  }
  if (!payment) return textResponse("Not Found", 404);
  if (payment.status === "VOID") return textResponse("Not Found", 404);

  let config;
  try {
    config = await runtimeConfig();
  } catch {
    return textResponse("Internal Server Error", 500);
  }

  let payload: string;
  try {
    payload = buildPaymentPromptPayPayload(payment, config);
  } catch (error: unknown) {
    if (error instanceof InvalidPaymentAmountError) return textResponse("Not Found", 404);
    return textResponse("Internal Server Error", 500);
  }

  try {
    const png = await QRCode.toBuffer(payload, QR_OPTIONS);
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", ...NO_STORE_HEADERS } });
  } catch {
    return textResponse("Internal Server Error", 500);
  }
}

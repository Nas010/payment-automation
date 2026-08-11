import QRCode from "qrcode";
import { serverConfig } from "@/lib/config";
import { buildPaymentPromptPayPayload, InvalidPaymentAmountError } from "@/lib/payments/promptpay";
import { getPaymentByToken } from "@/lib/sheets/payments";

const QR_OPTIONS = { width: 720, margin: 1, errorCorrectionLevel: "M" as const, color: { dark: "#000000", light: "#FFFFFF" } };

export async function GET(_request: Request, { params }: { params: Promise<{ publicToken: string }> }): Promise<Response> {
  const { publicToken } = await params;
  let payment;
  try {
    payment = await getPaymentByToken(publicToken);
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
  if (!payment) return new Response("Not Found", { status: 404 });

  let config;
  try {
    config = serverConfig();
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }

  let payload: string;
  try {
    payload = buildPaymentPromptPayPayload(payment, config);
  } catch (error: unknown) {
    if (error instanceof InvalidPaymentAmountError) return new Response("Not Found", { status: 404 });
    return new Response("Internal Server Error", { status: 500 });
  }

  try {
    const png = await QRCode.toBuffer(payload, QR_OPTIONS);
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
}

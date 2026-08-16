import { NextRequest } from "next/server";
import { processSlipImage } from "@/lib/slip/process";
import { getPaymentByToken } from "@/lib/sheets/payments";
import { paymentSubmissionLimiter } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!paymentSubmissionLimiter.allow(`${token}:${forwarded}`)) return Response.json({ error: "Too many slip submissions. Try again later." }, { status: 429 });
  const payment = await getPaymentByToken(token);
  if (!payment) return Response.json({ error: "Payment link not found" }, { status: 404 });
  if (payment.status === "VOID") return Response.json({ error: "This payment request is no longer active" }, { status: 409 });
  if (["AUTO_RECORDED", "MANUAL_CONFIRMED"].includes(payment.status)) return Response.json({ error: "Payment already recorded" }, { status: 409 });
  const form = await request.formData();
  const slip = form.get("slip");
  if (!(slip instanceof File)) return Response.json({ error: "A slip image is required" }, { status: 400 });
  try {
    const bytes = new Uint8Array(await slip.arrayBuffer());
    const result = await processSlipImage({ bytes, declaredType: slip.type, expectedPayment: payment, source: { type: "WEB_UPLOAD" } });
    if (result.duplicate) return Response.json({ status: result.decision, message: "Payment slip already received." });
    return Response.json({ status: result.decision, message: result.decision === "AUTO_RECORDED" ? "Payment slip received and recorded." : "Your payment slip has been received. It will be reviewed." });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Slip processing failed" }, { status: 400 }); }
}

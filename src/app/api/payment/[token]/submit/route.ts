import { NextRequest } from "next/server";
import { analyzeSlip } from "@/lib/slip/analyze";
import { getPaymentByToken, listPayments } from "@/lib/sheets/payments";
import { listSchedules } from "@/lib/sheets/schedules";
import { persistPaymentTransition } from "@/lib/payments/transition";
import { evaluatePayment, sendToReviewForStorageFailure } from "@/lib/payments/evaluate";
import { detectTransactionDuplicate } from "@/lib/payments/duplicates";
import { serverConfig } from "@/lib/config";
import { shouldRetainSlip, storeExceptionSlip } from "@/lib/storage/slip";
import { paymentSubmissionLimiter } from "@/lib/security/rate-limit";
import { parseSatang } from "@/lib/money";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!paymentSubmissionLimiter.allow(`${token}:${forwarded}`)) return Response.json({ error: "Too many slip submissions. Try again later." }, { status: 429 });
  const payment = await getPaymentByToken(token);
  if (!payment) return Response.json({ error: "Payment link not found" }, { status: 404 });
  if (["AUTO_RECORDED", "MANUAL_CONFIRMED"].includes(payment.status)) return Response.json({ error: "Payment already recorded" }, { status: 409 });
  const form = await request.formData();
  const slip = form.get("slip");
  if (!(slip instanceof File)) return Response.json({ error: "A slip image is required" }, { status: 400 });
  try {
    const config = serverConfig();
    const bytes = new Uint8Array(await slip.arrayBuffer());
    const analysis = await analyzeSlip(bytes, slip.type, config.receiverAliases);
    if (payment.slip_hash === analysis.imageHash) return Response.json({ status: payment.status, message: "Payment slip already received." });
    const history = await listPayments();
    const otherPayment = history.find((candidate) => candidate.payment_id !== payment.payment_id && candidate.slip_hash === analysis.imageHash);
    const expectedAmountSatang = parseSatang(payment.amount_thb);
    if (expectedAmountSatang === null || expectedAmountSatang <= 0) throw new Error("Payment amount is invalid");
    let result = evaluatePayment({ paymentId: payment.payment_id, amountSatang: expectedAmountSatang, createdAt: payment.created_at, receiverAliases: config.receiverAliases, timezone: "Asia/Bangkok" }, { imageDuplicate: Boolean(otherPayment), transactionDuplicate: detectTransactionDuplicate(history, payment.payment_id, analysis.originatingBank, analysis.transactionRef), qrValid: analysis.qrValid, transactionRef: analysis.transactionRef ?? undefined, amountSatang: analysis.ocrAmountSatang, receiver: analysis.ocrReceiver, transactionDate: analysis.ocrTransactionDate });
    let slipUrl = payment.slip_url;
    if (shouldRetainSlip(result.decision, config.slipRetentionDays)) {
      try {
        slipUrl = await storeExceptionSlip({ bytes, mimeType: slip.type, paymentId: payment.payment_id, imageHash: analysis.imageHash });
      } catch {
        result = sendToReviewForStorageFailure(result);
      }
    }
    const next = { ...payment, status: result.decision, submitted_at: new Date().toISOString(), recorded_at: result.decision === "AUTO_RECORDED" ? new Date().toISOString() : payment.recorded_at, slip_hash: analysis.imageHash, qr_payload_hash: analysis.qrPayloadHash ?? "", qr_valid: String(analysis.qrValid), transaction_ref: analysis.transactionRef ?? "", originating_bank: analysis.originatingBank ?? "", ocr_amount: analysis.ocrAmountSatang === null ? "" : String(analysis.ocrAmountSatang / 100), ocr_receiver: analysis.ocrReceiver ?? "", ocr_transaction_date: analysis.ocrTransactionDate ?? "", amount_match: String(result.amountMatch), receiver_match: String(result.receiverMatch), date_match: String(result.dateMatch), check_score: String(result.score), review_reason: result.reasons.join("; "), slip_url: slipUrl, updated_at: new Date().toISOString() };
    const schedule = (await listSchedules()).find((item) => item.payment_id === payment.payment_id);
    if (!schedule) throw new Error("Payment is not linked to an installment schedule");
    await persistPaymentTransition({ payment, schedule, nextStatus: result.decision, source: "CLIENT_UPLOAD", reason: result.reasons.join("; "), paymentUpdate: next });
    return Response.json({ status: result.decision, message: result.decision === "AUTO_RECORDED" ? "Payment slip received and recorded." : "Your payment slip has been received. It will be reviewed." });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Slip processing failed" }, { status: 400 }); }
}

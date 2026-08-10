import { NextRequest } from "next/server";
import { analyzeSlip } from "@/lib/slip/analyze";
import { appendAudit, getPaymentByToken, listPayments, updatePayment } from "@/lib/sheets/payments";
import { evaluatePayment } from "@/lib/payments/evaluate";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const payment = await getPaymentByToken(token);
  if (!payment) return Response.json({ error: "Payment link not found" }, { status: 404 });
  if (["AUTO_RECORDED", "MANUAL_CONFIRMED"].includes(payment.status)) return Response.json({ error: "Payment already recorded" }, { status: 409 });
  const form = await request.formData();
  const slip = form.get("slip");
  if (!(slip instanceof File)) return Response.json({ error: "A slip image is required" }, { status: 400 });
  try {
    const analysis = await analyzeSlip(new Uint8Array(await slip.arrayBuffer()), slip.type);
    if (payment.slip_hash === analysis.imageHash) return Response.json({ status: payment.status, message: "Payment slip already received." });
    const otherPayment = (await listPayments()).find((candidate) => candidate.payment_id !== payment.payment_id && candidate.slip_hash === analysis.imageHash);
    const result = evaluatePayment({ paymentId: payment.payment_id, amountSatang: Math.round(Number(payment.amount_thb) * 100), createdAt: payment.created_at, receiverAliases: [], timezone: "Asia/Bangkok" }, { imageDuplicate: Boolean(otherPayment), transactionDuplicate: false, qrValid: analysis.qrValid, transactionRef: analysis.transactionRef ?? undefined, amountSatang: analysis.ocrAmountSatang, receiver: analysis.ocrReceiver, transactionDate: analysis.ocrTransactionDate });
    const next = { ...payment, status: result.decision, submitted_at: new Date().toISOString(), recorded_at: result.decision === "AUTO_RECORDED" ? new Date().toISOString() : payment.recorded_at, slip_hash: analysis.imageHash, qr_valid: String(analysis.qrValid), transaction_ref: analysis.transactionRef ?? "", originating_bank: analysis.originatingBank ?? "", ocr_amount: analysis.ocrAmountSatang === null ? "" : String(analysis.ocrAmountSatang / 100), ocr_receiver: analysis.ocrReceiver ?? "", ocr_transaction_date: analysis.ocrTransactionDate ?? "", amount_match: String(result.amountMatch), receiver_match: String(result.receiverMatch), date_match: String(result.dateMatch), check_score: String(result.score), review_reason: result.reasons.join("; "), updated_at: new Date().toISOString() };
    await updatePayment(next);
    await appendAudit({ paymentId: payment.payment_id, clientId: payment.client_id, action: result.decision === "AUTO_RECORDED" ? "AUTO_RECORDED" : result.decision === "FLAGGED" ? "FLAGGED" : "SENT_TO_REVIEW", previousStatus: payment.status, newStatus: result.decision, reason: result.reasons.join("; "), source: "CLIENT_UPLOAD" });
    return Response.json({ status: result.decision, message: result.decision === "AUTO_RECORDED" ? "Payment slip received and recorded." : "Your payment slip has been received. It will be reviewed." });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Slip processing failed" }, { status: 400 }); }
}

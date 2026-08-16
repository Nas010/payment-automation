import { detectTransactionDuplicate } from "@/lib/payments/duplicates";
import { evaluatePayment, type Decision, type Evaluation } from "@/lib/payments/evaluate";
import { parseSatang } from "@/lib/money";
import { appendAudit, getPaymentById, listPayments, updatePaymentIfUnchanged, type PaymentRecord } from "@/lib/sheets/payments";
import { readDriveSlipFile } from "@/lib/storage/drive-client";
import { analyzeSlip, type SlipAnalysis } from "./analyze";
import { privacySafeOcrDiagnostics } from "./diagnostics";

export type ReprocessSlipInput = {
  paymentId: string;
  receiverAliases: string[];
  ocrEnabled: boolean;
  applyEvidence?: boolean;
};

export type ReprocessSlipReport = {
  applied: boolean;
  decision: Decision;
  score: number;
  checks: {
    qrValid: boolean;
    transactionReferenceDetected: boolean;
    amountDetected: boolean;
    amountMatchesExpected: boolean;
    transactionDateDetected: boolean;
    receiverRecovered: boolean;
  };
  diagnostics: string[];
};

export type ReprocessSlipDependencies = {
  getPaymentById: typeof getPaymentById;
  listPayments: typeof listPayments;
  readDriveSlipFile: typeof readDriveSlipFile;
  analyzeSlip: typeof analyzeSlip;
  evaluatePayment: typeof evaluatePayment;
  updatePaymentIfUnchanged: typeof updatePaymentIfUnchanged;
  appendAudit: typeof appendAudit;
  now: () => string;
};

const defaultDependencies: ReprocessSlipDependencies = {
  getPaymentById,
  listPayments,
  readDriveSlipFile,
  analyzeSlip,
  evaluatePayment,
  updatePaymentIfUnchanged,
  appendAudit,
  now: () => new Date().toISOString(),
};

function driveFileId(url: string): string | null {
  const fileId = url.match(/[?&]id=([^&]+)/)?.[1] ?? url.match(/\/d\/([^/]+)/)?.[1] ?? null;
  if (!fileId) return null;
  try {
    return decodeURIComponent(fileId);
  } catch {
    return null;
  }
}

function eligiblePayment(payment: PaymentRecord): void {
  if (!payment.payment_id) throw new Error("Payment was not found");
  if (!new Set(["REVIEW", "FLAGGED"]).has(payment.status)) throw new Error("Only REVIEW or FLAGGED payments can be reprocessed");
}

function declaredImageType(value: string): "image/jpeg" | "image/png" | "image/webp" {
  const type = value.split(";", 1)[0]!.trim().toLowerCase();
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") return type;
  throw new Error("Private slip is unavailable.");
}

function evaluateReprocessedPayment(payment: PaymentRecord, history: PaymentRecord[], analysis: SlipAnalysis, receiverAliases: string[], evaluate: typeof evaluatePayment): Evaluation {
  const expectedAmountSatang = parseSatang(payment.amount_thb);
  if (expectedAmountSatang === null || expectedAmountSatang <= 0) throw new Error("Payment amount is invalid");
  return evaluate(
    { paymentId: payment.payment_id, amountSatang: expectedAmountSatang, createdAt: payment.created_at, receiverAliases, timezone: "Asia/Bangkok" },
    {
      imageDuplicate: history.some((candidate) => candidate.payment_id !== payment.payment_id && candidate.slip_hash === analysis.imageHash),
      transactionDuplicate: detectTransactionDuplicate(history, payment.payment_id, analysis.originatingBank, analysis.transactionRef),
      qrValid: analysis.qrValid,
      transactionRef: analysis.transactionRef ?? undefined,
      amountSatang: analysis.ocrAmountSatang,
      receiver: analysis.ocrReceiver,
      transactionDate: analysis.ocrTransactionDate,
    },
  );
}

function evidenceUpdate(payment: PaymentRecord, analysis: SlipAnalysis, evaluation: Evaluation, now: string): PaymentRecord {
  return {
    ...payment,
    slip_hash: analysis.imageHash,
    qr_payload_hash: analysis.qrPayloadHash ?? "",
    qr_valid: String(analysis.qrValid),
    transaction_ref: analysis.transactionRef ?? "",
    originating_bank: analysis.originatingBank ?? "",
    ocr_amount: analysis.ocrAmountSatang === null ? "" : String(analysis.ocrAmountSatang / 100),
    ocr_receiver: analysis.ocrReceiver ?? "",
    ocr_transaction_date: analysis.ocrTransactionDate ?? "",
    amount_match: String(evaluation.amountMatch),
    receiver_match: String(evaluation.receiverMatch),
    date_match: String(evaluation.dateMatch),
    check_score: String(evaluation.score),
    review_reason: "OCR_RECHECK_PASSED; MANUAL_CONFIRMATION_REQUIRED",
    updated_at: now,
  };
}

export async function reprocessStoredSlipEvidence(input: ReprocessSlipInput, dependencies: ReprocessSlipDependencies = defaultDependencies): Promise<ReprocessSlipReport> {
  const initial = await dependencies.getPaymentById(input.paymentId);
  if (!initial) throw new Error("Payment was not found");
  eligiblePayment(initial);
  const fileId = driveFileId(initial.slip_url);
  if (!fileId) throw new Error("Retained private slip is unavailable");
  const stored = await dependencies.readDriveSlipFile(fileId);
  const declaredType = declaredImageType(stored.declaredMimeType);
  const receiverAliases = [...input.receiverAliases];
  const analysis = await dependencies.analyzeSlip(stored.bytes, declaredType, receiverAliases, { ocrEnabled: input.ocrEnabled });

  const history = await dependencies.listPayments();
  const payment = history.find((candidate) => candidate.payment_id === input.paymentId);
  if (!payment || payment.slip_url !== initial.slip_url) throw new Error("Payment changed during OCR recheck");
  eligiblePayment(payment);
  const evaluation = evaluateReprocessedPayment(payment, history, analysis, receiverAliases, dependencies.evaluatePayment);
  const report: ReprocessSlipReport = {
    applied: false,
    decision: evaluation.decision,
    score: evaluation.score,
    checks: {
      qrValid: analysis.qrValid,
      transactionReferenceDetected: Boolean(analysis.transactionRef),
      amountDetected: analysis.ocrAmountSatang !== null,
      amountMatchesExpected: evaluation.amountMatch,
      transactionDateDetected: analysis.ocrTransactionDate !== null,
      receiverRecovered: evaluation.receiverMatch,
    },
    diagnostics: privacySafeOcrDiagnostics(analysis.reasons),
  };
  if (!input.applyEvidence) return report;
  if (evaluation.decision !== "AUTO_RECORDED") throw new Error("Evidence apply requires all checks to pass");

  const updated = evidenceUpdate(payment, analysis, evaluation, dependencies.now());
  if (!await dependencies.updatePaymentIfUnchanged({ expectedPayment: payment, payment: updated })) {
    throw new Error("Payment changed before OCR evidence update");
  }
  await dependencies.appendAudit({
    paymentId: payment.payment_id,
    clientId: payment.client_id,
    action: "OCR_EVIDENCE_REANALYZED",
    previousStatus: payment.status,
    newStatus: payment.status,
    reason: "OCR evidence refreshed; manual confirmation remains required",
    source: "ADMIN",
    metadata: JSON.stringify({ evidenceUpdated: true }),
  });
  return { ...report, applied: true };
}

import { serverConfig } from "@/lib/config";
import { detectTransactionDuplicate } from "@/lib/payments/duplicates";
import { evaluatePayment, sendToReviewForStorageFailure, type Evaluation } from "@/lib/payments/evaluate";
import { persistPaymentTransition, type PaymentStatus, type TransitionSource } from "@/lib/payments/transition";
import { parseSatang } from "@/lib/money";
import { listPayments, type PaymentRecord } from "@/lib/sheets/payments";
import { listSchedules, type ScheduleRecord } from "@/lib/sheets/schedules";
import { shouldRetainSlip, storeExceptionSlip } from "@/lib/storage/slip";
import { analyzeSlip, type SlipAnalysis } from "./analyze";

export type SlipSource =
  | { type: "WEB_UPLOAD" }
  | { type: "LINE"; lineUserId: string; lineMessageId: string; clientId: string };

export type ProcessSlipImageInput = {
  bytes: Uint8Array;
  declaredType: string;
  expectedPayment: PaymentRecord;
  source: SlipSource;
  analysis?: SlipAnalysis;
};

export type SlipProcessDependencies = {
  analyzeSlip: (bytes: Uint8Array, declaredType: string, receiverAliases: string[]) => Promise<SlipAnalysis>;
  listPayments: () => Promise<PaymentRecord[]>;
  listSchedules: () => Promise<ScheduleRecord[]>;
  evaluatePayment: typeof evaluatePayment;
  persistPaymentTransition: typeof persistPaymentTransition;
  shouldRetainSlip: (status: string) => boolean;
  storeExceptionSlip: typeof storeExceptionSlip;
  receiverAliases: string[];
  now: () => string;
};

export type SlipProcessResult = {
  decision: PaymentStatus;
  duplicate: boolean;
  analysis: SlipAnalysis | null;
  evaluation: Evaluation | null;
  payment: PaymentRecord;
};

function defaultDependencies(): SlipProcessDependencies {
  const config = serverConfig();
  return {
    analyzeSlip,
    listPayments,
    listSchedules,
    evaluatePayment,
    persistPaymentTransition,
    shouldRetainSlip: (status) => shouldRetainSlip(status, config.slipRetentionDays),
    storeExceptionSlip,
    receiverAliases: config.receiverAliases,
    now: () => new Date().toISOString(),
  };
}

function sameTransactionReference(payment: PaymentRecord, analysis: SlipAnalysis): boolean {
  return Boolean(analysis.originatingBank && analysis.transactionRef)
    && payment.originating_bank === analysis.originatingBank
    && payment.transaction_ref === analysis.transactionRef;
}

function samePaymentDuplicate(payment: PaymentRecord, analysis: SlipAnalysis): boolean {
  return payment.slip_hash === analysis.imageHash || sameTransactionReference(payment, analysis);
}

function updatedPayment(payment: PaymentRecord, analysis: SlipAnalysis, evaluation: Evaluation, source: SlipSource, now: string, slipUrl: string): PaymentRecord {
  const terminal = new Set<PaymentStatus>(["AUTO_RECORDED", "MANUAL_CONFIRMED"]).has(evaluation.decision);
  return {
    ...payment,
    status: evaluation.decision,
    submitted_at: now,
    recorded_at: evaluation.decision === "AUTO_RECORDED" ? now : payment.recorded_at,
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
    review_reason: evaluation.reasons.join("; "),
    slip_url: slipUrl,
    ...(source.type === "LINE" ? {
      line_source_message_id: source.lineMessageId,
      line_slip_received_at: now,
      line_slip_processing_status: evaluation.decision,
      line_slip_error: "",
      ...(terminal ? { line_slip_expected: "FALSE" } : {}),
    } : {}),
    updated_at: now,
  };
}

function transitionSource(source: SlipSource): TransitionSource {
  return source.type === "LINE" ? "LINE_WEBHOOK" : "CLIENT_UPLOAD";
}

function assertLineAssociation(payment: PaymentRecord, source: SlipSource): void {
  if (source.type === "LINE" && source.clientId !== payment.client_id) {
    throw new Error("LINE payment client association does not match");
  }
}

function authoritativePayment(history: PaymentRecord[], paymentId: string): PaymentRecord {
  const payment = history.find((candidate) => candidate.payment_id === paymentId);
  if (!payment) throw new Error("Payment no longer exists");
  return payment;
}

function terminalOrReplayed(payment: PaymentRecord, source: SlipSource): boolean {
  return ["AUTO_RECORDED", "MANUAL_CONFIRMED"].includes(payment.status)
    || (source.type === "LINE" && Boolean(source.lineMessageId) && payment.line_source_message_id === source.lineMessageId);
}

/** Processes one submitted slip without depending on an HTTP transport. */
export async function processSlipImage(input: ProcessSlipImageInput, injected?: SlipProcessDependencies): Promise<SlipProcessResult> {
  const dependencies = injected ?? defaultDependencies();
  let history = await dependencies.listPayments();
  let payment = authoritativePayment(history, input.expectedPayment.payment_id);
  assertLineAssociation(payment, input.source);
  const existingAnalysis = input.analysis ?? null;
  if (terminalOrReplayed(payment, input.source)) {
    return { decision: payment.status as PaymentStatus, duplicate: true, analysis: existingAnalysis, evaluation: null, payment };
  }
  const analysis = input.analysis ?? await dependencies.analyzeSlip(input.bytes, input.declaredType, dependencies.receiverAliases);
  history = await dependencies.listPayments();
  payment = authoritativePayment(history, input.expectedPayment.payment_id);
  assertLineAssociation(payment, input.source);
  if (terminalOrReplayed(payment, input.source) || samePaymentDuplicate(payment, analysis)) {
    return { decision: payment.status as PaymentStatus, duplicate: true, analysis, evaluation: null, payment };
  }

  const imageDuplicate = history.some((candidate) => candidate.payment_id !== payment.payment_id && candidate.slip_hash === analysis.imageHash);
  const transactionDuplicate = detectTransactionDuplicate(history, payment.payment_id, analysis.originatingBank, analysis.transactionRef);
  const expectedAmountSatang = parseSatang(payment.amount_thb);
  if (expectedAmountSatang === null || expectedAmountSatang <= 0) throw new Error("Payment amount is invalid");
  let evaluation = dependencies.evaluatePayment(
    { paymentId: payment.payment_id, amountSatang: expectedAmountSatang, createdAt: payment.created_at, receiverAliases: dependencies.receiverAliases, timezone: "Asia/Bangkok" },
    { imageDuplicate, transactionDuplicate, qrValid: analysis.qrValid, transactionRef: analysis.transactionRef ?? undefined, amountSatang: analysis.ocrAmountSatang, receiver: analysis.ocrReceiver, transactionDate: analysis.ocrTransactionDate },
  );

  let slipUrl = payment.slip_url;
  if (dependencies.shouldRetainSlip(evaluation.decision)) {
    try {
      slipUrl = await dependencies.storeExceptionSlip({ bytes: input.bytes, mimeType: input.declaredType, paymentId: payment.payment_id, imageHash: analysis.imageHash });
    } catch {
      evaluation = sendToReviewForStorageFailure(evaluation);
      slipUrl = "";
    }
  }

  const schedule = (await dependencies.listSchedules()).find((item) => item.payment_id === payment.payment_id);
  if (!schedule) throw new Error("Payment is not linked to an installment schedule");
  const now = dependencies.now();
  const nextPayment = updatedPayment(payment, analysis, evaluation, input.source, now, slipUrl);
  await dependencies.persistPaymentTransition({
    payment,
    schedule,
    nextStatus: evaluation.decision,
    source: transitionSource(input.source),
    reason: evaluation.reasons.join("; "),
    paymentUpdate: nextPayment,
    now,
  });
  return { decision: evaluation.decision, duplicate: false, analysis, evaluation, payment: nextPayment };
}

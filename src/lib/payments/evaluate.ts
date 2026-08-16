import { bangkokDateKey } from "@/lib/date";

export type Decision = "AUTO_RECORDED" | "REVIEW" | "FLAGGED";

export interface EvaluationPayment {
  paymentId: string;
  amountSatang: number;
  createdAt: string;
  receiverAliases: string[];
  timezone: "Asia/Bangkok";
}

export interface SlipSignals {
  imageDuplicate: boolean;
  transactionDuplicate: boolean;
  qrValid: boolean;
  transactionRef?: string;
  amountSatang: number | null;
  receiver: string | null;
  transactionDate: string | null;
  /** New evidence fields are optional for old callers; production paths always set them. */
  recipientProxyMatch?: boolean | null;
  transferStatus?: "SUCCESS" | "NOT_SUCCESS" | "UNKNOWN";
}

export interface Evaluation {
  decision: Decision;
  score: number;
  reasons: string[];
  amountMatch: boolean;
  receiverMatch: boolean;
  dateMatch: boolean;
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\p{P}\s]/gu, "").toUpperCase();
}

function matchesReceiver(receiver: string | null, aliases: string[]): boolean {
  if (!receiver) return false;
  const actual = normalizeName(receiver);
  return aliases.some((alias) => {
    const expected = normalizeName(alias);
    return expected.length >= 3 && (actual.includes(expected) || expected.includes(actual));
  });
}

function plausibleDate(value: string | null, createdAt: string): boolean {
  if (!value) return false;
  const transaction = new Date(value);
  const created = new Date(createdAt);
  if (Number.isNaN(transaction.getTime()) || Number.isNaN(created.getTime())) return false;
  return bangkokDateKey(transaction) >= bangkokDateKey(created) && transaction.getTime() <= Date.now() + 86_400_000;
}

export function evaluatePayment(payment: EvaluationPayment, signals: SlipSignals): Evaluation {
  const reasons: string[] = [];
  const amountMatch = signals.amountSatang === payment.amountSatang;
  const hasEvidencePolicy = "recipientProxyMatch" in signals || "transferStatus" in signals;
  // Legacy direct callers predate suffix/status evidence. All application
  // entrypoints pass the fields, so missing evidence there remains REVIEW.
  const receiverNameMatch = matchesReceiver(signals.receiver, payment.receiverAliases);
  const recipientProxyMatch = hasEvidencePolicy ? signals.recipientProxyMatch ?? null : true;
  const receiverMatch = hasEvidencePolicy
    ? receiverNameMatch && recipientProxyMatch === true
    : receiverNameMatch;
  const dateMatch = plausibleDate(signals.transactionDate, payment.createdAt);
  const transferStatus = hasEvidencePolicy ? signals.transferStatus ?? "UNKNOWN" : "SUCCESS";

  if (signals.imageDuplicate) reasons.push("Exact slip image is already allocated to another payment");
  if (signals.transactionDuplicate) reasons.push("Transaction reference is already allocated to another payment");
  if (signals.amountSatang !== null && !amountMatch) reasons.push("Slip amount differs from expected amount");
  if (signals.receiver && !receiverNameMatch) reasons.push("Slip recipient does not match configured recipient");
  if (hasEvidencePolicy && recipientProxyMatch === false) reasons.push("Slip recipient proxy suffix does not match configured recipient");
  if (hasEvidencePolicy && transferStatus === "NOT_SUCCESS") reasons.push("Slip transfer status is not successful");

  if (reasons.length > 0) return { decision: "FLAGGED", score: 0, reasons, amountMatch, receiverMatch, dateMatch };

  const complete = signals.qrValid && Boolean(signals.transactionRef) && amountMatch && receiverMatch && dateMatch
    && (!hasEvidencePolicy || (recipientProxyMatch === true && transferStatus === "SUCCESS"));
  if (complete) return { decision: "AUTO_RECORDED", score: 100, reasons: ["All operational checks passed; not bank verified"], amountMatch, receiverMatch, dateMatch };

  if (!signals.qrValid) reasons.push("Slip verification QR missing or invalid");
  if (!signals.transactionRef) reasons.push("Transaction reference unavailable");
  if (signals.amountSatang === null) reasons.push("Amount could not be extracted");
  if (!receiverMatch) reasons.push("Recipient match uncertain");
  if (!dateMatch) reasons.push("Transaction date unavailable or unusual");
  if (hasEvidencePolicy && recipientProxyMatch === null) reasons.push("Recipient proxy suffix evidence is missing or conflicting");
  if (hasEvidencePolicy && transferStatus === "UNKNOWN") reasons.push("Transfer status evidence is missing or conflicting");
  return { decision: "REVIEW", score: [signals.qrValid, amountMatch, receiverMatch, dateMatch, !hasEvidencePolicy || transferStatus === "SUCCESS"].filter(Boolean).length * 20, reasons, amountMatch, receiverMatch, dateMatch };
}

export function sendToReviewForStorageFailure(evaluation: Evaluation): Evaluation {
  return {
    ...evaluation,
    decision: "REVIEW",
    reasons: [...evaluation.reasons, "Private slip storage failed; manual review is required"],
  };
}

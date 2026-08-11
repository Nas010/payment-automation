import { parseSatang } from "@/lib/money";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { SlipAnalysis } from "@/lib/slip/analyze";

const PLAUSIBLE_DUE_DATE_DISTANCE_DAYS = 7;
const DAY_MS = 86_400_000;

function dueDateDistance(payment: PaymentRecord, transactionDate: string | null): number | null {
  if (!transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(payment.due_date)) return null;
  const dueDate = new Date(`${payment.due_date}T12:00:00+07:00`);
  const transaction = new Date(transactionDate);
  if (Number.isNaN(dueDate.getTime()) || Number.isNaN(transaction.getTime())) return null;
  const distance = Math.abs(dueDate.getTime() - transaction.getTime()) / DAY_MS;
  return distance <= PLAUSIBLE_DUE_DATE_DISTANCE_DAYS ? distance : null;
}

/** Resolves only unambiguous candidates; caller sends null results to review. */
export function resolveLinePaymentCandidate(payments: PaymentRecord[], analysis: SlipAnalysis): PaymentRecord | null {
  if (payments.length === 1) return payments[0] ?? null;
  if (!payments.length) return null;

  const amountMatches = analysis.ocrAmountSatang === null
    ? payments
    : payments.filter((payment) => parseSatang(payment.amount_thb) === analysis.ocrAmountSatang);
  if (amountMatches.length === 1) return amountMatches[0] ?? null;
  if (!amountMatches.length) return null;

  const dated = amountMatches
    .map((payment) => ({ payment, distance: dueDateDistance(payment, analysis.ocrTransactionDate) }))
    .filter((candidate): candidate is { payment: PaymentRecord; distance: number } => candidate.distance !== null);
  if (!dated.length) return null;
  const shortestDistance = Math.min(...dated.map((candidate) => candidate.distance));
  const closest = dated.filter((candidate) => candidate.distance === shortestDistance);
  return closest.length === 1 ? closest[0]?.payment ?? null : null;
}

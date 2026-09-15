import { parseSatang } from "@/lib/money";
import { assignmentIdForSchedule } from "@/lib/plans/assignment-lifecycle";
import { parseReminderDeliveryLog } from "@/lib/line/reminder-delivery";
import { updatePaymentRecordsAndSchedules, type PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";

export async function correctPayment(input: { payment: PaymentRecord; payments: PaymentRecord[]; schedules: ScheduleRecord[]; amountThb: string; reason: string; undoConfirmation: boolean }): Promise<void> {
  const { payment, reason, undoConfirmation } = input;
  const amount = parseSatang(input.amountThb);
  if (amount === null || amount <= 0 || !Number.isSafeInteger(amount)) throw new Error("Enter a positive THB amount.");
  if (!reason.trim()) throw new Error("A correction reason is required.");
  if (!["PENDING", "REVIEW", "FLAGGED", "MANUAL_CONFIRMED", "AUTO_RECORDED"].includes(payment.status)) throw new Error("This payment cannot be corrected.");
  if (undoConfirmation && payment.status !== "MANUAL_CONFIRMED") throw new Error("Only a manual confirmation can be undone.");
  if (/^TRANSITION_EFFECTS_/.test(payment.line_slip_error)) throw new Error("Payment confirmation is still being saved. Retry shortly.");
  const matches = input.schedules.filter((row) => row.payment_id === payment.payment_id);
  const schedule = matches[0];
  if (matches.length !== 1 || schedule.client_id !== payment.client_id || !["GENERATED", "PAID", "REVIEW", "FLAGGED"].includes(schedule.status)) throw new Error("An active linked payment schedule is required.");
  const group = input.schedules.filter((row) => row.client_id === payment.client_id && assignmentIdForSchedule(row) === assignmentIdForSchedule(schedule));
  const correctedAmount = String(amount / 100);
  const total = group.reduce((sum, row) => {
    const value = row.schedule_id === schedule.schedule_id ? amount : parseSatang(row.amount_thb);
    if (value === null || value <= 0) throw new Error("The payment plan contains an invalid amount.");
    return sum + value;
  }, 0);
  if (!Number.isSafeInteger(total)) throw new Error("The payment plan total is too large.");
  const now = new Date().toISOString();
  const groupPaymentIds = new Set(group.map((row) => row.payment_id));
  const related = input.payments.filter((row) => groupPaymentIds.has(row.payment_id)).map((row) => row.payment_id === payment.payment_id ? payment : row);
  if (!related.some((row) => row.payment_id === payment.payment_id)) throw new Error("Payment snapshot is incomplete.");
  const updates = related.map((row) => {
    if (row.client_id !== payment.client_id) throw new Error("Payment plan ownership does not match.");
    const reminders = parseReminderDeliveryLog(row.line_reminder_delivery_log);
    if (["SENDING", "FAILED_RETRYABLE"].includes(row.line_message_status)
      || Object.values(reminders.deliveries).some((delivery) => delivery && ["SENDING", "FAILED_RETRYABLE"].includes(delivery.status))
      || ["DOWNLOADING", "ANALYZING"].includes(row.line_slip_processing_status)) throw new Error("Payment delivery or processing is in progress. Retry after it finishes.");
    const target = row.payment_id === payment.payment_id;
    const updated = { ...row, total_price_thb: String(total / 100), updated_at: now, ...(target ? {
      amount_thb: correctedAmount,
      ...(row.amount_thb !== correctedAmount ? { amount_match: "", check_score: "" } : {}),
      ...(undoConfirmation ? { status: "REVIEW", manual_confirmed_at: "", recorded_at: "", line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED", review_reason: `Manual confirmation undone: ${reason.trim()}` } : {}),
    } : {}) };
    return { expectedPayment: row, payment: updated };
  });
  const nextStatus = undoConfirmation ? "REVIEW" : payment.status;
  const updatedSchedule = { ...schedule, amount_thb: correctedAmount, status: undoConfirmation ? "GENERATED" : ["MANUAL_CONFIRMED", "AUTO_RECORDED"].includes(payment.status) ? "PAID" : schedule.status, updated_at: now };
  const success = await updatePaymentRecordsAndSchedules({ updates, scheduleUpdates: group.map((row) => ({ expectedSchedule: row, schedule: row.schedule_id === schedule.schedule_id ? updatedSchedule : row })), audit: {
    paymentId: payment.payment_id, clientId: payment.client_id, action: undoConfirmation ? "MANUAL_CONFIRMATION_UNDONE" : "PAYMENT_AMOUNT_CORRECTED", previousStatus: payment.status, newStatus: nextStatus, reason: reason.trim(), source: "ADMIN",
    metadata: JSON.stringify({ scheduleId: schedule.schedule_id, previousAmountThb: payment.amount_thb, correctedAmountThb: correctedAmount, previousManualConfirmedAt: payment.manual_confirmed_at, previousRecordedAt: payment.recorded_at }),
  } });
  if (!success) throw new Error("Payment or schedule changed. Refresh and try again.");
}

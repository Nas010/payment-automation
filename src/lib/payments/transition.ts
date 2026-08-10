import { appendAudit, updatePayment, type PaymentRecord } from "@/lib/sheets/payments";
import { updateSchedule, type ScheduleRecord } from "@/lib/sheets/schedules";

export type PaymentStatus = "PENDING" | "REVIEW" | "FLAGGED" | "AUTO_RECORDED" | "MANUAL_CONFIRMED";
export type ScheduleStatus = "SCHEDULED" | "GENERATED" | "PAID";
export type TransitionSource = "ADMIN" | "CLIENT_UPLOAD" | "SYSTEM" | "CRON_RECONCILIATION";

export type PaymentTransitionInput = {
  paymentStatus: PaymentStatus;
  scheduleStatus: ScheduleStatus;
  nextStatus: PaymentStatus;
  source?: TransitionSource;
};

export type PaymentTransition = { paymentStatus: PaymentStatus; scheduleStatus: ScheduleStatus };

const terminalStatuses = new Set<PaymentStatus>(["AUTO_RECORDED", "MANUAL_CONFIRMED"]);

export function transitionPayment(input: PaymentTransitionInput): PaymentTransition {
  const source = input.source ?? (input.nextStatus === "MANUAL_CONFIRMED" ? "ADMIN" : "SYSTEM");
  if (input.nextStatus === "AUTO_RECORDED" && source === "ADMIN") throw new Error("AUTO_RECORDED is system-only");
  if (input.nextStatus === "MANUAL_CONFIRMED" && source !== "ADMIN" && source !== "CRON_RECONCILIATION") throw new Error("MANUAL_CONFIRMED requires an admin source");
  if (terminalStatuses.has(input.paymentStatus) && input.paymentStatus !== input.nextStatus) throw new Error(`Cannot transition terminal payment ${input.paymentStatus}`);
  if (input.paymentStatus === input.nextStatus) return { paymentStatus: input.paymentStatus, scheduleStatus: input.scheduleStatus };
  if (input.nextStatus === "PENDING") throw new Error("Cannot transition a payment back to PENDING");
  if (input.nextStatus === "MANUAL_CONFIRMED" && !["PENDING", "REVIEW", "FLAGGED"].includes(input.paymentStatus)) throw new Error(`Cannot manually confirm ${input.paymentStatus}`);
  if (input.nextStatus === "AUTO_RECORDED" && input.paymentStatus !== "PENDING") throw new Error(`Cannot auto-record ${input.paymentStatus}`);
  if (["REVIEW", "FLAGGED"].includes(input.nextStatus) && input.paymentStatus !== "PENDING") throw new Error(`Cannot transition ${input.paymentStatus} to ${input.nextStatus}`);

  return {
    paymentStatus: input.nextStatus,
    scheduleStatus: terminalStatuses.has(input.nextStatus) ? "PAID" : input.scheduleStatus,
  };
}

export async function persistPaymentTransition(input: {
  payment: PaymentRecord;
  schedule: ScheduleRecord;
  nextStatus: PaymentStatus;
  source: TransitionSource;
  reason: string;
  paymentUpdate?: Partial<PaymentRecord>;
  now?: string;
}): Promise<PaymentTransition> {
  if (input.schedule.payment_id !== input.payment.payment_id) throw new Error("Payment is not linked to the supplied schedule");
  const transition = transitionPayment({
    paymentStatus: input.payment.status as PaymentStatus,
    scheduleStatus: input.schedule.status as ScheduleStatus,
    nextStatus: input.nextStatus,
    source: input.source,
  });
  const now = input.now ?? new Date().toISOString();
  await updatePayment({
    ...input.payment,
    ...input.paymentUpdate,
    status: transition.paymentStatus,
    recorded_at: transition.paymentStatus === "AUTO_RECORDED" ? now : input.payment.recorded_at,
    manual_confirmed_at: transition.paymentStatus === "MANUAL_CONFIRMED" ? now : input.payment.manual_confirmed_at,
    updated_at: now,
  });
  if (transition.scheduleStatus !== input.schedule.status) {
    await updateSchedule({ ...input.schedule, status: transition.scheduleStatus, updated_at: now });
  }
  await appendAudit({
    paymentId: input.payment.payment_id,
    clientId: input.payment.client_id,
    action: transition.paymentStatus,
    previousStatus: input.payment.status,
    newStatus: transition.paymentStatus,
    reason: input.reason,
    source: input.source,
    metadata: JSON.stringify({ scheduleId: input.schedule.schedule_id }),
  });
  return transition;
}

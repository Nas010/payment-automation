import { randomUUID } from "node:crypto";
import { appendAudit, updatePaymentIfUnchanged, type PaymentRecord } from "@/lib/sheets/payments";
import { hasPaymentTransitionAudit } from "@/lib/sheets/audit";
import { updateSchedule, type ScheduleRecord } from "@/lib/sheets/schedules";

export type PaymentStatus = "PENDING" | "REVIEW" | "FLAGGED" | "AUTO_RECORDED" | "MANUAL_CONFIRMED";
export type ScheduleStatus = "SCHEDULED" | "GENERATED" | "PAID";
export type TransitionSource = "ADMIN" | "CLIENT_UPLOAD" | "LINE_WEBHOOK" | "SYSTEM" | "CRON_RECONCILIATION";

export type PaymentTransitionInput = {
  paymentStatus: PaymentStatus;
  scheduleStatus: ScheduleStatus;
  nextStatus: PaymentStatus;
  source?: TransitionSource;
};

export type PaymentTransition = { paymentStatus: PaymentStatus; scheduleStatus: ScheduleStatus };

const terminalStatuses = new Set<PaymentStatus>(["AUTO_RECORDED", "MANUAL_CONFIRMED"]);
const terminalEffectsMarkerPrefix = "TRANSITION_EFFECTS_PENDING:";
const terminalEffectsClaimPrefix = "TRANSITION_EFFECTS_CLAIMED:";
const terminalEffectsLeaseMs = 5 * 60 * 1000;

type TerminalEffectsProvenance = { source: TransitionSource; previousStatus: PaymentStatus };
type TerminalEffectsMarker = TerminalEffectsProvenance & { kind: "PENDING" | "CLAIMED"; leaseExpiresAt?: number };

function terminalEffectsMarker(source: TransitionSource, previousStatus: PaymentStatus): string {
  return `${terminalEffectsMarkerPrefix}${source}:${previousStatus}`;
}

function claimedTerminalEffectsMarker(provenance: TerminalEffectsProvenance, now: string): string {
  return `${terminalEffectsClaimPrefix}${provenance.source}:${provenance.previousStatus}:${Date.parse(now) + terminalEffectsLeaseMs}:${randomUUID()}`;
}

function parseTerminalEffectsMarker(value: string): TerminalEffectsMarker | null {
  const pending = new RegExp(`^${terminalEffectsMarkerPrefix}(ADMIN|CLIENT_UPLOAD|LINE_WEBHOOK|SYSTEM|CRON_RECONCILIATION):(PENDING|REVIEW|FLAGGED)$`).exec(value);
  if (pending) return { kind: "PENDING", source: pending[1] as TransitionSource, previousStatus: pending[2] as PaymentStatus };
  const claimed = new RegExp(`^${terminalEffectsClaimPrefix}(ADMIN|CLIENT_UPLOAD|LINE_WEBHOOK|SYSTEM|CRON_RECONCILIATION):(PENDING|REVIEW|FLAGGED):(\\d+):[0-9a-f-]{36}$`).exec(value);
  if (!claimed) return null;
  const leaseExpiresAt = Number(claimed[3]);
  if (!Number.isSafeInteger(leaseExpiresAt)) return null;
  return { kind: "CLAIMED", source: claimed[1] as TransitionSource, previousStatus: claimed[2] as PaymentStatus, leaseExpiresAt };
}

function terminalEffectsIdentity(payment: PaymentRecord, schedule: ScheduleRecord, provenance: TerminalEffectsProvenance) {
  return { paymentId: payment.payment_id, action: payment.status, source: provenance.source, scheduleId: schedule.schedule_id };
}

async function claimTerminalEffects(payment: PaymentRecord, now: string): Promise<{ payment: PaymentRecord; provenance: TerminalEffectsProvenance } | null> {
  const marker = parseTerminalEffectsMarker(payment.line_slip_error);
  if (!marker) return null;
  const nowAt = Date.parse(now);
  if (!Number.isFinite(nowAt)) throw new Error("Terminal effects reconciliation requires a valid clock");
  if (marker.kind === "CLAIMED" && marker.leaseExpiresAt! > nowAt) return null;
  const provenance = { source: marker.source, previousStatus: marker.previousStatus };
  const claimed = { ...payment, line_slip_error: claimedTerminalEffectsMarker(provenance, now), updated_at: now };
  if (!await updatePaymentIfUnchanged({ expectedPayment: payment, payment: claimed })) return null;
  return { payment: claimed, provenance };
}

async function releaseTerminalEffectsClaim(payment: PaymentRecord, provenance: TerminalEffectsProvenance, now: string): Promise<void> {
  try {
    await updatePaymentIfUnchanged({ expectedPayment: payment, payment: { ...payment, line_slip_error: terminalEffectsMarker(provenance.source, provenance.previousStatus), updated_at: now } });
  } catch {
    // A competing owner can safely recover an expired claim.
  }
}

/** Replays terminal schedule/audit effects only after claiming the exact durable marker. */
export async function reconcileTerminalPaymentEffects(input: {
  payment: PaymentRecord;
  schedule: ScheduleRecord;
  now?: string;
}): Promise<boolean> {
  if (!terminalStatuses.has(input.payment.status as PaymentStatus)) return false;
  if (input.schedule.payment_id !== input.payment.payment_id) throw new Error("Payment is not linked to the supplied schedule");
  const now = input.now ?? new Date().toISOString();
  const claimed = await claimTerminalEffects(input.payment, now);
  if (!claimed) return false;
  try {
    if (input.schedule.status !== "PAID") {
      await updateSchedule({ ...input.schedule, status: "PAID", updated_at: now });
    }
    const identity = terminalEffectsIdentity(claimed.payment, input.schedule, claimed.provenance);
    if (!await hasPaymentTransitionAudit(identity)) {
      try {
        await appendAudit({
          paymentId: claimed.payment.payment_id,
          clientId: claimed.payment.client_id,
          action: claimed.payment.status,
          previousStatus: claimed.provenance.previousStatus,
          newStatus: claimed.payment.status,
          reason: "Terminal transition effects reconciled",
          source: claimed.provenance.source,
          metadata: JSON.stringify({ scheduleId: input.schedule.schedule_id }),
        });
      } catch (error) {
        if (!await hasPaymentTransitionAudit(identity)) throw error;
      }
    }
    const cleared = { ...claimed.payment, line_slip_error: "", updated_at: now };
    if (!await updatePaymentIfUnchanged({ expectedPayment: claimed.payment, payment: cleared })) throw new Error("Payment changed before terminal effects reconciliation");
    return true;
  } catch (error) {
    await releaseTerminalEffectsClaim(claimed.payment, claimed.provenance, now);
    throw error;
  }
}

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
  const paymentUpdate = {
    ...input.payment,
    ...input.paymentUpdate,
    status: transition.paymentStatus,
    recorded_at: transition.paymentStatus === "AUTO_RECORDED" ? now : input.payment.recorded_at,
    manual_confirmed_at: transition.paymentStatus === "MANUAL_CONFIRMED" ? now : input.payment.manual_confirmed_at,
    ...(terminalStatuses.has(transition.paymentStatus) ? {
      line_slip_expected: "FALSE",
      line_slip_error: terminalEffectsMarker(input.source, input.payment.status as PaymentStatus),
    } : {}),
    updated_at: now,
  };
  if (!await updatePaymentIfUnchanged({ expectedPayment: input.payment, payment: paymentUpdate })) throw new Error("Payment changed before transition");
  if (terminalStatuses.has(transition.paymentStatus)) {
    await reconcileTerminalPaymentEffects({ payment: paymentUpdate, schedule: input.schedule, now });
  } else {
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
  }
  return transition;
}

import { randomUUID } from "node:crypto";
import { buildPaymentForSchedule, planTotalSatangForSchedule, selectPaymentGenerationSchedules } from "@/lib/plans/schedule";
import { appendAudit, appendPayment, getPaymentById, listPayments, updatePaymentIfUnchanged, type NewPaymentRecord } from "@/lib/sheets/payments";
import { listSchedules, updateScheduleIfUnchanged, type ScheduleRecord } from "@/lib/sheets/schedules";
import { createPublicToken } from "./token";

export type DuePaymentGenerationResult = {
  created: NewPaymentRecord[];
  existing: ScheduleRecord[];
  failed: Array<{ scheduleId: string; error: string }>;
};

export type GenerateDuePaymentLinksOptions = {
  baseUrl: string;
  today?: string;
  now?: string;
  createPaymentId?: () => string;
  createToken?: () => string;
  scheduleIds?: string[];
  remindersOnly?: boolean;
};

function bangkokDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/** Generates payment links only for due rows in canonical Installment Schedule. */
export async function generateDuePaymentLinks(options: GenerateDuePaymentLinksOptions): Promise<DuePaymentGenerationResult> {
  const today = options.today ?? bangkokDate();
  const now = options.now ?? new Date().toISOString();
  const [schedules, payments] = await Promise.all([listSchedules(), listPayments()]);
  const forced = options.scheduleIds ? new Set(options.scheduleIds) : null;
  const selected = forced
    ? schedules.filter((schedule) => forced.has(schedule.schedule_id) && schedule.status === "SCHEDULED" && !schedule.payment_id
      && (schedule.payment_type === "ONE_TIME" || schedule.installment_number === "1"))
    : selectPaymentGenerationSchedules(schedules, today);
  const candidates = options.remindersOnly
    ? selected.filter((schedule) => schedule.payment_type === "INSTALLMENTS" && Number(schedule.installment_number) > 1)
    : selected;
  const existing = schedules.filter((schedule) => schedule.due_date <= today && (schedule.status !== "SCHEDULED" || Boolean(schedule.payment_id)));
  const result: DuePaymentGenerationResult = { created: [], existing, failed: [] };

  for (const schedule of candidates) {
    if (payments.some((payment) => payment.payment_id === schedule.payment_id)) {
      result.existing.push(schedule);
      continue;
    }
    try {
      const planTotalSatang = planTotalSatangForSchedule(schedule, schedules);
      const payment = buildPaymentForSchedule(schedule, {
        paymentId: options.createPaymentId?.() ?? `pay_${randomUUID().replaceAll("-", "")}`,
        publicToken: options.createToken?.() ?? createPublicToken(),
        baseUrl: options.baseUrl,
        createdAt: now,
        planTotalSatang,
      });
      await appendPayment(payment);
      const generatedSchedule = { ...schedule, status: "GENERATED", generated_at: now, payment_id: payment.payment_id, payment_url: payment.payment_url, updated_at: now };
      if (!await updateScheduleIfUnchanged({ expectedSchedule: schedule, schedule: generatedSchedule })) {
        const appendedPayment = await getPaymentById(payment.payment_id);
        if (!appendedPayment) throw new Error("Fresh payment could not be found for revocation");
        if (appendedPayment.status !== "VOID") {
          if (appendedPayment.status !== "PENDING") throw new Error("Fresh payment changed before revocation");
          const voidedPayment = { ...appendedPayment, status: "VOID", line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED", updated_at: now };
          if (!await updatePaymentIfUnchanged({ expectedPayment: appendedPayment, payment: voidedPayment })) {
            const currentPayment = await getPaymentById(payment.payment_id);
            if (currentPayment?.status !== "VOID") throw new Error("Fresh payment changed before revocation");
          }
        }
        throw new Error("Schedule changed before payment link generation");
      }
      await appendAudit({
        paymentId: payment.payment_id,
        clientId: payment.client_id,
        action: "PAYMENT_LINK_GENERATED",
        previousStatus: "",
        newStatus: "PENDING",
        reason: `Due-date link created for installment ${schedule.installment_number} of ${schedule.installment_count}`,
        source: "SCHEDULE_GENERATOR",
        metadata: JSON.stringify({ scheduleId: schedule.schedule_id, paymentUrl: payment.payment_url }),
      });
      result.created.push(payment);
    } catch (error) {
      result.failed.push({ scheduleId: schedule.schedule_id, error: error instanceof Error ? error.message : "Payment link generation failed" });
    }
  }
  return result;
}

/** @deprecated Use generateDuePaymentLinks; kept for callers that still expect a payment array. */
export async function generateMonthlyPayments(_period: string, baseUrl: string): Promise<NewPaymentRecord[]> {
  return (await generateDuePaymentLinks({ baseUrl })).created;
}

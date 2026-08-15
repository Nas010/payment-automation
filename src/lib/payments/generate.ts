import { randomUUID } from "node:crypto";
import { buildPaymentForSchedule, planTotalSatangForSchedule, selectPaymentGenerationSchedules } from "@/lib/plans/schedule";
import { appendAudit, appendPayment, listPayments, type NewPaymentRecord } from "@/lib/sheets/payments";
import { listSchedules, updateSchedule, type ScheduleRecord } from "@/lib/sheets/schedules";
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
  const candidates = selectPaymentGenerationSchedules(schedules, today);
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
      await updateSchedule({ ...schedule, status: "GENERATED", generated_at: now, payment_id: payment.payment_id, payment_url: payment.payment_url, updated_at: now });
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

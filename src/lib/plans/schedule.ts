import { parseSatang } from "@/lib/money";
import type { NewPaymentRecord } from "@/lib/sheets/payments";

export type InstallmentPlanInput = {
  totalSatang: number;
  installmentCount: number;
  intervalMonths: number;
  firstDueDate: string;
};

export type PlannedInstallment = {
  installmentNumber: number;
  amountSatang: number;
  dueDate: string;
};

type DueSchedule = {
  schedule_id: string;
  due_date: string;
  status: string;
  payment_id: string;
};

type PaymentSchedule = Partial<DueSchedule> & {
  schedule_id: string;
  client_id: string;
  client_name: string;
  line_display_name: string;
  package_name: string;
  payment_type: string;
  installment_number: string;
  installment_count: string;
  amount_thb: string;
  due_date: string;
  created_at: string;
};

type PlanSchedule = Pick<PaymentSchedule, "client_id" | "package_name" | "installment_count" | "amount_thb"> & {
  payment_type: string;
  installment_number: string;
  created_at: string;
};

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("firstDueDate must be YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("firstDueDate must be a valid date");
  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

export function buildInstallmentPlan(input: InstallmentPlanInput): PlannedInstallment[] {
  if (!Number.isSafeInteger(input.totalSatang) || input.totalSatang <= 0) throw new Error("totalSatang must be a positive integer");
  if (!Number.isInteger(input.installmentCount) || input.installmentCount < 1) throw new Error("installmentCount must be a positive integer");
  if (!Number.isInteger(input.intervalMonths) || input.intervalMonths < 0 || (input.installmentCount > 1 && input.intervalMonths < 1)) throw new Error("intervalMonths must be valid for the installment count");

  const firstDueDate = parseDateOnly(input.firstDueDate);
  const baseAmount = Math.floor(input.totalSatang / input.installmentCount);
  const remainder = input.totalSatang - baseAmount * input.installmentCount;
  return Array.from({ length: input.installmentCount }, (_, index) => ({
    installmentNumber: index + 1,
    amountSatang: baseAmount + (index === input.installmentCount - 1 ? remainder : 0),
    dueDate: formatDateOnly(addMonthsClamped(firstDueDate, index * input.intervalMonths)),
  }));
}

export function selectDueSchedules<T extends DueSchedule>(schedules: readonly T[], today: string): T[] {
  parseDateOnly(today);
  return schedules.filter((schedule) => schedule.status === "SCHEDULED" && !schedule.payment_id && schedule.due_date <= today);
}

type PaymentGenerationSchedule = DueSchedule & { payment_type: string; installment_number: string };

function addCalendarDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatDateOnly(parsed);
}

/** Selects normal due rows plus later installments whose T-7 generation date has arrived. */
export function selectPaymentGenerationSchedules<T extends PaymentGenerationSchedule>(schedules: readonly T[], today: string): T[] {
  parseDateOnly(today);
  const sevenDaysAhead = addCalendarDays(today, 7);
  return schedules.filter((schedule) => schedule.status === "SCHEDULED" && !schedule.payment_id && (
    schedule.due_date <= today
    || (schedule.payment_type === "INSTALLMENTS" && Number(schedule.installment_number) > 1 && schedule.due_date <= sevenDaysAhead)
  ));
}

export function planTotalSatangForSchedule(target: PlanSchedule, schedules: readonly PlanSchedule[]): number {
  const expectedCount = Number(target.installment_count);
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) throw new Error("Schedule installment count is invalid");
  const group = schedules.filter((item) => item.client_id === target.client_id
    && item.package_name === target.package_name
    && item.payment_type === target.payment_type
    && item.installment_count === target.installment_count
    && item.created_at === target.created_at);
  const positions = group.map((item) => Number(item.installment_number)).sort((left, right) => left - right);
  if (group.length !== expectedCount || positions.some((position, index) => position !== index + 1)) {
    throw new Error("Schedule plan group is incomplete");
  }
  return group.reduce((total, item) => {
    const amount = parseSatang(item.amount_thb);
    if (amount === null || amount <= 0) throw new Error("Schedule plan amount is invalid");
    return total + amount;
  }, 0);
}

export function buildPaymentForSchedule(schedule: PaymentSchedule, input: { paymentId: string; publicToken: string; baseUrl: string; createdAt: string; planTotalSatang: number }): NewPaymentRecord {
  const amountSatang = parseSatang(schedule.amount_thb);
  if (amountSatang === null || amountSatang <= 0) throw new Error(`Schedule ${schedule.schedule_id} has an invalid amount`);
  parseDateOnly(schedule.due_date);
  const installmentNumber = Number(schedule.installment_number);
  const installmentCount = Number(schedule.installment_count);
  if (schedule.payment_type !== "ONE_TIME" && schedule.payment_type !== "INSTALLMENTS") throw new Error(`Schedule ${schedule.schedule_id} has an invalid payment type`);
  if (!Number.isSafeInteger(installmentNumber) || !Number.isSafeInteger(installmentCount) || installmentNumber < 1 || installmentCount < 1 || installmentNumber > installmentCount) {
    throw new Error(`Schedule ${schedule.schedule_id} has an invalid installment position`);
  }
  if (!Number.isSafeInteger(input.planTotalSatang) || input.planTotalSatang <= 0) throw new Error(`Schedule ${schedule.schedule_id} has an invalid plan total`);
  const paymentUrl = `${input.baseUrl.replace(/\/$/, "")}/p/${input.publicToken}`;
  return {
    payment_id: input.paymentId,
    client_id: schedule.client_id,
    client_name: schedule.client_name,
    period: schedule.due_date.slice(0, 7),
    amount_thb: schedule.amount_thb,
    due_date: schedule.due_date,
    public_token: input.publicToken,
    payment_url: paymentUrl,
    status: "PENDING",
    created_at: input.createdAt,
    submitted_at: "",
    recorded_at: "",
    manual_confirmed_at: "",
    transaction_ref: "",
    originating_bank: "",
    slip_hash: "",
    qr_valid: "",
    ocr_amount: "",
    amount_match: "",
    ocr_receiver: "",
    receiver_match: "",
    ocr_transaction_date: "",
    date_match: "",
    check_score: "",
    review_reason: "",
    slip_url: "",
    admin_notes: "",
    line_message: "",
    updated_at: input.createdAt,
    qr_payload_hash: "",
    line_message_status: "",
    line_retry_key: "",
    line_message_attempted_at: "",
    line_message_sent_at: "",
    line_request_id: "",
    line_message_error: "",
    line_payment_requested_at: "",
    line_slip_expected: "",
    line_slip_received_at: "",
    line_source_message_id: "",
    line_slip_processing_status: "",
    line_slip_error: "",
    line_reply_status: "",
    line_reply_at: "",
    package_name: schedule.package_name,
    payment_type: schedule.payment_type,
    installment_number: schedule.installment_number,
    installment_count: schedule.installment_count,
    total_price_thb: String(input.planTotalSatang / 100),
    line_terms_image_token: "",
    line_reminder_delivery_log: "",
  };
}

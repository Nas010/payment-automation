import { z } from "zod";

import { parseSatang } from "@/lib/money";
import { buildInstallmentPlan, buildPaymentForSchedule } from "@/lib/plans/schedule";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import { eligibleReminderSlots, emptyReminderDeliveryLog, reminderDate } from "./reminder-delivery";
import { REMINDER_SLOTS, type ReminderSlot } from "./message-profile";

export const LINE_MESSAGE_TEST_PROFILE_SETTING_KEY = "line_message_test_profile";
export const LINE_MESSAGE_TEST_SUBJECT_ID = "line-message-test-profile";

export type LineMessageTestDetails = {
  clientName: string;
  packageName: string;
  totalPriceThb: string;
  paymentType: "ONE_TIME" | "INSTALLMENTS";
  installmentCount: number;
  intervalMonths: number;
  firstDueDate: string;
};

export type LineMessageTestProfile = LineMessageTestDetails & {
  version: 1;
  lineUserId: string;
  lineDisplayName: string;
  linePictureUrl: string;
  lineLinkStatus: "" | "LINK_ACTIVE" | "LINKED" | "REVIEW";
  lineLinkedAt: string;
  lineLinkError: string;
  lineLinkTokenHash: string;
  lineLinkTokenEncrypted: string;
  lineLinkTokenExpiresAt: string;
  updatedAt: string;
};

export type LineMessageTestAdminView = Omit<
  LineMessageTestProfile,
  "lineUserId" | "lineLinkTokenHash" | "lineLinkTokenEncrypted" | "lineLinkTokenExpiresAt"
>;

export type LineMessageTestScenario =
  | { paymentType: "ONE_TIME"; stage: "INITIAL" }
  | { paymentType: "INSTALLMENTS"; stage: "INITIAL" }
  | { paymentType: "INSTALLMENTS"; stage: "LATER"; installmentNumber: number; reminderSlot: ReminderSlot };

export type LineMessageTestFixture = {
  client: ClientRecord;
  schedules: ScheduleRecord[];
  payment: PaymentRecord;
  simulatedToday: string | null;
};

const detailsSchema = z.object({
  clientName: z.string().trim().min(1),
  packageName: z.string().trim().min(1),
  totalPriceThb: z.string().trim().min(1),
  paymentType: z.enum(["ONE_TIME", "INSTALLMENTS"]),
  installmentCount: z.coerce.number().int().min(1),
  intervalMonths: z.coerce.number().int().min(0),
  firstDueDate: z.string().trim().min(1),
}).strict();

const profileSchema = detailsSchema.extend({
  version: z.literal(1),
  lineUserId: z.string(),
  lineDisplayName: z.string(),
  linePictureUrl: z.string(),
  lineLinkStatus: z.enum(["", "LINK_ACTIVE", "LINKED", "REVIEW"]),
  lineLinkedAt: z.string(),
  lineLinkError: z.string(),
  lineLinkTokenHash: z.string(),
  lineLinkTokenEncrypted: z.string(),
  lineLinkTokenExpiresAt: z.string(),
  updatedAt: z.string(),
}).strict();

const oneTimeInitialScenarioSchema = z.object({
  paymentType: z.literal("ONE_TIME"),
  stage: z.literal("INITIAL"),
}).strict();
const installmentInitialScenarioSchema = z.object({
  paymentType: z.literal("INSTALLMENTS"),
  stage: z.literal("INITIAL"),
}).strict();
const laterInstallmentScenarioSchema = z.object({
  paymentType: z.literal("INSTALLMENTS"),
  stage: z.literal("LATER"),
  installmentNumber: z.coerce.number().int().positive(),
  reminderSlot: z.enum(REMINDER_SLOTS),
}).strict();
const scenarioSchema = z.union([
  oneTimeInitialScenarioSchema,
  installmentInitialScenarioSchema,
  laterInstallmentScenarioSchema,
]);

function parseTotalSatang(totalPriceThb: string): number {
  const totalSatang = parseSatang(totalPriceThb);
  if (totalSatang === null || !Number.isSafeInteger(totalSatang) || totalSatang <= 0) {
    throw new Error("LINE message test total price must be a positive safe THB value");
  }
  return totalSatang;
}

function normalizeParsedDetails(input: z.infer<typeof detailsSchema>): LineMessageTestDetails {
  const details: LineMessageTestDetails = input.paymentType === "ONE_TIME"
    ? { ...input, installmentCount: 1, intervalMonths: 0 }
    : input;
  const totalSatang = parseTotalSatang(details.totalPriceThb);

  if (details.paymentType === "INSTALLMENTS" && details.installmentCount < 2) {
    throw new Error("LINE message test installments require at least two payments");
  }
  if (details.paymentType === "INSTALLMENTS" && details.intervalMonths < 1) {
    throw new Error("LINE message test installments require an interval of at least one month");
  }

  buildInstallmentPlan({
    totalSatang,
    installmentCount: details.installmentCount,
    intervalMonths: details.intervalMonths,
    firstDueDate: details.firstDueDate,
  });
  return details;
}

function normalizeDetails(value: unknown): LineMessageTestDetails {
  const result = detailsSchema.safeParse(value);
  if (!result.success) throw new Error("LINE message test details shape is invalid");
  return normalizeParsedDetails(result.data);
}

function parseTimestamp(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function timestampForDate(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function thbFromSatang(satang: number): string {
  return String(satang / 100);
}

export function createDefaultLineMessageTestProfile(today: string): LineMessageTestProfile {
  const details = normalizeDetails({
    clientName: "LINE test recipient",
    packageName: "LINE message test",
    totalPriceThb: "1000.00",
    paymentType: "ONE_TIME",
    installmentCount: 1,
    intervalMonths: 0,
    firstDueDate: today,
  });
  return {
    version: 1,
    ...details,
    lineUserId: "",
    lineDisplayName: "",
    linePictureUrl: "",
    lineLinkStatus: "",
    lineLinkedAt: "",
    lineLinkError: "",
    lineLinkTokenHash: "",
    lineLinkTokenEncrypted: "",
    lineLinkTokenExpiresAt: "",
    updatedAt: timestampForDate(today),
  };
}

export function parseLineMessageTestDetails(value: unknown): LineMessageTestDetails {
  return normalizeDetails(value);
}

export function parseLineMessageTestProfile(value: unknown): LineMessageTestProfile {
  let decoded: unknown = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      throw new Error("LINE message test profile is invalid JSON");
    }
  }
  const result = profileSchema.safeParse(decoded);
  if (!result.success) throw new Error("LINE message test profile shape is invalid");
  const details = normalizeParsedDetails({
    clientName: result.data.clientName,
    packageName: result.data.packageName,
    totalPriceThb: result.data.totalPriceThb,
    paymentType: result.data.paymentType,
    installmentCount: result.data.installmentCount,
    intervalMonths: result.data.intervalMonths,
    firstDueDate: result.data.firstDueDate,
  });
  return { ...result.data, ...details };
}

export function mergeLineMessageTestDetails(
  profile: LineMessageTestProfile,
  details: LineMessageTestDetails,
  now: string,
): LineMessageTestProfile {
  const parsedProfile = parseLineMessageTestProfile(profile);
  const parsedDetails = parseLineMessageTestDetails(details);
  return {
    ...parsedProfile,
    ...parsedDetails,
    updatedAt: parseTimestamp(now, "LINE message test update time"),
  };
}

export function toLineMessageTestAdminView(profile: LineMessageTestProfile): LineMessageTestAdminView {
  const parsed = parseLineMessageTestProfile(profile);
  return {
    version: parsed.version,
    clientName: parsed.clientName,
    packageName: parsed.packageName,
    totalPriceThb: parsed.totalPriceThb,
    paymentType: parsed.paymentType,
    installmentCount: parsed.installmentCount,
    intervalMonths: parsed.intervalMonths,
    firstDueDate: parsed.firstDueDate,
    lineDisplayName: parsed.lineDisplayName,
    linePictureUrl: parsed.linePictureUrl,
    lineLinkStatus: parsed.lineLinkStatus,
    lineLinkedAt: parsed.lineLinkedAt,
    lineLinkError: parsed.lineLinkError,
    updatedAt: parsed.updatedAt,
  };
}

export function parseLineMessageTestScenario(value: unknown): LineMessageTestScenario {
  const result = scenarioSchema.safeParse(value);
  if (!result.success) throw new Error("LINE message test scenario is invalid");
  return result.data as LineMessageTestScenario;
}

function syntheticClient(profile: LineMessageTestProfile, paymentType: LineMessageTestScenario["paymentType"], schedules: readonly ScheduleRecord[], createdAt: string): ClientRecord {
  const firstSchedule = schedules[0];
  return {
    rowNumber: 0,
    client_id: "line_test_client",
    active: "TRUE",
    client_name: profile.clientName,
    line_user_id: profile.lineUserId,
    line_display_name: profile.lineDisplayName,
    package_name: profile.packageName,
    payment_type: paymentType,
    total_price_thb: profile.totalPriceThb,
    installment_count: String(schedules.length),
    interval_months: paymentType === "ONE_TIME" ? "0" : String(profile.intervalMonths),
    first_due_date: firstSchedule.due_date,
    default_amount_thb: firstSchedule.amount_thb,
    billing_frequency: paymentType === "ONE_TIME" ? "ONE_TIME" : "MONTHLY",
    next_due_date: firstSchedule.due_date,
    notes: "LINE message test fixture",
    created_at: createdAt,
    updated_at: createdAt,
    line_link_status: profile.lineLinkStatus,
    line_linked_at: profile.lineLinkedAt,
    line_link_error: profile.lineLinkError,
    line_link_token_hash: "",
    line_link_token_encrypted: "",
    line_link_token_expires_at: "",
    line_picture_url: profile.linePictureUrl,
  };
}

export function buildLineMessageTestFixture(input: {
  profile: LineMessageTestProfile;
  scenario: LineMessageTestScenario;
  baseUrl: string;
  now: string;
}): LineMessageTestFixture {
  const profile = parseLineMessageTestProfile(input.profile);
  const scenario = parseLineMessageTestScenario(input.scenario);
  const now = parseTimestamp(input.now, "LINE message test fixture time");
  const totalSatang = parseTotalSatang(profile.totalPriceThb);
  const installmentCount = scenario.paymentType === "ONE_TIME" ? 1 : profile.installmentCount;
  const intervalMonths = scenario.paymentType === "ONE_TIME" ? 0 : profile.intervalMonths;

  if (scenario.paymentType === "INSTALLMENTS" && (installmentCount < 2 || intervalMonths < 1)) {
    throw new Error("LINE message test installment scenario requires an installment profile");
  }

  const plan = buildInstallmentPlan({
    totalSatang,
    installmentCount,
    intervalMonths,
    firstDueDate: profile.firstDueDate,
  });
  const installmentNumber = scenario.stage === "LATER" ? scenario.installmentNumber : 1;
  if (scenario.stage === "LATER" && installmentNumber < 2) {
    throw new Error("LINE message test later scenario requires installment two or later");
  }
  const selectedPlan = plan.find((item) => item.installmentNumber === installmentNumber);
  if (!selectedPlan) throw new Error("LINE message test scenario installment is outside the configured plan");

  const createdAt = scenario.stage === "LATER"
    ? timestampForDate(reminderDate(selectedPlan.dueDate, "T_MINUS_7_DAYS"))
    : now;
  const schedules: ScheduleRecord[] = plan.map((item) => ({
    rowNumber: 0,
    schedule_id: `line_test_schedule_${item.installmentNumber}`,
    client_id: "line_test_client",
    client_name: profile.clientName,
    line_user_id: profile.lineUserId,
    line_display_name: profile.lineDisplayName,
    package_name: profile.packageName,
    payment_type: scenario.paymentType,
    installment_number: String(item.installmentNumber),
    installment_count: String(plan.length),
    amount_thb: thbFromSatang(item.amountSatang),
    due_date: item.dueDate,
    status: "SCHEDULED",
    generated_at: "",
    payment_id: "",
    payment_url: "",
    notes: "LINE message test fixture",
    created_at: createdAt,
    updated_at: createdAt,
  }));
  const schedule = schedules[installmentNumber - 1];
  const builtPayment = buildPaymentForSchedule(schedule, {
    paymentId: "line_test_payment",
    publicToken: "line_test_public_token",
    baseUrl: input.baseUrl,
    createdAt,
    planTotalSatang: totalSatang,
  });
  const payment: PaymentRecord = {
    ...builtPayment,
    public_token: "",
    payment_url: `${input.baseUrl.replace(/\/+$/, "")}/line/message-test`,
    rowNumber: 0,
  };
  const simulatedToday = scenario.stage === "LATER"
    ? reminderDate(payment.due_date, scenario.reminderSlot)
    : null;

  if (scenario.stage === "LATER") {
    const eligible = eligibleReminderSlots({
      dueDate: payment.due_date,
      createdAt: payment.created_at,
      today: simulatedToday!,
      log: emptyReminderDeliveryLog(),
    });
    if (!eligible.includes(scenario.reminderSlot)) {
      throw new Error("LINE message test reminder scenario is not eligible");
    }
  }

  return {
    client: syntheticClient(profile, scenario.paymentType, schedules, createdAt),
    schedules,
    payment,
    simulatedToday,
  };
}

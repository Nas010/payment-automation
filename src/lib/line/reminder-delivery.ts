import { REMINDER_SLOTS, type ReminderSlot } from "./message-profile";

export type ReminderDeliveryStatus = "PENDING" | "SENDING" | "ACCEPTED" | "FAILED_RETRYABLE" | "FAILED" | "SKIPPED_MISSING_USER_ID" | "REVIEW";
export type ReminderDelivery = {
  status: ReminderDeliveryStatus;
  renderedMessage?: string;
  retryKey?: string;
  firstAttemptedAt?: string;
  acceptedAt?: string;
  requestId?: string;
  errorCode?: string;
};
export type ReminderDeliveryLog = {
  version: 1;
  deliveries: Partial<Record<ReminderSlot, ReminderDelivery>>;
};

const statuses = new Set<ReminderDeliveryStatus>(["PENDING", "SENDING", "ACCEPTED", "FAILED_RETRYABLE", "FAILED", "SKIPPED_MISSING_USER_ID", "REVIEW"]);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  if (!validDate(date)) throw new Error("Reminder date must be YYYY-MM-DD");
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function emptyReminderDeliveryLog(): ReminderDeliveryLog {
  return { version: 1, deliveries: {} };
}

export function parseReminderDeliveryLog(value: string): ReminderDeliveryLog {
  if (!value) return emptyReminderDeliveryLog();
  let decoded: unknown;
  try { decoded = JSON.parse(value) as unknown; } catch { throw new Error("LINE reminder delivery log is invalid JSON"); }
  if (!decoded || typeof decoded !== "object") throw new Error("LINE reminder delivery log shape is invalid");
  const record = decoded as { version?: unknown; deliveries?: unknown };
  if (record.version !== 1 || !record.deliveries || typeof record.deliveries !== "object" || Array.isArray(record.deliveries)) throw new Error("LINE reminder delivery log shape is invalid");
  const deliveries: Partial<Record<ReminderSlot, ReminderDelivery>> = {};
  for (const [slot, delivery] of Object.entries(record.deliveries)) {
    if (!REMINDER_SLOTS.includes(slot as ReminderSlot) || !delivery || typeof delivery !== "object") throw new Error("LINE reminder delivery log shape is invalid");
    const item = delivery as Record<string, unknown>;
    if (typeof item.status !== "string" || !statuses.has(item.status as ReminderDeliveryStatus)) throw new Error("LINE reminder delivery log status is invalid");
    for (const key of ["renderedMessage", "retryKey", "firstAttemptedAt", "acceptedAt", "requestId", "errorCode"] as const) {
      if (item[key] !== undefined && typeof item[key] !== "string") throw new Error("LINE reminder delivery log shape is invalid");
    }
    deliveries[slot as ReminderSlot] = item as ReminderDelivery;
  }
  return { version: 1, deliveries };
}

export function serializeReminderDeliveryLog(log: ReminderDeliveryLog): string {
  return JSON.stringify(parseReminderDeliveryLog(JSON.stringify(log)));
}

export function updateReminderDelivery(log: ReminderDeliveryLog, slot: ReminderSlot, delivery: ReminderDelivery): ReminderDeliveryLog {
  return parseReminderDeliveryLog(JSON.stringify({ ...log, deliveries: { ...log.deliveries, [slot]: delivery } }));
}

export function reminderDate(dueDate: string, slot: ReminderSlot): string {
  const offsets: Record<ReminderSlot, number> = { T_MINUS_7_DAYS: -7, T_MINUS_3_DAYS: -3, T_MINUS_1_DAY: -1, DUE_DATE: 0, T_PLUS_1_DAY: 1 };
  return addDays(dueDate, offsets[slot]);
}

export function eligibleReminderSlots(input: { dueDate: string; createdAt: string; today: string; log: ReminderDeliveryLog }): ReminderSlot[] {
  if (!validDate(input.today) || !validDate(input.dueDate)) throw new Error("Reminder date must be YYYY-MM-DD");
  const createdDate = input.createdAt.slice(0, 10);
  if (!validDate(createdDate)) throw new Error("Payment creation date is invalid");
  const retries = REMINDER_SLOTS.filter((slot) => {
    const status = input.log.deliveries[slot]?.status;
    return status === "SENDING" || status === "FAILED_RETRYABLE";
  });
  const scheduled = REMINDER_SLOTS.filter((slot) => !input.log.deliveries[slot]
    && createdDate <= reminderDate(input.dueDate, slot)
    && input.today === reminderDate(input.dueDate, slot));
  return [...retries, ...scheduled];
}

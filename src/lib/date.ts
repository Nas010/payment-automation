export const APP_TIME_ZONE = "Asia/Bangkok";
export type DateDisplayValue = string | Date | null | undefined;

function toDisplayDate(value: DateDisplayValue): Date | null {
  if (!value) return null;
  const normalized = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+07:00` : value;
  const date = normalized instanceof Date ? normalized : new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: DateDisplayValue): string {
  const date = toDisplayDate(value);
  return date ? new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(date) : "—";
}

export function formatDateTime(value: DateDisplayValue): string {
  const date = toDisplayDate(value);
  return date ? new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) : "—";
}

export function bangkokDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function parseThaiSlipDate(value: string, timezone: string): Date | null {
  if (timezone !== "Asia/Bangkok") return null;
  const trimmed = value.trim();
  const numeric = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  const thai = trimmed.match(/^(\d{1,2})\s+(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+(\d{2}|\d{4})$/);
  const thaiMonths: Record<string, number> = {
    "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6,
    "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
  };
  if (!numeric && !thai) return null;
  const day = Number((numeric ?? thai)![1]);
  const month = numeric ? Number(numeric[2]) : thaiMonths[thai![2]];
  const rawYear = Number((numeric ?? thai)![3]);
  const year = rawYear >= 2400 ? rawYear - 543 : rawYear >= 50 ? rawYear + 2500 - 543 : rawYear + 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) return null;
  const result = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

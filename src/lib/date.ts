export function parseThaiSlipDate(value: string, timezone: string): Date | null {
  if (timezone !== "Asia/Bangkok") return null;
  const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear >= 2400 ? rawYear - 543 : rawYear;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const result = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

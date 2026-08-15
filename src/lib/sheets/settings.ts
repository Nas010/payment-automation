import { getGoogleSheets } from "./client";
import {
  DEFAULT_LINE_DUE_TEMPLATE,
  DEFAULT_LINE_WELCOME_TEMPLATE,
  validateLineDueTemplate,
  validateLineWelcomeTemplate,
} from "@/lib/line/message-template";
import {
  DEFAULT_LINE_DUE_PROFILES,
  legacyLineDueMessageProfile,
  LINE_DUE_PROFILE_SETTING_KEYS,
  parseLineDueMessageProfile,
  validateLineDueMessageProfile,
  type LineDueMessageProfile,
  type LinePaymentType,
  type ResolvedLineDueMessageProfiles,
} from "@/lib/line/message-profile";

export type OperationalSetting = { rowNumber: number; key: string; value: string };
export type PackageRecord = { rowNumber: number; package_name: string; total_price_thb: string; payment_type: string; installment_count: string; interval_months: string; active: string };

export async function listOperationalSettings(): Promise<OperationalSetting[]> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Settings!A:B" });
  return (response.data.values ?? []).slice(1).map((row, index) => ({ rowNumber: index + 2, key: String(row[0] ?? ""), value: String(row[1] ?? "") })).filter((item) => item.key);
}

export async function upsertOperationalSetting(key: string, value: string): Promise<void> {
  await upsertOperationalSettings([{ key, value }]);
}

export async function upsertOperationalSettings(entries: Array<{ key: string; value: string }>): Promise<void> {
  for (const entry of entries) {
    if (entry.key === "line_due_message_template") validateLineDueTemplate(entry.value);
    if (entry.key === "line_welcome_message_template") validateLineWelcomeTemplate(entry.value);
    const paymentType = (Object.entries(LINE_DUE_PROFILE_SETTING_KEYS) as Array<[LinePaymentType, string]>).find(([, key]) => key === entry.key)?.[0];
    if (paymentType) parseLineDueMessageProfile(entry.value, paymentType);
  }
  const settings = await listOperationalSettings();
  let nextRowNumber = Math.max(2, ...settings.map((item) => item.rowNumber + 1));
  const data = entries.map((entry) => {
    const rowNumber = settings.find((item) => item.key === entry.key)?.rowNumber ?? nextRowNumber++;
    return { range: `Settings!A${rowNumber}:B${rowNumber}`, values: [[entry.key, entry.value]] };
  });
  const { sheets, spreadsheetId } = await getGoogleSheets();
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
}

/** Returns workbook's custom LINE due message, or documented default when unset. */
export async function getLineDueTemplate(): Promise<string> {
  const template = (await listOperationalSettings()).find((item) => item.key === "line_due_message_template")?.value;
  if (!template) return DEFAULT_LINE_DUE_TEMPLATE;
  validateLineDueTemplate(template);
  return template;
}

/** Returns workbook's global LINE welcome message, or documented default when unset. */
export async function getLineWelcomeTemplate(): Promise<string> {
  const template = (await listOperationalSettings()).find((item) => item.key === "line_welcome_message_template")?.value;
  if (!template) return DEFAULT_LINE_WELCOME_TEMPLATE;
  validateLineWelcomeTemplate(template);
  return template;
}

export function resolveLineDueMessageProfiles(settings: OperationalSetting[]): ResolvedLineDueMessageProfiles {
  const byKey = new Map(settings.map((item) => [item.key, item.value]));
  const legacy = byKey.get("line_due_message_template");
  return Object.fromEntries((['ONE_TIME', 'INSTALLMENTS'] as const).map((paymentType) => {
    const stored = byKey.get(LINE_DUE_PROFILE_SETTING_KEYS[paymentType]);
    if (stored !== undefined) {
      try {
        return [paymentType, { kind: "VALID", profile: parseLineDueMessageProfile(stored, paymentType) }];
      } catch {
        return [paymentType, { kind: "INVALID" }];
      }
    }
    if (legacy) {
      try {
        return [paymentType, { kind: "VALID", profile: legacyLineDueMessageProfile(legacy, paymentType) }];
      } catch {
        return [paymentType, { kind: "INVALID" }];
      }
    }
    return [paymentType, { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES[paymentType] }];
  })) as ResolvedLineDueMessageProfiles;
}

export async function getLineDueMessageProfiles(): Promise<ResolvedLineDueMessageProfiles> {
  return resolveLineDueMessageProfiles(await listOperationalSettings());
}

export async function saveLineDueMessageProfile(paymentType: LinePaymentType, profile: LineDueMessageProfile): Promise<void> {
  validateLineDueMessageProfile(profile, paymentType);
  await upsertOperationalSetting(LINE_DUE_PROFILE_SETTING_KEYS[paymentType], JSON.stringify(profile));
}

export async function listPackages(): Promise<PackageRecord[]> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Settings!D:I" });
  return (response.data.values ?? []).slice(3).map((row, index) => ({ rowNumber: index + 4, package_name: String(row[0] ?? ""), total_price_thb: String(row[1] ?? ""), payment_type: String(row[2] ?? ""), installment_count: String(row[3] ?? ""), interval_months: String(row[4] ?? ""), active: String(row[5] ?? "") })).filter((item) => item.package_name);
}

export async function savePackage(item: Omit<PackageRecord, "rowNumber"> & { rowNumber?: number }): Promise<void> {
  const all = await listPackages();
  const duplicate = all.find((entry) => entry.package_name.toLocaleLowerCase() === item.package_name.toLocaleLowerCase() && entry.rowNumber !== item.rowNumber);
  if (duplicate) throw new Error("Package name must be unique");
  const rowNumber = item.rowNumber ?? Math.max(4, ...all.map((entry) => entry.rowNumber + 1));
  const { sheets, spreadsheetId } = await getGoogleSheets();
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Settings!D${rowNumber}:I${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[item.package_name, item.total_price_thb, item.payment_type, item.installment_count, item.interval_months, item.active]] } });
}

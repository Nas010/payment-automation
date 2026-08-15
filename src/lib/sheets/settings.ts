import { getGoogleSheets } from "./client";
import {
  DEFAULT_LINE_DUE_TEMPLATE,
  DEFAULT_LINE_WELCOME_TEMPLATE,
  validateLineDueTemplate,
  validateLineWelcomeTemplate,
} from "@/lib/line/message-template";
import {
  DEFAULT_LINE_DUE_PROFILES,
  DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
  legacyLineDueMessageProfile,
  LINE_DUE_PROFILE_SETTING_KEYS,
  LINE_INSTALLMENT_REMINDER_CONFIG_SETTING_KEY,
  parseLineDueMessageProfile,
  parseLineInstallmentReminderConfig,
  validateLineDueMessageProfile,
  type LineDueMessageProfile,
  type LineInstallmentReminderConfig,
  type LinePaymentType,
  type ResolvedLineDueMessageProfiles,
  type ResolvedLineInstallmentReminderConfig,
} from "@/lib/line/message-profile";
import {
  LINE_TERMS_ACTIVE_VERSION_KEY,
  LINE_TERMS_VERSIONS_KEY,
  activateLineTermsImageVersion,
  parseLineTermsImageState,
  type LineTermsImageState,
  type LineTermsImageVersion,
} from "@/lib/line/terms-image";
import {
  DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
  LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY,
  parseLineAutomaticReplyConfig,
  resolveLineAutomaticReplyConfig,
  type LineAutomaticReplyConfig,
} from "@/lib/line/reply-config";
import {
  LINE_MESSAGE_TEST_PROFILE_SETTING_KEY,
  parseLineMessageTestProfile,
  type LineMessageTestProfile,
} from "@/lib/line/message-test-profile";

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
    if (entry.key === LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY) parseLineAutomaticReplyConfig(entry.value);
    const paymentType = (Object.entries(LINE_DUE_PROFILE_SETTING_KEYS) as Array<[LinePaymentType, string]>).find(([, key]) => key === entry.key)?.[0];
    if (paymentType) parseLineDueMessageProfile(entry.value, paymentType);
    if (entry.key === LINE_INSTALLMENT_REMINDER_CONFIG_SETTING_KEY) parseLineInstallmentReminderConfig(entry.value);
    if (entry.key === LINE_MESSAGE_TEST_PROFILE_SETTING_KEY) parseLineMessageTestProfile(entry.value);
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

export async function getLineAutomaticReplyConfig(): Promise<LineAutomaticReplyConfig> {
  try {
    return resolveLineAutomaticReplyConfig(await listOperationalSettings()).config;
  } catch {
    return DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG;
  }
}

export async function saveLineAutomaticReplyConfig(config: LineAutomaticReplyConfig): Promise<void> {
  const normalized = parseLineAutomaticReplyConfig(config);
  await upsertOperationalSetting(LINE_AUTOMATIC_REPLY_CONFIG_SETTING_KEY, JSON.stringify(normalized));
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

export function resolveLineInstallmentReminderConfig(settings: OperationalSetting[]): ResolvedLineInstallmentReminderConfig {
  const byKey = new Map(settings.map((item) => [item.key, item.value]));
  const stored = byKey.get(LINE_INSTALLMENT_REMINDER_CONFIG_SETTING_KEY);
  if (stored !== undefined) {
    try {
      return { kind: "VALID", config: parseLineInstallmentReminderConfig(stored) };
    } catch {
      return { kind: "INVALID" };
    }
  }
  const installmentProfile = resolveLineDueMessageProfiles(settings).INSTALLMENTS;
  if (installmentProfile.kind === "INVALID") return { kind: "INVALID" };
  return {
    kind: "VALID",
    config: {
      ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
      enabled: { ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.enabled },
      profiles: {
        ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles,
        DUE_DATE: installmentProfile.profile,
      },
    },
  };
}

export async function getLineInstallmentReminderConfig(): Promise<ResolvedLineInstallmentReminderConfig> {
  return resolveLineInstallmentReminderConfig(await listOperationalSettings());
}

export type ResolvedLineMessageTestProfile =
  | { kind: "VALID"; profile: LineMessageTestProfile }
  | { kind: "INVALID" };

export function resolveLineMessageTestProfile(
  settings: readonly OperationalSetting[],
  fallback: LineMessageTestProfile,
): ResolvedLineMessageTestProfile {
  const stored = settings.find((item) => item.key === LINE_MESSAGE_TEST_PROFILE_SETTING_KEY)?.value;
  if (stored === undefined) return { kind: "VALID", profile: parseLineMessageTestProfile(fallback) };
  try {
    return { kind: "VALID", profile: parseLineMessageTestProfile(stored) };
  } catch {
    return { kind: "INVALID" };
  }
}

export async function saveLineInstallmentReminderConfig(config: LineInstallmentReminderConfig): Promise<void> {
  parseLineInstallmentReminderConfig(config);
  await upsertOperationalSetting(LINE_INSTALLMENT_REMINDER_CONFIG_SETTING_KEY, JSON.stringify(config));
}

export async function saveLineDueMessageProfile(paymentType: LinePaymentType, profile: LineDueMessageProfile): Promise<void> {
  validateLineDueMessageProfile(profile, paymentType);
  await upsertOperationalSetting(LINE_DUE_PROFILE_SETTING_KEYS[paymentType], JSON.stringify(profile));
}

export async function getLineTermsImageState(): Promise<LineTermsImageState> {
  return parseLineTermsImageState(await listOperationalSettings());
}

export async function saveLineTermsImageVersion(version: LineTermsImageVersion): Promise<void> {
  const next = activateLineTermsImageVersion(await getLineTermsImageState(), version);
  await upsertOperationalSettings([
    { key: LINE_TERMS_ACTIVE_VERSION_KEY, value: next.activeVersionId },
    { key: LINE_TERMS_VERSIONS_KEY, value: JSON.stringify(next.versions) },
  ]);
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

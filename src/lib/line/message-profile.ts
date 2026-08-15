import { z } from "zod";

import { DEFAULT_LINE_DUE_TEMPLATE } from "./message-template";

export type LinePaymentType = "ONE_TIME" | "INSTALLMENTS";
export type CustomLinePlaceholder = { name: string; template: string };
export type LineDueMessageProfile = {
  version: 1;
  message: string;
  customPlaceholders: CustomLinePlaceholder[];
};
export type LineDueMessageProfiles = Record<LinePaymentType, LineDueMessageProfile>;
export const REMINDER_SLOTS = ["T_MINUS_7_DAYS", "T_MINUS_3_DAYS", "T_MINUS_1_DAY", "DUE_DATE", "T_PLUS_1_DAY"] as const;
export type ReminderSlot = (typeof REMINDER_SLOTS)[number];
export type LineInstallmentReminderConfig = {
  version: 1;
  profiles: Record<ReminderSlot, LineDueMessageProfile>;
};
export type ResolvedLineDueMessageProfile =
  | { kind: "VALID"; profile: LineDueMessageProfile }
  | { kind: "INVALID" };
export type ResolvedLineDueMessageProfiles = Record<LinePaymentType, ResolvedLineDueMessageProfile>;
export type ResolvedLineInstallmentReminderConfig =
  | { kind: "VALID"; config: LineInstallmentReminderConfig }
  | { kind: "INVALID" };
export type LineDueMessageProfileActionResult = {
  ok: true;
  paymentType: LinePaymentType;
  profile: LineDueMessageProfile;
  preview: string;
};

const COMMON_SYSTEM_PLACEHOLDERS = [
  "client_name",
  "package_name",
  "payment_type",
  "amount",
  "total_amount",
  "due_date",
  "due_month_name",
  "payment_url",
] as const;
const INSTALLMENT_SYSTEM_PLACEHOLDERS = [
  "installment_number",
  "installment_ordinal",
  "installment_number_word",
  "installment_ordinal_word",
  "installment_count",
  "installment_count_word",
] as const;

export type LineDueSystemPlaceholder =
  | (typeof COMMON_SYSTEM_PLACEHOLDERS)[number]
  | (typeof INSTALLMENT_SYSTEM_PLACEHOLDERS)[number];
export type LineDueSystemValues = Partial<Record<LineDueSystemPlaceholder, string>>;

export const LINE_DUE_PROFILE_SETTING_KEYS = {
  ONE_TIME: "line_due_message_profile_one_time",
  INSTALLMENTS: "line_due_message_profile_installments",
} as const satisfies Record<LinePaymentType, string>;
export const LINE_INSTALLMENT_REMINDER_CONFIG_SETTING_KEY = "line_installment_reminder_config";

export class LineDueTemplateError extends Error {
  constructor(
    public readonly code: "TEMPLATE_INVALID" | "TEMPLATE_DATA_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "LineDueTemplateError";
  }
}

const DEFAULT_PROFILE_MESSAGE = DEFAULT_LINE_DUE_TEMPLATE.replace(
  "Your {{payment_label}} payment is due.",
  "Your {{payment_label}} is due.",
);

export const DEFAULT_LINE_DUE_PROFILES: LineDueMessageProfiles = {
  ONE_TIME: {
    version: 1,
    message: DEFAULT_PROFILE_MESSAGE,
    customPlaceholders: [{ name: "payment_label", template: "{{package_name}} payment" }],
  },
  INSTALLMENTS: {
    version: 1,
    message: DEFAULT_PROFILE_MESSAGE,
    customPlaceholders: [{ name: "payment_label", template: "{{installment_ordinal}} payment out of {{installment_count}} for {{package_name}}" }],
  },
};

function defaultReminderProfile(timing: string): LineDueMessageProfile {
  return {
    version: 1,
    message: `Hi {{client_name}} 👋\n\n${timing}\n\nAmount: {{amount}}\nDeadline: {{due_date}}\n{{payment_url}}`,
    customPlaceholders: [],
  };
}

export const DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG: LineInstallmentReminderConfig = {
  version: 1,
  profiles: {
    T_MINUS_7_DAYS: defaultReminderProfile("Your installment payment is due in 7 days."),
    T_MINUS_3_DAYS: defaultReminderProfile("Your installment payment is due in 3 days."),
    T_MINUS_1_DAY: defaultReminderProfile("Your installment payment is due tomorrow."),
    DUE_DATE: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS,
    T_PLUS_1_DAY: defaultReminderProfile("Your installment payment was due yesterday."),
  },
};

const profileSchema = z.object({
  version: z.literal(1),
  message: z.string(),
  customPlaceholders: z.array(z.object({ name: z.string(), template: z.string() })),
});
const reminderConfigSchema = z.object({
  version: z.literal(1),
  profiles: z.record(z.string(), z.unknown()),
}).strict();

const TOKEN = /{{\s*([a-z][a-z0-9_]*)\s*}}/g;
const CUSTOM_NAME = /^[a-z][a-z0-9_]{0,39}$/;

export function lineDueTemplatePlaceholders(template: string): string[] {
  const found: string[] = [];
  let previousEnd = 0;
  for (const match of template.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (/[{}]/.test(template.slice(previousEnd, start))) {
      throw new LineDueTemplateError("TEMPLATE_INVALID", "Malformed LINE placeholder");
    }
    found.push(match[1]);
    previousEnd = start + match[0].length;
  }
  if (/[{}]/.test(template.slice(previousEnd))) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Malformed LINE placeholder");
  }
  return found;
}

export function systemPlaceholders(paymentType: LinePaymentType): readonly LineDueSystemPlaceholder[] {
  return paymentType === "INSTALLMENTS"
    ? [...COMMON_SYSTEM_PLACEHOLDERS, ...INSTALLMENT_SYSTEM_PLACEHOLDERS]
    : COMMON_SYSTEM_PLACEHOLDERS;
}

export function validateLineDueMessageProfile(
  profile: LineDueMessageProfile,
  paymentType: LinePaymentType,
): void {
  if (profile.version !== 1) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Unsupported LINE profile version");
  }
  if (profile.message.length < 1 || profile.message.length > 5000) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "LINE profile message must contain 1-5000 characters");
  }
  if (profile.customPlaceholders.length > 20) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "LINE profile supports at most 20 custom placeholders");
  }

  const system = new Set<string>(systemPlaceholders(paymentType));
  const custom = new Map<string, CustomLinePlaceholder>();
  for (const definition of profile.customPlaceholders) {
    if (!CUSTOM_NAME.test(definition.name) || system.has(definition.name) || custom.has(definition.name)) {
      throw new LineDueTemplateError("TEMPLATE_INVALID", `Invalid custom placeholder: ${definition.name}`);
    }
    if (definition.template.trim().length < 1 || definition.template.length > 1000) {
      throw new LineDueTemplateError(
        "TEMPLATE_INVALID",
        `Custom placeholder ${definition.name} must contain 1-1,000 characters`,
      );
    }
    const unsupported = lineDueTemplatePlaceholders(definition.template).find((name) => !system.has(name));
    if (unsupported) {
      throw new LineDueTemplateError(
        "TEMPLATE_INVALID",
        `Custom placeholder ${definition.name} cannot reference ${unsupported}`,
      );
    }
    custom.set(definition.name, definition);
  }

  const mainTokens = lineDueTemplatePlaceholders(profile.message);
  const unknown = mainTokens.find((name) => !system.has(name) && !custom.has(name));
  if (unknown) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", `Unsupported LINE placeholder: ${unknown}`);
  }

}

function substitute(template: string, values: Partial<Record<string, string>>): string {
  return template.replace(TOKEN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new LineDueTemplateError("TEMPLATE_DATA_MISSING", `Missing LINE placeholder data: ${name}`);
    }
    return value;
  });
}

export function parseLineDueMessageProfile(value: unknown, paymentType: LinePaymentType): LineDueMessageProfile {
  let decoded: unknown;
  try {
    decoded = typeof value === "string" ? JSON.parse(value) as unknown : value;
  } catch {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Stored LINE profile is invalid JSON");
  }

  const result = profileSchema.safeParse(decoded);
  if (!result.success) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "LINE profile shape is invalid");
  }
  const profile = result.data;
  validateLineDueMessageProfile(profile, paymentType);
  return profile;
}

export function parseLineInstallmentReminderConfig(value: unknown): LineInstallmentReminderConfig {
  let decoded: unknown;
  try {
    decoded = typeof value === "string" ? JSON.parse(value) as unknown : value;
  } catch {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Stored LINE reminder configuration is invalid JSON");
  }
  const result = reminderConfigSchema.safeParse(decoded);
  if (!result.success) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "LINE reminder configuration shape is invalid");
  }
  const profiles = result.data.profiles;
  for (const slot of REMINDER_SLOTS) {
    if (!(slot in profiles)) {
      throw new LineDueTemplateError("TEMPLATE_INVALID", `LINE reminder configuration requires profile: ${slot}`);
    }
  }
  const unexpected = Object.keys(profiles).find((slot) => !REMINDER_SLOTS.includes(slot as ReminderSlot));
  if (unexpected) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", `Unsupported LINE reminder slot: ${unexpected}`);
  }
  return {
    version: 1,
    profiles: Object.fromEntries(REMINDER_SLOTS.map((slot) => [slot, parseLineDueMessageProfile(profiles[slot], "INSTALLMENTS")])) as Record<ReminderSlot, LineDueMessageProfile>,
  };
}

export function renderLineDueMessageProfile(
  profile: LineDueMessageProfile,
  paymentType: LinePaymentType,
  systemValues: LineDueSystemValues,
): string {
  validateLineDueMessageProfile(profile, paymentType);
  const referenced = new Set(lineDueTemplatePlaceholders(profile.message));
  const customValues = Object.fromEntries(
    profile.customPlaceholders
      .filter((definition) => referenced.has(definition.name))
      .map((definition) => [definition.name, substitute(definition.template, systemValues)]),
  );
  const rendered = substitute(profile.message, { ...systemValues, ...customValues });
  if (rendered.length < 1 || rendered.length > 5000) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Rendered LINE due message must contain 1-5000 characters");
  }
  return rendered;
}

export function legacyLineDueMessageProfile(
  template: string,
  paymentType: LinePaymentType,
): LineDueMessageProfile {
  const profile: LineDueMessageProfile = {
    version: 1,
    message: template,
    customPlaceholders: [{ name: "payment_label", template: "{{due_month_name}} Coaching" }],
  };
  validateLineDueMessageProfile(profile, paymentType);
  return profile;
}

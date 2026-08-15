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
export type ResolvedLineDueMessageProfile =
  | { kind: "VALID"; profile: LineDueMessageProfile }
  | { kind: "INVALID" };
export type ResolvedLineDueMessageProfiles = Record<LinePaymentType, ResolvedLineDueMessageProfile>;
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

const profileSchema = z.object({
  version: z.literal(1),
  message: z.string(),
  customPlaceholders: z.array(z.object({ name: z.string(), template: z.string() })),
});

const TOKEN = /{{\s*([a-z][a-z0-9_]*)\s*}}/g;
const REQUIRED = ["amount", "due_date", "payment_url"] as const;
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

  const reachable = new Set(mainTokens.filter((name) => system.has(name)));
  for (const name of mainTokens) {
    const definition = custom.get(name);
    if (definition) {
      for (const nested of lineDueTemplatePlaceholders(definition.template)) {
        reachable.add(nested);
      }
    }
  }
  for (const required of REQUIRED) {
    if (!reachable.has(required)) {
      throw new LineDueTemplateError("TEMPLATE_INVALID", `LINE profile requires placeholder: ${required}`);
    }
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

export function renderLineDueMessageProfile(
  profile: LineDueMessageProfile,
  paymentType: LinePaymentType,
  systemValues: LineDueSystemValues,
): string {
  validateLineDueMessageProfile(profile, paymentType);
  const customValues = Object.fromEntries(
    profile.customPlaceholders.map((definition) => [definition.name, substitute(definition.template, systemValues)]),
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

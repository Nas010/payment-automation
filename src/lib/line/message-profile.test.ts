import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
  DEFAULT_LINE_DUE_PROFILES,
  LINE_DUE_PROFILE_SETTING_KEYS,
  LineDueTemplateError,
  legacyLineDueMessageProfile,
  parseLineInstallmentReminderConfig,
  renderLineDueMessageProfile,
  validateLineDueMessageProfile,
} from "./message-profile";

const installmentValues = {
  client_name: "Nisa",
  package_name: "Personal Training",
  payment_type: "Installments",
  amount: "฿1,500.00",
  total_amount: "฿4,500.00",
  due_date: "2026-08-15",
  due_month_name: "August",
  payment_url: "https://pay.example/p/token",
  installment_number: "2",
  installment_ordinal: "2nd",
  installment_number_word: "two",
  installment_ordinal_word: "second",
  installment_count: "3",
  installment_count_word: "three",
};

describe("LINE due message profiles", () => {
  it("uses distinct versioned setting keys and defaults", () => {
    expect(LINE_DUE_PROFILE_SETTING_KEYS).toEqual({
      ONE_TIME: "line_due_message_profile_one_time",
      INSTALLMENTS: "line_due_message_profile_installments",
    });
    expect(DEFAULT_LINE_DUE_PROFILES.ONE_TIME.customPlaceholders).toContainEqual({ name: "payment_label", template: "{{package_name}} payment" });
    expect(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS.customPlaceholders).toContainEqual({ name: "payment_label", template: "{{installment_ordinal}} payment out of {{installment_count}} for {{package_name}}" });
  });

  it("normalizes legacy reminder config to version two with every slot enabled", () => {
    const legacy = {
      version: 1,
      profiles: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles,
    };

    expect(parseLineInstallmentReminderConfig(legacy)).toEqual(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  });

  it("preserves independent version two reminder switches", () => {
    const config = structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
    config.enabled.T_MINUS_3_DAYS = false;

    expect(parseLineInstallmentReminderConfig(config)).toEqual(config);
  });

  it.each([
    ["missing flag", { T_MINUS_7_DAYS: true }],
    ["non-boolean flag", {
      T_MINUS_7_DAYS: true,
      T_MINUS_3_DAYS: true,
      T_MINUS_1_DAY: "true",
      DUE_DATE: true,
      T_PLUS_1_DAY: true,
    }],
    ["unexpected flag", {
      T_MINUS_7_DAYS: true,
      T_MINUS_3_DAYS: true,
      T_MINUS_1_DAY: true,
      DUE_DATE: true,
      T_PLUS_1_DAY: true,
      MONTH_END: true,
    }],
  ])("rejects version two config with %s", (_label, enabled) => {
    expect(() => parseLineInstallmentReminderConfig({
      version: 2,
      enabled,
      profiles: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles,
    })).toThrow(LineDueTemplateError);
  });

  it("renders a custom placeholder from protected installment values", () => {
    const profile = {
      version: 1 as const,
      message: "Your {{payment_label}} is due. {{amount}} {{due_date}} {{payment_url}}",
      customPlaceholders: [{ name: "payment_label", template: "{{installment_ordinal_word}} payment out of {{installment_count_word}} for {{package_name}}" }],
    };
    expect(renderLineDueMessageProfile(profile, "INSTALLMENTS", installmentValues)).toBe(
      "Your second payment out of three for Personal Training is due. ฿1,500.00 2026-08-15 https://pay.example/p/token",
    );
  });

  it("adapts legacy payment_label without mutating stored settings", () => {
    const profile = legacyLineDueMessageProfile("{{payment_label}} {{amount}} {{due_date}} {{payment_url}}", "ONE_TIME");
    expect(profile.customPlaceholders).toEqual([{ name: "payment_label", template: "{{due_month_name}} Coaching" }]);
    expect(renderLineDueMessageProfile(profile, "ONE_TIME", installmentValues)).toContain("August Coaching");
  });

  it("reports missing referenced system data with a stable code", () => {
    try {
      renderLineDueMessageProfile(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, "INSTALLMENTS", { ...installmentValues, package_name: undefined });
      throw new Error("Expected rendering to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LineDueTemplateError);
      expect(error).toMatchObject({ code: "TEMPLATE_DATA_MISSING" });
    }
  });

  it("accepts required data reachable through a used custom placeholder", () => {
    expect(() => validateLineDueMessageProfile({
      version: 1,
      message: "{{payment_details}}",
      customPlaceholders: [{ name: "payment_details", template: "{{amount}} {{due_date}} {{payment_url}}" }],
    }, "ONE_TIME")).not.toThrow();
  });

  it("allows every system placeholder to be omitted", () => {
    const profile = {
      version: 1,
      message: "Friendly reminder",
      customPlaceholders: [],
    } as const;

    expect(() => validateLineDueMessageProfile(profile, "INSTALLMENTS")).not.toThrow();
    expect(renderLineDueMessageProfile(profile, "INSTALLMENTS", {})).toBe("Friendly reminder");
  });

  it("requires data only for placeholders used by the message", () => {
    const profile = {
      version: 1,
      message: "Hi {{client_name}}",
      customPlaceholders: [{ name: "unused", template: "{{amount}} {{due_date}} {{payment_url}}" }],
    } as const;

    expect(renderLineDueMessageProfile(profile, "INSTALLMENTS", { client_name: "Nisa" })).toBe("Hi Nisa");
  });

  it.each([
    ["custom-to-custom", { version: 1, message: "{{label}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: "{{other}}" }, { name: "other", template: "text" }] }],
    ["reserved shadow", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "amount", template: "changed" }] }],
    ["bad name", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "Bad Name", template: "text" }] }],
    ["duplicate", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: "one" }, { name: "label", template: "two" }] }],
    ["empty content", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: "" }] }],
    ["whitespace-only content", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: " \n\t " }] }],
    ["installment token in one-time", { version: 1, message: "{{installment_ordinal}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] }],
    ["unknown main token", { version: 1, message: "{{bank_name}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] }],
    ["malformed main token", { version: 1, message: "{{client name}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] }],
  ])("rejects %s", (_label, profile) => {
    expect(() => validateLineDueMessageProfile(profile as never, "ONE_TIME")).toThrow(LineDueTemplateError);
  });

  it.each([
    "{{{amount}}} {{due_date}} {{payment_url}}",
    "{{amount}}} {{due_date}} {{payment_url}}",
  ])("rejects malformed brace structure in a main placeholder: %s", (message) => {
    expect(() => validateLineDueMessageProfile({
      version: 1,
      message,
      customPlaceholders: [],
    }, "ONE_TIME")).toThrow(LineDueTemplateError);
  });

  it.each(["{{{client_name}}}", "{{client_name}}}"])(
    "rejects malformed brace structure in a custom placeholder: %s",
    (template) => {
      expect(() => validateLineDueMessageProfile({
        version: 1,
        message: "{{amount}} {{due_date}} {{payment_url}}",
        customPlaceholders: [{ name: "label", template }],
      }, "ONE_TIME")).toThrow(LineDueTemplateError);
    },
  );

  it("rejects more than twenty custom placeholders and overlong content", () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ name: `label_${index}`, template: "text" }));
    expect(() => validateLineDueMessageProfile({ version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: many }, "ONE_TIME")).toThrow(/20/);
    expect(() => validateLineDueMessageProfile({ version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: "x".repeat(1001) }] }, "ONE_TIME")).toThrow(/1,000/);
  });

  it("rejects overlong source and rendered messages", () => {
    expect(() => validateLineDueMessageProfile({ version: 1, message: `{{amount}} {{due_date}} {{payment_url}}${"x".repeat(5000)}`, customPlaceholders: [] }, "ONE_TIME")).toThrow(/5000/);
    expect(() => renderLineDueMessageProfile({ version: 1, message: "{{amount}}{{due_date}}{{payment_url}}", customPlaceholders: [] }, "ONE_TIME", {
      amount: "x".repeat(4990), due_date: "2026-08-15", payment_url: "https://pay.example/p/token",
    })).toThrow(/5000/);
  });
});

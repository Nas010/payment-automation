# Configurable LINE Due-Message Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build separate one-time and installment LINE message profiles with protected payment-data buttons, admin-defined custom placeholders, installment-aware wording, stable payment snapshots, and backward-compatible delivery.

**Architecture:** Add a pure profile domain that validates and renders two-layer templates, then persist one versioned JSON profile per payment type in the workbook Settings table. Snapshot stable plan fields onto generated Payment rows, resolve legacy rows from the existing schedule in the batched sender read, and keep the current frozen-message retry contract. Replace the single template textarea with a two-tab editor whose reusable textarea component inserts protected or custom tokens at the active caret.

**Tech Stack:** Next.js 15 App Router, React 19, strict TypeScript, Google Sheets API, Vitest, Testing Library, existing shadcn/Base UI components.

## Global Constraints

- Follow approved spec: `docs/superpowers/specs/2026-08-15-line-configurable-placeholders-design.md`.
- Keep independent `ONE_TIME` and `INSTALLMENTS` profiles.
- System placeholders are protected and client-facing only; never expose IDs, public tokens, workflow state, review data, audit data, or private notes.
- Custom placeholders may reference system placeholders only; main messages may reference system and custom placeholders.
- Require reachable `amount`, `due_date`, and `payment_url` references in every profile.
- Enforce custom name regex `[a-z][a-z0-9_]{0,39}`, maximum twenty custom placeholders per profile, maximum 1,000 characters per custom definition, and maximum 5,000 rendered LINE characters.
- Preserve persisted `line_message` and `line_retry_key` across retries; never re-render a frozen retry message.
- Keep current client name/LINE recipient live while package, payment type, installment position, total, amount, due date, and URL remain payment-specific.
- Preserve the legacy `line_due_message_template` read fallback and legacy pending-payment schedule fallback.
- Use local code and tests only; unit tests must not call Google, LINE, or any live vendor.
- Add no dependency; implement English cardinal and ordinal formatting locally.
- Preserve unrelated dirty-worktree edits. At execution start, record `git status --short` as the baseline. A task commit is allowed only when every path in that task was clean at baseline or newly created by that task; otherwise skip that entire task commit and leave its changes unstaged for user review. Never use stash/reset/checkout to manufacture a clean tree, never stage a partial task commit that cannot build independently, and never absorb pre-existing edits into a feature commit.

---

## File Structure

- Create `src/lib/line/installment-language.ts`: pure numeric ordinal and English number/ordinal word formatting.
- Create `src/lib/line/installment-language.test.ts`: formatter edge cases and invalid input.
- Create `src/lib/line/message-profile.ts`: profile types, system catalogs, defaults, legacy adapter, parser, validator, renderer, and stable template errors.
- Create `src/lib/line/message-profile.test.ts`: pure profile validation/rendering coverage.
- Create `src/lib/line/message-values.ts`: resolve protected values from Payment, Client, and legacy Schedule rows.
- Create `src/lib/line/message-values.test.ts`: snapshot precedence and legacy fallback coverage.
- Create `src/components/admin/line-placeholder-editor.tsx`: reusable controlled textarea plus caret-aware placeholder buttons.
- Modify `src/lib/sheets/settings.ts`: load/save both profile JSON settings with per-profile legacy fallback.
- Modify `src/app/admin/(protected)/settings/line-actions.ts`: profile preview/save/reset server actions.
- Modify `src/lib/sheets/records.ts`, `src/lib/sheets/payments.ts`, and `src/lib/sheets/migration.ts`: append Payment snapshot fields and expand canonical ranges.
- Modify `src/lib/plans/schedule.ts` and `src/lib/payments/generate.ts`: calculate exact plan total and snapshot message data at payment generation.
- Modify `src/lib/sheets/payment-client-snapshot.ts`: batch Payments, Clients, and Installment Schedule.
- Modify `src/lib/line/due-payments.ts`: select, resolve, render, freeze, and deliver the correct profile.
- Modify `src/components/admin/line-due-template-form.tsx`: two-profile editor, custom-placeholder lifecycle, preview/save/reset.
- Modify `src/app/admin/(protected)/settings/page.tsx`: resolve and supply both profiles.
- Modify `src/lib/workspace/workbook.ts` and `src/lib/workspace/setup.ts`: seed fresh workbooks with profile JSON settings.
- Update colocated tests for every modified file listed in each task.

---

### Task 1: Installment Language Formatting

**Files:**
- Create: `src/lib/line/installment-language.ts`
- Create: `src/lib/line/installment-language.test.ts`

**Interfaces:**
- Consumes: positive safe integer installment numbers/counts.
- Produces: `formatOrdinalNumber(value: number): string`, `formatCardinalWord(value: number): string`, and `formatOrdinalWord(value: number): string`.

- [ ] **Step 1: Write failing formatter tests**

```ts
import { describe, expect, it } from "vitest";
import { formatCardinalWord, formatOrdinalNumber, formatOrdinalWord } from "./installment-language";

describe("installment language", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"],
    [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [112, "112th"],
  ])("formats numeric ordinal %i", (value, expected) => {
    expect(formatOrdinalNumber(value)).toBe(expected);
  });

  it.each([
    [1, "one"], [12, "twelve"], [21, "twenty one"],
    [105, "one hundred five"], [1_002, "one thousand two"],
  ])("formats cardinal word %i", (value, expected) => {
    expect(formatCardinalWord(value)).toBe(expected);
  });

  it.each([
    [1, "first"], [2, "second"], [3, "third"], [12, "twelfth"],
    [21, "twenty first"], [100, "one hundredth"], [1_002, "one thousand second"],
  ])("formats ordinal word %i", (value, expected) => {
    expect(formatOrdinalWord(value)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid installment value %s", (value) => {
    expect(() => formatCardinalWord(value)).toThrow(/positive safe integer/i);
    expect(() => formatOrdinalWord(value)).toThrow(/positive safe integer/i);
    expect(() => formatOrdinalNumber(value)).toThrow(/positive safe integer/i);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/lib/line/installment-language.test.ts`

Expected: FAIL because `./installment-language` does not exist.

- [ ] **Step 3: Implement numeric and English word formatters**

Use three-digit chunks through quadrillion so every positive safe integer has deterministic output:

```ts
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion"] as const;

function assertInstallmentInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Installment value must be a positive safe integer");
}

function chunkWords(value: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundreds) words.push(ONES[hundreds], "hundred");
  if (remainder >= 20) {
    words.push(TENS[Math.floor(remainder / 10)]);
    if (remainder % 10) words.push(ONES[remainder % 10]);
  } else if (remainder >= 10) {
    words.push(TEENS[remainder - 10]);
  } else if (remainder) {
    words.push(ONES[remainder]);
  }
  return words;
}

export function formatCardinalWord(value: number): string {
  assertInstallmentInteger(value);
  const groups: string[] = [];
  let remaining = value;
  let scale = 0;
  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk) groups.unshift([...chunkWords(chunk), SCALES[scale]].filter(Boolean).join(" "));
    remaining = Math.floor(remaining / 1000);
    scale += 1;
  }
  return groups.join(" ");
}

export function formatOrdinalNumber(value: number): string {
  assertInstallmentInteger(value);
  const lastTwo = value % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th";
  return `${value}${suffix}`;
}

const IRREGULAR_ORDINALS: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
};

export function formatOrdinalWord(value: number): string {
  const words = formatCardinalWord(value).split(" ");
  const last = words.at(-1)!;
  words[words.length - 1] = IRREGULAR_ORDINALS[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.join(" ");
}
```

- [ ] **Step 4: Run formatter tests and verify GREEN**

Run: `npm test -- src/lib/line/installment-language.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit formatter domain**

```bash
git add src/lib/line/installment-language.ts src/lib/line/installment-language.test.ts
git commit -m "feat: add installment language formatting"
```

---

### Task 2: Message Profile Domain

**Files:**
- Create: `src/lib/line/message-profile.ts`
- Create: `src/lib/line/message-profile.test.ts`
- Read: `src/lib/line/message-template.ts`

**Interfaces:**
- Consumes: Task 1 formatters and legacy `DEFAULT_LINE_DUE_TEMPLATE`.
- Produces:
  - `type LinePaymentType = "ONE_TIME" | "INSTALLMENTS"`
  - `type LineDueMessageProfile = { version: 1; message: string; customPlaceholders: Array<{ name: string; template: string }> }`
  - `type LineDueMessageProfiles = Record<LinePaymentType, LineDueMessageProfile>`
  - `type LineDueMessageProfileActionResult = { ok: true; paymentType: LinePaymentType; profile: LineDueMessageProfile; preview: string }`
  - `type LineDueSystemValues = Partial<Record<LineDueSystemPlaceholder, string>>`
  - `LINE_DUE_PROFILE_SETTING_KEYS`, `DEFAULT_LINE_DUE_PROFILES`, and `systemPlaceholders(paymentType)`
  - `lineDueTemplatePlaceholders(template)`, `parseLineDueMessageProfile(value, paymentType)`, `validateLineDueMessageProfile(profile, paymentType)`, `renderLineDueMessageProfile(profile, paymentType, values)`, and `legacyLineDueMessageProfile(template, paymentType)`
  - `LineDueTemplateError` with code `TEMPLATE_INVALID` or `TEMPLATE_DATA_MISSING`.

- [ ] **Step 1: Write failing profile tests for catalogs, defaults, legacy adaptation, and rendering**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_DUE_PROFILES,
  LINE_DUE_PROFILE_SETTING_KEYS,
  LineDueTemplateError,
  legacyLineDueMessageProfile,
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
});
```

- [ ] **Step 2: Add failing validation tests for every profile rule**

```ts
it("accepts required data reachable through a used custom placeholder", () => {
  expect(() => validateLineDueMessageProfile({
    version: 1,
    message: "{{payment_details}}",
    customPlaceholders: [{ name: "payment_details", template: "{{amount}} {{due_date}} {{payment_url}}" }],
  }, "ONE_TIME")).not.toThrow();
});

it("rejects required data reachable only through an unused custom placeholder", () => {
  expect(() => validateLineDueMessageProfile({
    version: 1,
    message: "Hello {{client_name}}",
    customPlaceholders: [{ name: "unused", template: "{{amount}} {{due_date}} {{payment_url}}" }],
  }, "ONE_TIME")).toThrow(/requires placeholder: amount/i);
});

it.each([
  ["custom-to-custom", { version: 1, message: "{{label}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: "{{other}}" }, { name: "other", template: "text" }] }],
  ["reserved shadow", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "amount", template: "changed" }] }],
  ["bad name", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "Bad Name", template: "text" }] }],
  ["duplicate", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: "one" }, { name: "label", template: "two" }] }],
  ["empty content", { version: 1, message: "{{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [{ name: "label", template: "" }] }],
  ["installment token in one-time", { version: 1, message: "{{installment_ordinal}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] }],
  ["unknown main token", { version: 1, message: "{{bank_name}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] }],
  ["malformed main token", { version: 1, message: "{{client name}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] }],
])("rejects %s", (_label, profile) => {
  expect(() => validateLineDueMessageProfile(profile as never, "ONE_TIME")).toThrow(LineDueTemplateError);
});

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
```

- [ ] **Step 3: Run profile tests and verify RED**

Run: `npm test -- src/lib/line/message-profile.test.ts`

Expected: FAIL because `./message-profile` does not exist.

- [ ] **Step 4: Implement profile types, catalogs, defaults, and stable errors**

```ts
import { z } from "zod";
import { DEFAULT_LINE_DUE_TEMPLATE } from "./message-template";

export type LinePaymentType = "ONE_TIME" | "INSTALLMENTS";
export type CustomLinePlaceholder = { name: string; template: string };
export type LineDueMessageProfile = { version: 1; message: string; customPlaceholders: CustomLinePlaceholder[] };
export type LineDueMessageProfiles = Record<LinePaymentType, LineDueMessageProfile>;
export type LineDueMessageProfileActionResult = { ok: true; paymentType: LinePaymentType; profile: LineDueMessageProfile; preview: string };

const COMMON_SYSTEM_PLACEHOLDERS = ["client_name", "package_name", "payment_type", "amount", "total_amount", "due_date", "due_month_name", "payment_url"] as const;
const INSTALLMENT_SYSTEM_PLACEHOLDERS = ["installment_number", "installment_ordinal", "installment_number_word", "installment_ordinal_word", "installment_count", "installment_count_word"] as const;
export type LineDueSystemPlaceholder = (typeof COMMON_SYSTEM_PLACEHOLDERS)[number] | (typeof INSTALLMENT_SYSTEM_PLACEHOLDERS)[number];
export type LineDueSystemValues = Partial<Record<LineDueSystemPlaceholder, string>>;

export const LINE_DUE_PROFILE_SETTING_KEYS = {
  ONE_TIME: "line_due_message_profile_one_time",
  INSTALLMENTS: "line_due_message_profile_installments",
} as const satisfies Record<LinePaymentType, string>;

export class LineDueTemplateError extends Error {
  constructor(public readonly code: "TEMPLATE_INVALID" | "TEMPLATE_DATA_MISSING", message: string) {
    super(message);
    this.name = "LineDueTemplateError";
  }
}

const DEFAULT_PROFILE_MESSAGE = DEFAULT_LINE_DUE_TEMPLATE.replace("Your {{payment_label}} payment is due.", "Your {{payment_label}} is due.");
export const DEFAULT_LINE_DUE_PROFILES: LineDueMessageProfiles = {
  ONE_TIME: { version: 1, message: DEFAULT_PROFILE_MESSAGE, customPlaceholders: [{ name: "payment_label", template: "{{package_name}} payment" }] },
  INSTALLMENTS: { version: 1, message: DEFAULT_PROFILE_MESSAGE, customPlaceholders: [{ name: "payment_label", template: "{{installment_ordinal}} payment out of {{installment_count}} for {{package_name}}" }] },
};

const profileSchema = z.object({
  version: z.literal(1),
  message: z.string(),
  customPlaceholders: z.array(z.object({ name: z.string(), template: z.string() })),
});
```

- [ ] **Step 5: Implement strict token parsing and profile validation**

```ts
const TOKEN = /{{\s*([a-z][a-z0-9_]*)\s*}}/g;
const REQUIRED = ["amount", "due_date", "payment_url"] as const;
const CUSTOM_NAME = /^[a-z][a-z0-9_]{0,39}$/;

export function lineDueTemplatePlaceholders(template: string): string[] {
  const found = [...template.matchAll(TOKEN)].map((match) => match[1]);
  const remainder = template.replace(TOKEN, "");
  if (remainder.includes("{{") || remainder.includes("}}")) throw new LineDueTemplateError("TEMPLATE_INVALID", "Malformed LINE placeholder");
  return found;
}

export function systemPlaceholders(paymentType: LinePaymentType): readonly LineDueSystemPlaceholder[] {
  return paymentType === "INSTALLMENTS" ? [...COMMON_SYSTEM_PLACEHOLDERS, ...INSTALLMENT_SYSTEM_PLACEHOLDERS] : COMMON_SYSTEM_PLACEHOLDERS;
}

export function validateLineDueMessageProfile(profile: LineDueMessageProfile, paymentType: LinePaymentType): void {
  if (profile.version !== 1) throw new LineDueTemplateError("TEMPLATE_INVALID", "Unsupported LINE profile version");
  if (profile.message.length < 1 || profile.message.length > 5000) throw new LineDueTemplateError("TEMPLATE_INVALID", "LINE profile message must contain 1-5000 characters");
  if (profile.customPlaceholders.length > 20) throw new LineDueTemplateError("TEMPLATE_INVALID", "LINE profile supports at most 20 custom placeholders");
  const system = new Set<string>(systemPlaceholders(paymentType));
  const custom = new Map<string, CustomLinePlaceholder>();
  for (const definition of profile.customPlaceholders) {
    if (!CUSTOM_NAME.test(definition.name) || system.has(definition.name) || custom.has(definition.name)) throw new LineDueTemplateError("TEMPLATE_INVALID", `Invalid custom placeholder: ${definition.name}`);
    if (definition.template.length < 1 || definition.template.length > 1000) throw new LineDueTemplateError("TEMPLATE_INVALID", `Custom placeholder ${definition.name} must contain 1-1,000 characters`);
    const unsupported = lineDueTemplatePlaceholders(definition.template).find((name) => !system.has(name));
    if (unsupported) throw new LineDueTemplateError("TEMPLATE_INVALID", `Custom placeholder ${definition.name} cannot reference ${unsupported}`);
    custom.set(definition.name, definition);
  }
  const mainTokens = lineDueTemplatePlaceholders(profile.message);
  const unknown = mainTokens.find((name) => !system.has(name) && !custom.has(name));
  if (unknown) throw new LineDueTemplateError("TEMPLATE_INVALID", `Unsupported LINE placeholder: ${unknown}`);
  const reachable = new Set(mainTokens.filter((name) => system.has(name)));
  for (const name of mainTokens) for (const nested of custom.has(name) ? lineDueTemplatePlaceholders(custom.get(name)!.template) : []) reachable.add(nested);
  for (const required of REQUIRED) if (!reachable.has(required)) throw new LineDueTemplateError("TEMPLATE_INVALID", `LINE profile requires placeholder: ${required}`);
}
```

- [ ] **Step 6: Implement parsing, rendering, and legacy adaptation**

```ts
function substitute(template: string, values: Record<string, string | undefined>): string {
  return template.replace(TOKEN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new LineDueTemplateError("TEMPLATE_DATA_MISSING", `Missing LINE placeholder data: ${name}`);
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
  if (!result.success) throw new LineDueTemplateError("TEMPLATE_INVALID", "LINE profile shape is invalid");
  const profile = result.data;
  validateLineDueMessageProfile(profile, paymentType);
  return profile;
}

export function renderLineDueMessageProfile(profile: LineDueMessageProfile, paymentType: LinePaymentType, systemValues: LineDueSystemValues): string {
  validateLineDueMessageProfile(profile, paymentType);
  const customValues = Object.fromEntries(profile.customPlaceholders.map((definition) => [definition.name, substitute(definition.template, systemValues)]));
  const rendered = substitute(profile.message, { ...systemValues, ...customValues });
  if (rendered.length < 1 || rendered.length > 5000) throw new LineDueTemplateError("TEMPLATE_INVALID", "Rendered LINE due message must contain 1-5000 characters");
  return rendered;
}

export function legacyLineDueMessageProfile(template: string, paymentType: LinePaymentType): LineDueMessageProfile {
  const profile = { version: 1 as const, message: template, customPlaceholders: [{ name: "payment_label", template: "{{due_month_name}} Coaching" }] };
  validateLineDueMessageProfile(profile, paymentType);
  return profile;
}
```

Keep Zod issue details private so raw JSON/parser/schema details never reach admin or audit output.

- [ ] **Step 7: Run profile and legacy template tests**

Run: `npm test -- src/lib/line/message-profile.test.ts src/lib/line/message-template.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit profile domain**

```bash
git add src/lib/line/message-profile.ts src/lib/line/message-profile.test.ts
git commit -m "feat: add configurable LINE message profiles"
```

---

### Task 3: Profile Settings Persistence, Actions, and Fresh Defaults

**Files:**
- Modify: `src/lib/sheets/settings.ts:1-36`
- Modify: `src/lib/sheets/settings.test.ts:1-41`
- Modify: `src/app/admin/(protected)/settings/line-actions.ts:1-63`
- Modify: `src/app/admin/(protected)/settings/line-actions.test.ts:1-67`
- Modify: `src/lib/workspace/workbook.ts:1-32`
- Modify: `src/lib/workspace/workbook.test.ts:59-88`
- Modify: `src/lib/workspace/setup.ts:10-42`
- Test: existing `src/lib/workspace/setup.test.ts`

**Interfaces:**
- Consumes: Task 2 profile constants/parser/renderer.
- Produces:
  - `resolveLineDueMessageProfiles(settings: OperationalSetting[]): LineDueMessageProfiles`
  - `getLineDueMessageProfiles(): Promise<LineDueMessageProfiles>`
  - `saveLineDueMessageProfile(paymentType: LinePaymentType, profile: LineDueMessageProfile): Promise<void>`
  - `previewLineDueMessageProfileAction(formData)`, `saveLineDueMessageProfileAction(formData)`, and `resetLineDueMessageProfileAction(formData)`
  - fresh workbook rows for both JSON profile keys.

- [ ] **Step 1: Write failing Settings repository tests for stored profiles and independent legacy fallback**

Add imports and cases to `src/lib/sheets/settings.test.ts`:

```ts
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS } from "@/lib/line/message-profile";
import { getLineDueMessageProfiles, resolveLineDueMessageProfiles, saveLineDueMessageProfile, upsertOperationalSetting, upsertOperationalSettings } from "./settings";

it("resolves stored profiles independently and uses legacy fallback only for the absent type", () => {
  const storedOneTime = { ...DEFAULT_LINE_DUE_PROFILES.ONE_TIME, message: "One {{amount}} {{due_date}} {{payment_url}}" };
  const profiles = resolveLineDueMessageProfiles([
    { rowNumber: 2, key: LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, value: JSON.stringify(storedOneTime) },
    { rowNumber: 3, key: "line_due_message_template", value: "Legacy {{payment_label}} {{amount}} {{due_date}} {{payment_url}}" },
  ]);
  expect(profiles.ONE_TIME.message).toBe(storedOneTime.message);
  expect(profiles.INSTALLMENTS.message).toContain("Legacy");
  expect(profiles.INSTALLMENTS.customPlaceholders).toContainEqual({ name: "payment_label", template: "{{due_month_name}} Coaching" });
});

it("saves one validated profile as versioned JSON without touching the other profile", async () => {
  await saveLineDueMessageProfile("INSTALLMENTS", DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
  expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: expect.objectContaining({ data: [
    expect.objectContaining({ values: [[LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)]] }),
  ] }) }));
});
```

- [ ] **Step 2: Run Settings tests and verify RED**

Run: `npm test -- src/lib/sheets/settings.test.ts`

Expected: FAIL because profile repository exports do not exist.

- [ ] **Step 3: Implement profile resolution and persistence in Settings repository**

```ts
export function resolveLineDueMessageProfiles(settings: OperationalSetting[]): LineDueMessageProfiles {
  const byKey = new Map(settings.map((item) => [item.key, item.value]));
  const legacy = byKey.get("line_due_message_template");
  return Object.fromEntries((["ONE_TIME", "INSTALLMENTS"] as const).map((paymentType) => {
    const stored = byKey.get(LINE_DUE_PROFILE_SETTING_KEYS[paymentType]);
    if (stored) return [paymentType, parseLineDueMessageProfile(stored, paymentType)];
    if (legacy) return [paymentType, legacyLineDueMessageProfile(legacy, paymentType)];
    return [paymentType, DEFAULT_LINE_DUE_PROFILES[paymentType]];
  })) as LineDueMessageProfiles;
}

export async function getLineDueMessageProfiles(): Promise<LineDueMessageProfiles> {
  return resolveLineDueMessageProfiles(await listOperationalSettings());
}

export async function saveLineDueMessageProfile(paymentType: LinePaymentType, profile: LineDueMessageProfile): Promise<void> {
  validateLineDueMessageProfile(profile, paymentType);
  await upsertOperationalSetting(LINE_DUE_PROFILE_SETTING_KEYS[paymentType], JSON.stringify(profile));
}
```

Before `upsertOperationalSettings` writes, detect either profile setting key and call `parseLineDueMessageProfile(entry.value, matchingPaymentType)`. Keep existing legacy-template validation for `line_due_message_template`.

- [ ] **Step 4: Write failing profile action tests**

Extend action mocks with `saveLineDueMessageProfile`; submit `payment_type` and `profile` JSON:

```ts
it("previews an installment profile with safe server sample data", async () => {
  const formData = new FormData();
  formData.set("payment_type", "INSTALLMENTS");
  formData.set("profile", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS));
  await expect(previewLineDueMessageProfileAction(formData)).resolves.toMatchObject({
    ok: true,
    paymentType: "INSTALLMENTS",
    preview: expect.stringContaining("2nd payment out of 3"),
  });
  expect(mocks.saveLineDueMessageProfile).not.toHaveBeenCalled();
});

it("saves one profile and audits only its key and payment type", async () => {
  const formData = new FormData();
  formData.set("payment_type", "ONE_TIME");
  formData.set("profile", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME));
  await saveLineDueMessageProfileAction(formData);
  expect(mocks.saveLineDueMessageProfile).toHaveBeenCalledWith("ONE_TIME", DEFAULT_LINE_DUE_PROFILES.ONE_TIME);
  expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: "LINE_DUE_PROFILE_SAVED",
    metadata: JSON.stringify({ settingKey: "line_due_message_profile_one_time", paymentType: "ONE_TIME" }),
  }));
  expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain(DEFAULT_LINE_DUE_PROFILES.ONE_TIME.message);
});

it("rejects invalid profile JSON before persistence or audit", async () => {
  const formData = new FormData();
  formData.set("payment_type", "ONE_TIME");
  formData.set("profile", JSON.stringify({ version: 1, message: "{{amount}} {{due_date}}", customPlaceholders: [] }));
  await expect(saveLineDueMessageProfileAction(formData)).rejects.toThrow(/payment_url/);
  expect(mocks.saveLineDueMessageProfile).not.toHaveBeenCalled();
  expect(mocks.appendAudit).not.toHaveBeenCalled();
});

it("resets only the selected profile to its documented default", async () => {
  const formData = new FormData();
  formData.set("payment_type", "INSTALLMENTS");
  const result = await resetLineDueMessageProfileAction(formData);
  expect(mocks.saveLineDueMessageProfile).toHaveBeenCalledWith("INSTALLMENTS", DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
  expect(result.profile).toEqual(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
  expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_DUE_PROFILE_RESET" }));
});
```

- [ ] **Step 5: Implement safe action parsing, preview, save, and reset**

```ts
function submittedPaymentType(formData: FormData): LinePaymentType {
  const value = String(formData.get("payment_type") ?? "");
  if (value !== "ONE_TIME" && value !== "INSTALLMENTS") throw new LineDueTemplateError("TEMPLATE_INVALID", "Payment type is required");
  return value;
}

function submittedProfile(formData: FormData, paymentType: LinePaymentType): LineDueMessageProfile {
  return parseLineDueMessageProfile(String(formData.get("profile") ?? ""), paymentType);
}

function previewValues(paymentType: LinePaymentType): LineDueSystemValues {
  const common: LineDueSystemValues = {
    client_name: "Nisa",
    package_name: "Personal Training",
    payment_type: paymentType === "ONE_TIME" ? "One-time payment" : "Installments",
    amount: "฿1,500.00",
    total_amount: paymentType === "ONE_TIME" ? "฿1,500.00" : "฿4,500.00",
    due_date: "2026-08-15",
    due_month_name: "August",
    payment_url: "https://payments.example/p/sample-token",
  };
  return paymentType === "INSTALLMENTS" ? {
    ...common,
    installment_number: "2",
    installment_ordinal: "2nd",
    installment_number_word: "two",
    installment_ordinal_word: "second",
    installment_count: "3",
    installment_count_word: "three",
  } : common;
}

export async function previewLineDueMessageProfileAction(formData: FormData): Promise<LineDueMessageProfileActionResult> {
  await requireAdmin();
  const paymentType = submittedPaymentType(formData);
  const profile = submittedProfile(formData, paymentType);
  return { ok: true, paymentType, profile, preview: renderLineDueMessageProfile(profile, paymentType, previewValues(paymentType)) };
}
```

Implement save with `saveLineDueMessageProfile`, audit action `LINE_DUE_PROFILE_SAVED`, and `/admin/settings` revalidation. Implement reset by loading `DEFAULT_LINE_DUE_PROFILES[paymentType]`, saving it, auditing `LINE_DUE_PROFILE_RESET`, and returning its preview. Keep existing credential action unchanged. Retain old template action exports until Task 6 changes the component/page, preventing an intermediate build break.

- [ ] **Step 6: Update fresh workbook/setup defaults with failing assertions first**

In `src/lib/workspace/workbook.test.ts`, replace the seven-row legacy expectation with eight rows through `B9`:

```ts
expect(headerWrite.requestBody.data).toEqual(expect.arrayContaining([
  { range: "Settings!A2:B9", values: expect.arrayContaining([
    ["line_due_message_profile_one_time", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME)],
    ["line_due_message_profile_installments", JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)],
  ]) },
]));
```

In `src/lib/workspace/setup.test.ts`, assert staged setup writes both profile keys and does not write `line_due_message_template` for a fresh workbook.

- [ ] **Step 7: Replace fresh legacy defaults with profile JSON rows**

```ts
const DEFAULT_SETTING_ROWS = [
  ["business_display_name", "Coaching Payments"],
  ["slip_retention_days", "30"],
  ["ocr_enabled", "true"],
  ["line_linking_enabled", "false"],
  ["line_messaging_enabled", "false"],
  ["line_chat_payments_enabled", "false"],
  [LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME)],
  [LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS)],
] as const;
```

Change workbook initialization range from `Settings!A2:B8` to `Settings!A2:B9`. Apply the same two profile entries in `writeStagedSettings`; do not delete or overwrite a legacy key in an existing workbook.

- [ ] **Step 8: Run persistence, action, and workbook tests**

Run: `npm test -- src/lib/sheets/settings.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts' src/lib/workspace/workbook.test.ts src/lib/workspace/setup.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit profile persistence**

```bash
git add src/lib/sheets/settings.ts src/lib/sheets/settings.test.ts 'src/app/admin/(protected)/settings/line-actions.ts' 'src/app/admin/(protected)/settings/line-actions.test.ts' src/lib/workspace/workbook.ts src/lib/workspace/workbook.test.ts src/lib/workspace/setup.ts src/lib/workspace/setup.test.ts
git commit -m "feat: persist LINE message profiles"
```

---

### Task 4: Payment Message Snapshot Schema and Generation

**Files:**
- Modify: `src/lib/sheets/records.ts:1-3`
- Modify: `src/lib/sheets/records.test.ts:18-79`
- Modify: `src/lib/sheets/payments.ts:55-60,105-123`
- Modify: `src/lib/sheets/payments.test.ts`
- Modify: `src/lib/sheets/migration.test.ts:56-90`
- Modify: `src/lib/plans/schedule.ts:24-34,76-126`
- Modify: `src/lib/plans/schedule.test.ts:29-56`
- Modify: `src/lib/payments/generate.ts:31-49`
- Modify: `src/lib/payments/generate.test.ts:16-46`
- Modify: `src/lib/workspace/workbook.ts:20-31`
- Modify: `src/lib/workspace/workbook.test.ts:72-81`

**Interfaces:**
- Consumes: existing `ScheduleRecord[]`, satang parser, Payment repository.
- Produces: five appended Payment fields and `planTotalSatangForSchedule(target, schedules): number`.
- Changes: `buildPaymentForSchedule(schedule, input)` input adds `planTotalSatang: number`.

- [ ] **Step 1: Write failing exact-schema and range tests for 49 Payment columns**

Append fields after `line_reply_at` and change expected ranges from `AR` to `AW`:

```ts
expect(PAYMENT_HEADERS.slice(-5)).toEqual([
  "package_name",
  "payment_type",
  "installment_number",
  "installment_count",
  "total_price_thb",
]);
expect(PAYMENT_HEADERS).toHaveLength(49);
expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Payments!A:AW" });
expect(append).toHaveBeenCalledWith(expect.objectContaining({ range: "Payments!A:AW" }));
expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { requests: expect.arrayContaining([
  expect.objectContaining({ updateCells: expect.objectContaining({ range: expect.objectContaining({ endColumnIndex: 49 }) }) }),
] } }));
```

Update `src/lib/sheets/migration.test.ts` to expect a 30-column grid expansion by nineteen columns, header read `Payments!A1:AW1`, old last LINE header at `AR1`, and new snapshot headers at `AS1:AW1`.

- [ ] **Step 2: Run schema tests and verify RED**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/sheets/payments.test.ts src/lib/sheets/migration.test.ts src/lib/workspace/workbook.test.ts`

Expected: FAIL on 44-column headers/ranges.

- [ ] **Step 3: Append snapshot fields and update every canonical Payment range**

```ts
export const PAYMENT_HEADERS = [
  "payment_id", "client_id", "client_name", "period", "amount_thb", "due_date", "public_token", "payment_url", "status", "created_at",
  "submitted_at", "recorded_at", "manual_confirmed_at", "transaction_ref", "originating_bank", "slip_hash", "qr_valid", "ocr_amount", "amount_match",
  "ocr_receiver", "receiver_match", "ocr_transaction_date", "date_match", "check_score", "review_reason", "slip_url", "admin_notes", "line_message",
  "updated_at", "qr_payload_hash", "line_message_status", "line_retry_key", "line_message_attempted_at", "line_message_sent_at", "line_request_id", "line_message_error",
  "line_payment_requested_at", "line_slip_expected", "line_slip_received_at", "line_source_message_id", "line_slip_processing_status", "line_slip_error", "line_reply_status", "line_reply_at",
  "package_name", "payment_type", "installment_number", "installment_count", "total_price_thb",
] as const;
```

Replace all Payment ranges in source/tests:

- `Payments!A:AR` → `Payments!A:AW`
- `Payments!A1:AR1` → `Payments!A1:AW1`
- row ranges ending `AR${row}` → `AW${row}`
- grid/end column `44` → `49`

`ensurePaymentSchema()` already derives length from `PAYMENT_HEADERS`; keep `firstHeaderToFill = 30` so only blank appended cells are populated.

- [ ] **Step 4: Write failing plan-total and snapshot generation tests**

```ts
it("calculates exact plan total from rows created in one assignment", () => {
  const rows = ["333.33", "333.33", "333.34"].map((amount_thb, index) => ({
    schedule_id: `s${index + 1}`,
    client_id: "client_1",
    package_name: "PT",
    payment_type: "INSTALLMENTS",
    installment_number: String(index + 1),
    installment_count: "3",
    amount_thb,
    created_at: "2026-08-01T00:00:00.000Z",
  }));
  expect(planTotalSatangForSchedule(rows[1], rows)).toBe(100_000);
});

it("snapshots client-facing plan data onto the generated payment", () => {
  const payment = buildPaymentForSchedule({
    schedule_id: "schedule_2",
    client_id: "client_1",
    client_name: "Nisa",
    line_display_name: "",
    package_name: "PT",
    payment_type: "INSTALLMENTS",
    installment_number: "2",
    installment_count: "3",
    amount_thb: "1000",
    due_date: "2026-09-10",
    created_at: "2026-08-01T00:00:00.000Z",
  }, {
    paymentId: "pay_1",
    publicToken: "token",
    baseUrl: "https://pay.example",
    createdAt: "2026-08-10T03:00:00.000Z",
    planTotalSatang: 300_000,
  });
  expect(payment).toMatchObject({
    package_name: "PT",
    payment_type: "INSTALLMENTS",
    installment_number: "2",
    installment_count: "3",
    total_price_thb: "3000",
  });
});
```

In `src/lib/payments/generate.test.ts`, make both schedule rows share `created_at` and assert appended Payment received `total_price_thb: "3000"` before `appendPayment`.

- [ ] **Step 5: Run schedule/generation tests and verify RED**

Run: `npm test -- src/lib/plans/schedule.test.ts src/lib/payments/generate.test.ts`

Expected: FAIL because total helper/input/snapshot fields are absent.

- [ ] **Step 6: Implement canonical schedule-group total calculation**

```ts
type PlanSchedule = Pick<PaymentSchedule, "client_id" | "package_name" | "installment_count" | "amount_thb"> & {
  payment_type: string;
  installment_number: string;
  created_at: string;
};

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
```

- [ ] **Step 7: Snapshot fields in payment builder and generator**

Add `payment_type` and `created_at` to `PaymentSchedule`, add `planTotalSatang` to builder input, and validate before constructing the row:

```ts
const installmentNumber = Number(schedule.installment_number);
const installmentCount = Number(schedule.installment_count);
if (schedule.payment_type !== "ONE_TIME" && schedule.payment_type !== "INSTALLMENTS") throw new Error(`Schedule ${schedule.schedule_id} has an invalid payment type`);
if (!Number.isSafeInteger(installmentNumber) || !Number.isSafeInteger(installmentCount) || installmentNumber < 1 || installmentCount < 1 || installmentNumber > installmentCount) {
  throw new Error(`Schedule ${schedule.schedule_id} has an invalid installment position`);
}
if (!Number.isSafeInteger(input.planTotalSatang) || input.planTotalSatang <= 0) throw new Error(`Schedule ${schedule.schedule_id} has an invalid plan total`);
```

Append:

```ts
package_name: schedule.package_name,
payment_type: schedule.payment_type,
installment_number: schedule.installment_number,
installment_count: schedule.installment_count,
total_price_thb: String(input.planTotalSatang / 100),
```

In `generateDuePaymentLinks`, calculate before building:

```ts
const planTotalSatang = planTotalSatangForSchedule(schedule, schedules);
const payment = buildPaymentForSchedule(schedule, {
  paymentId: options.createPaymentId?.() ?? `pay_${randomUUID().replaceAll("-", "")}`,
  publicToken: options.createToken?.() ?? createPublicToken(),
  baseUrl: options.baseUrl,
  createdAt: now,
  planTotalSatang,
});
```

- [ ] **Step 8: Run all schema and generation tests**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/sheets/payments.test.ts src/lib/sheets/migration.test.ts src/lib/plans/schedule.test.ts src/lib/payments/generate.test.ts src/lib/workspace/workbook.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Payment snapshot schema**

```bash
git add src/lib/sheets/records.ts src/lib/sheets/records.test.ts src/lib/sheets/payments.ts src/lib/sheets/payments.test.ts src/lib/sheets/migration.test.ts src/lib/plans/schedule.ts src/lib/plans/schedule.test.ts src/lib/payments/generate.ts src/lib/payments/generate.test.ts src/lib/workspace/workbook.ts src/lib/workspace/workbook.test.ts
git commit -m "feat: snapshot LINE payment message data"
```

---

### Task 5: Message Values, Legacy Snapshot, and LINE Delivery

**Files:**
- Create: `src/lib/line/message-values.ts`
- Create: `src/lib/line/message-values.test.ts`
- Modify: `src/lib/sheets/payment-client-snapshot.ts:1-30`
- Modify: `src/lib/sheets/payment-client-snapshot.test.ts:1-48`
- Modify: `src/lib/line/due-payments.ts:1-61,105-114,224-380`
- Modify: `src/lib/line/due-payments.test.ts`

**Interfaces:**
- Consumes: profile renderer/settings from Tasks 2–3, Payment snapshot fields and `planTotalSatangForSchedule` from Task 4, Task 1 language formatters.
- Produces:
  - `resolveLineDueMessageValues({ payment, client, schedules }): { paymentType: LinePaymentType; values: LineDueSystemValues }`
  - `PaymentClientSnapshot` extended with `schedules: ScheduleRecord[]`.
- Changes: `LineDueDependencies` replaces `getLineDueTemplate` with `getLineDueMessageProfiles` and adds schedule fallback for non-batched test dependencies.

- [ ] **Step 1: Write failing protected-value resolver tests**

```ts
import { describe, expect, it } from "vitest";
import { CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS } from "@/lib/sheets/records";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import { resolveLineDueMessageValues } from "./message-values";

function blankRecord(headers: readonly string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header, ""]));
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { ...blankRecord(PAYMENT_HEADERS), rowNumber: 2, payment_id: "pay_1", client_id: "client_1", amount_thb: "1500", due_date: "2026-08-10", payment_url: "https://pay.example/p/token_1", ...overrides } as PaymentRecord;
}

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return { ...blankRecord(CLIENT_HEADERS), rowNumber: 2, client_id: "client_1", client_name: "Nisa Current", ...overrides } as ClientRecord;
}

function schedule(overrides: Partial<ScheduleRecord>): ScheduleRecord {
  return { ...blankRecord(SCHEDULE_HEADERS), rowNumber: 2, client_id: "client_1", package_name: "PT", payment_type: "INSTALLMENTS", installment_count: "3", created_at: "2026-08-01T00:00:00.000Z", ...overrides } as ScheduleRecord;
}

it("prefers stable Payment plan snapshot and current Client name", () => {
  const result = resolveLineDueMessageValues({
    payment: payment({ package_name: "Original PT", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "3", total_price_thb: "4500" }),
    client: client({ client_name: "Nisa Current", package_name: "Changed package", total_price_thb: "9999" }),
    schedules: [],
  });
  expect(result).toEqual({ paymentType: "INSTALLMENTS", values: expect.objectContaining({
    client_name: "Nisa Current",
    package_name: "Original PT",
    payment_type: "Installments",
    installment_number: "2",
    installment_ordinal: "2nd",
    installment_number_word: "two",
    installment_ordinal_word: "second",
    installment_count: "3",
    installment_count_word: "three",
    amount: "฿1,500.00",
    total_amount: "฿4,500.00",
    due_date: "2026-08-10",
    due_month_name: "August",
    payment_url: "https://pay.example/p/token_1",
  }) });
});

it("resolves a legacy Payment from its matched schedule group", () => {
  const schedules = ["1500", "1500", "1500"].map((amount_thb, index) => schedule({
    rowNumber: index + 2,
    schedule_id: `schedule_${index + 1}`,
    installment_number: String(index + 1),
    amount_thb,
    payment_id: index === 1 ? "pay_1" : "",
  }));
  const result = resolveLineDueMessageValues({
    payment: payment(),
    client: client(),
    schedules,
  });
  expect(result.paymentType).toBe("INSTALLMENTS");
  expect(result.values).toMatchObject({ package_name: "PT", installment_ordinal_word: "second", total_amount: "฿4,500.00" });
});
```

- [ ] **Step 2: Run resolver tests and verify RED**

Run: `npm test -- src/lib/line/message-values.test.ts`

Expected: FAIL because resolver module does not exist.

- [ ] **Step 3: Implement snapshot-first, schedule-fallback value resolution**

```ts
export function resolveLineDueMessageValues({ payment, client, schedules }: {
  payment: PaymentRecord;
  client: ClientRecord;
  schedules: readonly ScheduleRecord[];
}): { paymentType: LinePaymentType; values: LineDueSystemValues } {
  const legacySchedule = schedules.find((item) => item.payment_id === payment.payment_id);
  const paymentType = payment.payment_type || legacySchedule?.payment_type;
  if (paymentType !== "ONE_TIME" && paymentType !== "INSTALLMENTS") throw new LineDueTemplateError("TEMPLATE_DATA_MISSING", "Missing payment type");
  const packageName = payment.package_name || legacySchedule?.package_name;
  const installmentNumber = payment.installment_number || legacySchedule?.installment_number;
  const installmentCount = payment.installment_count || legacySchedule?.installment_count;
  const totalSatang = parseSatang(payment.total_price_thb)
    ?? (legacySchedule ? planTotalSatangForSchedule(legacySchedule, schedules) : null);
  const values: LineDueSystemValues = {
    client_name: client.client_name,
    package_name: packageName || undefined,
    payment_type: paymentType === "ONE_TIME" ? "One-time payment" : "Installments",
    amount: formatThb(parseSatang(payment.amount_thb)!),
    total_amount: totalSatang === null ? undefined : formatThb(totalSatang),
    due_date: payment.due_date,
    due_month_name: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "Asia/Bangkok" }).format(new Date(`${payment.due_date}T12:00:00+07:00`)),
    payment_url: payment.payment_url,
  };
  if (paymentType === "INSTALLMENTS" && installmentNumber && installmentCount) {
    const number = Number(installmentNumber);
    const count = Number(installmentCount);
    if (!Number.isSafeInteger(number) || !Number.isSafeInteger(count) || number < 1 || count < 1 || number > count) {
      throw new LineDueTemplateError("TEMPLATE_DATA_MISSING", "Invalid installment position");
    }
    Object.assign(values, {
      installment_number: String(number),
      installment_ordinal: formatOrdinalNumber(number),
      installment_number_word: formatCardinalWord(number),
      installment_ordinal_word: formatOrdinalWord(number),
      installment_count: String(count),
      installment_count_word: formatCardinalWord(count),
    });
  } else if (paymentType === "INSTALLMENTS") {
    throw new LineDueTemplateError("TEMPLATE_DATA_MISSING", "Missing installment position");
  }
  return { paymentType, values };
}
```

Validate canonical amount/date/URL with the sender's existing guards before calling this resolver. Convert schedule-total calculation errors into `LineDueTemplateError("TEMPLATE_DATA_MISSING", "Missing plan total")` without exposing raw row data.

- [ ] **Step 4: Write failing three-ledger batch snapshot test**

Update mock `valueRanges` with Schedule headers/row and assert:

```ts
expect(mocks.batchGet).toHaveBeenCalledWith({
  spreadsheetId: "sheet_1",
  ranges: ["Payments!A:AW", "Clients!A:W", "Installment Schedule!A:R"],
});
expect(snapshot.schedules).toMatchObject([{ schedule_id: "schedule_1", payment_id: "pay_1", rowNumber: 2 }]);
```

- [ ] **Step 5: Extend batched snapshot to schedules**

Import `ScheduleRecord`, `SCHEDULE_HEADERS`, parse the third value range, and change the return type/comment:

```ts
export type PaymentClientSnapshot = {
  payments: PaymentRecord[];
  clients: ClientRecord[];
  schedules: ScheduleRecord[];
};
```

Keep exactly one `values.batchGet` request.

- [ ] **Step 6: Write failing sender tests for profile selection, cache, legacy fallback, and failures**

Replace test dependency `getLineDueTemplate` with `getLineDueMessageProfiles`, add an empty `listSchedules` mock, and import `DEFAULT_LINE_DUE_PROFILES` plus `LineDueTemplateError` from `./message-profile`. Add explicit tests:

```ts
it("selects installment profile and loads both profiles once for multiple payments", async () => {
  const deps = dependencies([
    payment({ payment_id: "pay_1", payment_type: "INSTALLMENTS", package_name: "PT", installment_number: "1", installment_count: "2", total_price_thb: "3000" }),
    payment({ payment_id: "pay_2", rowNumber: 3, payment_type: "INSTALLMENTS", package_name: "PT", installment_number: "2", installment_count: "2", total_price_thb: "3000" }),
  ]);
  await sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps);
  expect(deps.getLineDueMessageProfiles).toHaveBeenCalledOnce();
  expect(deps.sendPush.mock.calls[1][0].messages[0].text).toContain("2nd payment out of 2");
});

it("records TEMPLATE_INVALID and sends nothing for corrupt stored profiles", async () => {
  const deps = dependencies();
  deps.getLineDueMessageProfiles.mockRejectedValue(new LineDueTemplateError("TEMPLATE_INVALID", "Stored LINE profile is invalid JSON"));
  await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ failed: ["pay_1"] });
  expect(deps.sendPush).not.toHaveBeenCalled();
  expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_error: "TEMPLATE_INVALID" });
});

it("records TEMPLATE_DATA_MISSING and sends nothing when legacy plan data cannot be resolved", async () => {
  const deps = dependencies([payment({ payment_type: "ONE_TIME", package_name: "", total_price_thb: "" })]);
  deps.getLineDueMessageProfiles.mockResolvedValue({
    ONE_TIME: { version: 1, message: "{{total_amount}} {{amount}} {{due_date}} {{payment_url}}", customPlaceholders: [] },
    INSTALLMENTS: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS,
  });
  await expect(sendDueLinePaymentRequests({ baseUrl: "https://pay.example", today: "2026-08-10" }, deps)).resolves.toMatchObject({ failed: ["pay_1"] });
  expect(deps.sendPush).not.toHaveBeenCalled();
  expect(deps.updatePayment.mock.calls.at(-1)?.[0]).toMatchObject({ line_message_status: "FAILED_RETRYABLE", line_message_error: "TEMPLATE_DATA_MISSING" });
});
```

Retain and adapt existing tests proving current client identity, frozen retry text, retry key ordering, ambiguous delivery, audit reconciliation, QR sending, and candidate filtering.

- [ ] **Step 7: Integrate profiles into sender with one lazy settings read**

Change dependency surface:

```ts
getLineDueMessageProfiles: () => Promise<LineDueMessageProfiles>;
listSchedules: () => Promise<ScheduleRecord[]>;
```

Change fallback snapshot loading to return schedules as well. In `sendDueLinePaymentRequests`, keep `let profilesPromise: Promise<LineDueMessageProfiles> | null = null;` outside the payment loop so valid and corrupt Settings reads are both attempted once. Only resolve profiles/values for a non-frozen message:

```ts
let lineMessage: string;
if (hasFrozenRetryMessage(payment)) {
  lineMessage = payment.line_message;
} else {
  profilesPromise ??= dependencies.getLineDueMessageProfiles();
  const profiles = await profilesPromise;
  const { paymentType, values } = resolveLineDueMessageValues({ payment, client: recipient, schedules });
  lineMessage = renderLineDueMessageProfile(profiles[paymentType], paymentType, values);
}
```

Catch `LineDueTemplateError` around profile load/resolution/rendering before channel-token lookup or push. Persist `FAILED_RETRYABLE`, set `line_message_error` to `error.code`, append `LINE_DUE_MESSAGE_FAILED` with the same stable request code, add payment ID to `failed`, and continue. Do not persist an incomplete `line_message` or retry key for template failures.

- [ ] **Step 8: Run resolver, snapshot, sender, and template tests**

Run: `npm test -- src/lib/line/message-values.test.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/line/due-payments.test.ts src/lib/line/message-profile.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit delivery integration**

```bash
git add src/lib/line/message-values.ts src/lib/line/message-values.test.ts src/lib/sheets/payment-client-snapshot.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/line/due-payments.ts src/lib/line/due-payments.test.ts
git commit -m "feat: render LINE payment message profiles"
```

---

### Task 6: Two-Profile Placeholder Editor

**Files:**
- Create: `src/components/admin/line-placeholder-editor.tsx`
- Modify: `src/components/admin/line-due-template-form.tsx:1-84`
- Modify: `src/components/admin/line-due-template-form.test.ts:1-60`
- Modify: `src/app/admin/(protected)/settings/page.tsx:1-40`
- Modify: `src/app/admin/(protected)/settings/line-actions.ts` (remove superseded legacy template actions)
- Modify: `src/app/admin/(protected)/settings/line-actions.test.ts` (remove superseded legacy action cases)

**Interfaces:**
- Consumes: Task 2 catalogs/types/defaults and Task 3 profile server actions.
- Produces: `LineDueTemplateForm` accepting `profiles: LineDueMessageProfiles` and profile preview/save/reset actions.
- Produces: reusable `LinePlaceholderEditor` with caret-aware insertion.

- [ ] **Step 1: Write failing caret-insertion component tests**

Replace old single-template cases with two-profile props, add `within` to the Testing Library import, and stub `requestAnimationFrame` through a microtask in setup. Add:

```ts
type RenderOptions = {
  oneTimeMessage?: string;
  previewAction?: ReturnType<typeof vi.fn>;
};

function renderProfileForm(options: RenderOptions = {}) {
  const profiles = structuredClone(DEFAULT_LINE_DUE_PROFILES);
  if (options.oneTimeMessage !== undefined) profiles.ONE_TIME.message = options.oneTimeMessage;
  const previewAction = options.previewAction ?? vi.fn().mockResolvedValue({ ok: true, paymentType: "ONE_TIME", profile: profiles.ONE_TIME, preview: "Preview" });
  const saveAction = vi.fn().mockImplementation(async (formData: FormData) => {
    const paymentType = String(formData.get("payment_type")) as "ONE_TIME" | "INSTALLMENTS";
    const profile = JSON.parse(String(formData.get("profile")));
    return { ok: true, paymentType, profile, preview: "Saved preview" };
  });
  const resetAction = vi.fn().mockImplementation(async (formData: FormData) => {
    const paymentType = String(formData.get("payment_type")) as "ONE_TIME" | "INSTALLMENTS";
    return { ok: true, paymentType, profile: DEFAULT_LINE_DUE_PROFILES[paymentType], preview: "Default preview" };
  });
  render(createElement(LineDueTemplateForm, {
    profiles,
    messagingEnabled: true,
    chatPaymentsEnabled: true,
    previewAction,
    saveAction,
    resetAction,
  }));
  return { previewAction, saveAction, resetAction };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
});

it("inserts a system placeholder at the current message caret and restores focus", async () => {
  renderProfileForm();
  const textarea = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
  const editor = screen.getByRole("group", { name: "One-time payment message editor" });
  fireEvent.change(textarea, { target: { value: "Pay  now" } });
  textarea.focus();
  textarea.setSelectionRange(4, 4);
  fireEvent.click(within(editor).getByRole("button", { name: "Insert {{amount}}" }));
  await waitFor(() => {
    expect(textarea.value).toBe("Pay {{amount}} now");
    expect(textarea.selectionStart).toBe("Pay {{amount}}".length);
    expect(document.activeElement).toBe(textarea);
  });
});

it("replaces selected text with a custom placeholder", () => {
  renderProfileForm({ oneTimeMessage: "Hello old text" });
  const textarea = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
  textarea.setSelectionRange(6, 14);
  fireEvent.click(screen.getByRole("button", { name: "Insert {{payment_label}}" }));
  expect(textarea.value).toBe("Hello {{payment_label}}" );
});

it("supports insertion at start, end, and repeated caret positions", async () => {
  renderProfileForm({ oneTimeMessage: "Pay" });
  const textarea = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
  const editor = screen.getByRole("group", { name: "One-time payment message editor" });
  textarea.setSelectionRange(0, 0);
  fireEvent.click(within(editor).getByRole("button", { name: "Insert {{client_name}}" }));
  await waitFor(() => expect(textarea.value).toBe("{{client_name}}Pay"));
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  fireEvent.click(within(editor).getByRole("button", { name: "Insert {{amount}}" }));
  await waitFor(() => expect(textarea.value).toBe("{{client_name}}Pay{{amount}}"));
  fireEvent.click(within(editor).getByRole("button", { name: "Insert {{amount}}" }));
  await waitFor(() => expect(textarea.value).toBe("{{client_name}}Pay{{amount}}{{amount}}"));
});
```

- [ ] **Step 2: Write failing profile/custom lifecycle tests**

```ts
it("shows installment word buttons only in installment tab", () => {
  renderProfileForm();
  expect(screen.queryByRole("button", { name: "Insert {{installment_ordinal_word}}" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Installments" }));
  const editor = screen.getByRole("group", { name: "Installment payment message editor" });
  expect(within(editor).getByRole("button", { name: "Insert {{installment_ordinal_word}}" })).toBeTruthy();
});

it("adds a custom placeholder and inserts it into the active profile message", () => {
  renderProfileForm();
  fireEvent.click(screen.getByRole("button", { name: "Add placeholder" }));
  fireEvent.change(screen.getByLabelText("Placeholder name custom_1"), { target: { value: "greeting" } });
  fireEvent.change(screen.getByLabelText("Placeholder content greeting"), { target: { value: "Hi {{client_name}}" } });
  expect(screen.getByRole("button", { name: "Insert {{greeting}}" })).toBeTruthy();
});

it("blocks rename and removal while the custom placeholder is referenced", () => {
  renderProfileForm({ oneTimeMessage: "{{payment_label}} {{amount}} {{due_date}} {{payment_url}}" });
  expect((screen.getByLabelText("Placeholder name payment_label") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Remove payment_label" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/remove it from the message before renaming or deleting/i)).toBeTruthy();
});

it("renames and removes an unused custom placeholder", () => {
  renderProfileForm({ oneTimeMessage: "{{amount}} {{due_date}} {{payment_url}}" });
  fireEvent.change(screen.getByLabelText("Placeholder name payment_label"), { target: { value: "summary" } });
  expect(screen.getByLabelText("Placeholder name summary")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove summary" }));
  expect(screen.queryByLabelText("Placeholder name summary")).toBeNull();
});

it("submits only the active profile as JSON and applies server preview", async () => {
  const previewAction = vi.fn().mockResolvedValue({ ok: true, paymentType: "INSTALLMENTS", profile: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, preview: "Second payment preview" });
  renderProfileForm({ previewAction });
  fireEvent.click(screen.getByRole("tab", { name: "Installments" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
  await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());
  const submitted = previewAction.mock.calls[0][0] as FormData;
  expect(submitted.get("payment_type")).toBe("INSTALLMENTS");
  expect(JSON.parse(String(submitted.get("profile")))).toEqual(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
  expect(screen.getByText("Second payment preview")).toBeTruthy();
});

it("keeps unsaved edits independent while saving or resetting the other tab", async () => {
  const { saveAction, resetAction } = renderProfileForm();
  const oneTime = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
  fireEvent.change(oneTime, { target: { value: "One-time draft {{amount}} {{due_date}} {{payment_url}}" } });
  fireEvent.click(screen.getByRole("tab", { name: "Installments" }));
  const installment = screen.getByLabelText("Installment payment message") as HTMLTextAreaElement;
  fireEvent.change(installment, { target: { value: "Installment draft {{amount}} {{due_date}} {{payment_url}}" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
  expect((saveAction.mock.calls[0][0] as FormData).get("payment_type")).toBe("INSTALLMENTS");
  fireEvent.click(screen.getByRole("button", { name: "Restore default" }));
  await waitFor(() => expect(resetAction).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("tab", { name: "One-time payment" }));
  expect((screen.getByLabelText("One-time payment message") as HTMLTextAreaElement).value).toContain("One-time draft");
});
```

- [ ] **Step 3: Run UI tests and verify RED**

Run: `npm test -- src/components/admin/line-due-template-form.test.ts`

Expected: FAIL because current component has one textarea and no placeholder buttons/tabs.

- [ ] **Step 4: Implement reusable controlled placeholder textarea**

```tsx
type PlaceholderOption = { name: string; label: string };

export function LinePlaceholderEditor({ id, label, value, placeholders, onChange, rows = 4 }: {
  id: string;
  label: string;
  value: string;
  placeholders: PlaceholderOption[];
  onChange: (value: string) => void;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (name: string) => {
    const textarea = ref.current;
    if (!textarea) return;
    const token = `{{${name}}}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      const caret = start + token.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };
  return <Field role="group" aria-label={`${label} editor`}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <div className="flex flex-wrap gap-2">{placeholders.map((item) => (
      <Button key={item.name} type="button" size="sm" variant="outline" aria-label={`Insert {{${item.name}}}`} onClick={() => insert(item.name)}>{item.label}</Button>
    ))}</div>
    <Textarea ref={ref} id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={rows} />
  </Field>;
}
```

- [ ] **Step 5: Implement two-tab profile/custom editor state**

Use existing `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent`. Keep a `LineDueMessageProfiles` state initialized from props and update only the active profile. Render:

- common system buttons in both tabs;
- installment buttons only in `INSTALLMENTS`;
- system-only buttons for each custom definition editor;
- system-plus-current-custom buttons for the main editor;
- one name `Input`, one `LinePlaceholderEditor`, and one remove button per custom definition;
- Add placeholder button creating the next unused incrementing name (`custom_1`, then `custom_2`) with empty draft content;
- disabled rename/remove controls while `profile.message` contains that exact token;
- profile-local preview/outcome strings;
- profile-local preview/save/reset action calls.

Use these state helpers so profile edits remain isolated and reference checks use the domain parser rather than string matching:

```tsx
type ProfileAction = (formData: FormData) => Promise<LineDueMessageProfileActionResult>;
type Props = {
  profiles: LineDueMessageProfiles;
  messagingEnabled: boolean;
  chatPaymentsEnabled: boolean;
  previewAction: ProfileAction;
  saveAction: ProfileAction;
  resetAction: ProfileAction;
};

export function LineDueTemplateForm({ profiles: initialProfiles, messagingEnabled, chatPaymentsEnabled, previewAction, saveAction, resetAction }: Props) {
const paymentTypes = ["ONE_TIME", "INSTALLMENTS"] as const;
const [profiles, setProfiles] = useState<LineDueMessageProfiles>(() => structuredClone(initialProfiles));
const [activeType, setActiveType] = useState<LinePaymentType>("ONE_TIME");
const [previewByType, setPreviewByType] = useState<Record<LinePaymentType, string>>({ ONE_TIME: "", INSTALLMENTS: "" });
const [outcomeByType, setOutcomeByType] = useState<Record<LinePaymentType, string>>({ ONE_TIME: "", INSTALLMENTS: "" });
const [pending, startTransition] = useTransition();

function updateProfile(paymentType: LinePaymentType, update: (profile: LineDueMessageProfile) => LineDueMessageProfile): void {
  setProfiles((current) => ({ ...current, [paymentType]: update(current[paymentType]) }));
}

function customIsReferenced(profile: LineDueMessageProfile, name: string): boolean {
  try {
    return lineDueTemplatePlaceholders(profile.message).includes(name);
  } catch {
    return true;
  }
}

function nextCustomName(profile: LineDueMessageProfile): string {
  const used = new Set(profile.customPlaceholders.map((item) => item.name));
  let index = 1;
  while (used.has(`custom_${index}`)) index += 1;
  return `custom_${index}`;
}

function updateCustomTemplate(paymentType: LinePaymentType, name: string, template: string): void {
  updateProfile(paymentType, (profile) => ({
    ...profile,
    customPlaceholders: profile.customPlaceholders.map((item) => item.name === name ? { ...item, template } : item),
  }));
}

function renameCustom(paymentType: LinePaymentType, index: number, name: string): void {
  updateProfile(paymentType, (profile) => ({
    ...profile,
    customPlaceholders: profile.customPlaceholders.map((item, itemIndex) => itemIndex === index ? { ...item, name } : item),
  }));
}

function removeCustom(paymentType: LinePaymentType, name: string): void {
  updateProfile(paymentType, (profile) => customIsReferenced(profile, name) ? profile : {
    ...profile,
    customPlaceholders: profile.customPlaceholders.filter((item) => item.name !== name),
  });
}

function addCustom(paymentType: LinePaymentType): void {
  updateProfile(paymentType, (profile) => ({
    ...profile,
    customPlaceholders: [...profile.customPlaceholders, { name: nextCustomName(profile), template: "" }],
  }));
}
```

Render tabs without mounting one shared textarea across payment types:

```tsx
<Tabs value={activeType} onValueChange={(value) => setActiveType(value === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME")}>
  <TabsList>
    <TabsTrigger value="ONE_TIME">One-time payment</TabsTrigger>
    <TabsTrigger value="INSTALLMENTS">Installments</TabsTrigger>
  </TabsList>
  {paymentTypes.map((paymentType) => {
    const profile = profiles[paymentType];
    const systemOptions = systemPlaceholders(paymentType).map((name) => ({ name, label: name.replaceAll("_", " ") }));
    const mainOptions = [...systemOptions, ...profile.customPlaceholders.map(({ name }) => ({ name, label: name.replaceAll("_", " ") }))];
    return <TabsContent key={paymentType} value={paymentType}>
      {profile.customPlaceholders.map((definition, index) => {
        const referenced = customIsReferenced(profile, definition.name);
        return <div key={`${paymentType}-${index}`}>
          <Input aria-label={`Placeholder name ${definition.name}`} value={definition.name} disabled={referenced} onChange={(event) => renameCustom(paymentType, index, event.target.value)} />
          <LinePlaceholderEditor id={`${paymentType}-${definition.name}`} label={`Placeholder content ${definition.name}`} value={definition.template} placeholders={systemOptions} onChange={(template) => updateCustomTemplate(paymentType, definition.name, template)} />
          <Button type="button" aria-label={`Remove ${definition.name}`} disabled={referenced} onClick={() => removeCustom(paymentType, definition.name)}>Remove</Button>
          {referenced ? <FieldDescription>Remove it from the message before renaming or deleting.</FieldDescription> : null}
        </div>;
      })}
      <Button type="button" onClick={() => addCustom(paymentType)} disabled={profile.customPlaceholders.length >= 20}>Add placeholder</Button>
      <LinePlaceholderEditor id={`${paymentType}-message`} label={paymentType === "ONE_TIME" ? "One-time payment message" : "Installment payment message"} value={profile.message} placeholders={mainOptions} onChange={(message) => updateProfile(paymentType, (current) => ({ ...current, message }))} rows={10} />
    </TabsContent>;
  })}
</Tabs>
```

Implement `updateCustomTemplate`, `renameCustom`, add, and remove as immutable `updateProfile` transforms. The name `Input` calls the rename transform only while not referenced. Keep UI-only row identity out of profile JSON.

Build action payload exactly:

```ts
function profileFormData(paymentType: LinePaymentType, profile: LineDueMessageProfile): FormData {
  const formData = new FormData();
  formData.set("payment_type", paymentType);
  formData.set("profile", JSON.stringify(profile));
  return formData;
}

function runProfileAction(action: (formData: FormData) => Promise<LineDueMessageProfileActionResult>, paymentType: LinePaymentType, success: string): void {
  const formData = profileFormData(paymentType, profiles[paymentType]);
  setOutcomeByType((current) => ({ ...current, [paymentType]: "" }));
  startTransition(async () => {
    try {
      const result = await action(formData);
      setProfiles((current) => ({ ...current, [result.paymentType]: result.profile }));
      setPreviewByType((current) => ({ ...current, [result.paymentType]: result.preview }));
      setOutcomeByType((current) => ({ ...current, [result.paymentType]: success }));
    } catch (error) {
      setOutcomeByType((current) => ({ ...current, [paymentType]: error instanceof Error ? error.message : "Could not update LINE message profile." }));
    }
  });
}
```

Under each profile editor render:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Button type="button" variant="outline" disabled={pending} onClick={() => runProfileAction(previewAction, paymentType, "")}>Preview message</Button>
  <Button type="button" disabled={pending} onClick={() => runProfileAction(saveAction, paymentType, "Profile saved.")}>Save profile</Button>
  <Button type="button" variant="ghost" disabled={pending} onClick={() => runProfileAction(resetAction, paymentType, "Documented default restored.")}>Restore default</Button>
</div>
{previewByType[paymentType] ? <pre>{previewByType[paymentType]}</pre> : null}
{outcomeByType[paymentType] ? <p aria-live="polite">{outcomeByType[paymentType]}</p> : null}
```

When save/reset returns a normalized profile, replace only `profiles[result.paymentType]`. Do not discard unsaved edits in the other tab.

- [ ] **Step 6: Wire Settings page to resolved profiles and new actions**

In the existing `Promise.all`, keep the single `listOperationalSettings()` read. Resolve:

```ts
const dueProfiles = resolveLineDueMessageProfiles(settings);
```

Pass:

```tsx
<LineDueTemplateForm
  profiles={dueProfiles}
  messagingEnabled={config.lineMessagingEnabled}
  chatPaymentsEnabled={config.lineChatPaymentsEnabled}
  previewAction={previewLineDueMessageProfileAction}
  saveAction={saveLineDueMessageProfileAction}
  resetAction={resetLineDueMessageProfileAction}
/>
```

After page/component imports are updated, delete superseded `previewLineDueTemplateAction`, `saveLineDueTemplateAction`, and `resetLineDueTemplateAction` plus their old tests. Keep credential actions unchanged.

- [ ] **Step 7: Run UI, action, Settings page, and profile tests**

Run: `npm test -- src/components/admin/line-due-template-form.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts' src/lib/line/message-profile.test.ts src/lib/sheets/settings.test.ts`

Expected: PASS.

- [ ] **Step 8: Run complete local verification**

Run: `npm run lint`

Expected: exit 0.

Run: `npm test`

Expected: all Vitest tests pass with no live vendor calls.

Run: `npm run build`

Expected: production build succeeds with no TypeScript or Next.js errors.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 9: Commit editor and integration**

```bash
git add src/components/admin/line-placeholder-editor.tsx src/components/admin/line-due-template-form.tsx src/components/admin/line-due-template-form.test.ts 'src/app/admin/(protected)/settings/page.tsx' 'src/app/admin/(protected)/settings/line-actions.ts' 'src/app/admin/(protected)/settings/line-actions.test.ts'
git commit -m "feat: add LINE placeholder message editor"
```

- [ ] **Step 10: Inspect final scope without altering unrelated work**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: up to six feature commits appear above the design/plan documentation commits. Any task whose files overlapped the dirty baseline has no commit and remains explicitly reported as verified, unstaged work. Any other remaining modified/untracked paths are pre-existing user work; do not reset or stage them.

---

## Final Verification Matrix

| Requirement | Primary proof |
| --- | --- |
| Separate one-time/installment profiles | `message-profile.test.ts`, editor tab test, sender selection test |
| Protected system tokens | profile catalog/validation tests |
| Add/remove/rename custom placeholders | editor lifecycle tests |
| Custom definitions use system tokens only | profile custom-to-custom rejection test |
| Buttons insert at caret/selection | editor insertion tests |
| Numeric and word installment wording | `installment-language.test.ts`, message-values test |
| Required amount/date/URL, including indirect use | profile reachability tests |
| Stable plan data | generation snapshot and message-values precedence tests |
| Legacy Settings compatibility | Settings fallback tests |
| Legacy pending-payment compatibility | schedule fallback tests |
| Frozen retry safety | adapted existing `due-payments.test.ts` retry tests |
| Invalid config/data sends nothing | sender error-code tests |
| Fresh workbook defaults | workbook/setup tests |
| Full repository health | lint, complete Vitest suite, production build |

# Reminder Toggles and Focused Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independently persisted installment-reminder switches, guarantee disabled slots start no LINE delivery attempts, and replace five expanded editors with a compact list and focused modal editor.

**Architecture:** Normalize stored reminder settings to a version 2 config containing `enabled` and `profiles` records, while accepting version 1 as an all-enabled compatibility input. The cron sender filters eligible slots through the enabled record before recipient, render, state, secret, audit, or LINE work. The client component keeps persisted config separate from one modal draft, uses the existing atomic save action for switches and messages, and composes official Base UI shadcn primitives.

**Tech Stack:** Next.js 15 App Router, strict TypeScript, React 19, Vitest, Testing Library, Zod, Base UI shadcn `base-nova`, Tailwind CSS v4, Sonner, Google Sheets operational settings, LINE Messaging API.

## Global Constraints

- Follow design spec `docs/superpowers/specs/2026-08-16-reminder-toggles-and-editor-design.md`.
- Keep exactly five slots: `T_MINUS_7_DAYS`, `T_MINUS_3_DAYS`, `T_MINUS_1_DAY`, `DUE_DATE`, and `T_PLUS_1_DAY`.
- No master switch, client override, arbitrary timing, backfill, or change to one-time and first-installment requests.
- Disabled means no new scheduled or retry attempt after sender observes disabled config.
- Keep template drafts separate from persisted toggle saves.
- Use `@/` imports, two-space indentation, semicolons, semantic Tailwind tokens, `gap-*` spacing, and Lucide icons.
- Use official shadcn components before custom controls. Project base is Base UI, so composed triggers use `render`, not `asChild`.
- Unit tests must not call Google Sheets, LINE, or other live services.
- Do not include message text, URLs, QR data, or client data in audit metadata.

## File Structure

- Modify `src/lib/line/message-profile.ts`: own version 1 compatibility parsing, normalized version 2 type, strict enabled/profile slot validation, and all-enabled defaults.
- Modify `src/lib/line/message-profile.test.ts`: prove version normalization and strict enabled validation.
- Modify `src/lib/sheets/settings.ts`: resolve legacy and absent reminder settings to version 2 without writing.
- Modify `src/lib/sheets/settings.test.ts`: prove stored version 1 and legacy due-profile compatibility.
- Modify `src/app/admin/(protected)/settings/line-actions.test.ts`: prove atomic saves preserve enabled flags and audits remain content-free.
- Modify `src/lib/line/installment-reminders.ts`: filter disabled scheduled and retry slots before delivery work and load LINE secret lazily.
- Create `src/lib/line/installment-reminders.test.ts`: isolate cron sender behavior with mocked boundaries.
- Modify `src/components/admin/line-installment-reminder-form.tsx`: own compact rows, persisted config, modal draft, request lock, atomic actions, and user feedback.
- Modify `src/components/admin/line-installment-reminder-form.test.tsx`: cover list, switches, dialog, draft, preview, save, rollback, and reset behavior.
- Create `src/components/ui/switch.tsx`: official shadcn Base UI switch source.
- Create `src/components/ui/scroll-area.tsx`: official shadcn Base UI scroll-area source.

---

### Task 1: Versioned Reminder Enablement Configuration

**Files:**
- Modify: `src/lib/line/message-profile.ts:13-25,91-118,217-242`
- Modify: `src/lib/line/message-profile.test.ts:1-44`
- Modify: `src/lib/sheets/settings.ts:106-134`
- Modify: `src/lib/sheets/settings.test.ts:1-74`
- Modify: `src/app/admin/(protected)/settings/line-actions.test.ts:92-149`

**Interfaces:**
- Produces: `LineInstallmentReminderConfig = { version: 2; enabled: Record<ReminderSlot, boolean>; profiles: Record<ReminderSlot, LineDueMessageProfile> }`.
- Produces: `parseLineInstallmentReminderConfig(value: unknown): LineInstallmentReminderConfig`, accepting stored version 1 or 2 and always returning version 2.
- Produces: `DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG` with all five enabled flags set to `true`.
- Consumed by: settings resolution, admin save/reset actions, sender filtering, and reminder UI.

- [ ] **Step 1: Write failing parser and default tests**

Replace the current reminder-config test in `message-profile.test.ts` with explicit normalization and rejection cases:

```ts
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
```

- [ ] **Step 2: Write failing settings compatibility tests**

Add assertions in `settings.test.ts` that both fallback paths expose all-enabled version 2 state:

```ts
it("normalizes stored version one reminder settings without writing", () => {
  const legacy = {
    version: 1,
    profiles: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles,
  };
  const resolved = resolveLineInstallmentReminderConfig([
    { rowNumber: 2, key: "line_installment_reminder_config", value: JSON.stringify(legacy) },
  ]);

  expect(resolved).toEqual({ kind: "VALID", config: DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG });
  expect(mocks.batchUpdate).not.toHaveBeenCalled();
});

expect(resolved).toMatchObject({
  kind: "VALID",
  config: {
    version: 2,
    enabled: {
      T_MINUS_7_DAYS: true,
      T_MINUS_3_DAYS: true,
      T_MINUS_1_DAY: true,
      DUE_DATE: true,
      T_PLUS_1_DAY: true,
    },
  },
});
```

In `line-actions.test.ts`, set `config.enabled.T_MINUS_3_DAYS = false` in the atomic-save test and assert the exact config reaches `saveLineInstallmentReminderConfig` while audit metadata remains only `{"settingKey":"line_installment_reminder_config"}`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test -- src/lib/line/message-profile.test.ts src/lib/sheets/settings.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts'
```

Expected: FAIL because the current config is version 1 and has no `enabled` record.

- [ ] **Step 4: Implement strict version 1-to-2 normalization**

Change the exported config type and default in `message-profile.ts`:

```ts
export type LineInstallmentReminderConfig = {
  version: 2;
  enabled: Record<ReminderSlot, boolean>;
  profiles: Record<ReminderSlot, LineDueMessageProfile>;
};

const ALL_REMINDERS_ENABLED = Object.fromEntries(
  REMINDER_SLOTS.map((slot) => [slot, true]),
) as Record<ReminderSlot, boolean>;

export const DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG: LineInstallmentReminderConfig = {
  version: 2,
  enabled: ALL_REMINDERS_ENABLED,
  profiles: {
    T_MINUS_7_DAYS: defaultReminderProfile("Your installment payment is due in 7 days."),
    T_MINUS_3_DAYS: defaultReminderProfile("Your installment payment is due in 3 days."),
    T_MINUS_1_DAY: defaultReminderProfile("Your installment payment is due tomorrow."),
    DUE_DATE: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS,
    T_PLUS_1_DAY: defaultReminderProfile("Your installment payment was due yesterday."),
  },
};
```

Use a strict union for stored shapes and exact slot-record parsers:

```ts
const reminderConfigSchema = z.union([
  z.object({
    version: z.literal(1),
    profiles: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({
    version: z.literal(2),
    enabled: z.record(z.string(), z.unknown()),
    profiles: z.record(z.string(), z.unknown()),
  }).strict(),
]);

function parseReminderEnabled(value: Record<string, unknown>): Record<ReminderSlot, boolean> {
  for (const slot of REMINDER_SLOTS) {
    if (typeof value[slot] !== "boolean") {
      throw new LineDueTemplateError("TEMPLATE_INVALID", `LINE reminder configuration requires boolean enabled flag: ${slot}`);
    }
  }
  const unexpected = Object.keys(value).find((slot) => !REMINDER_SLOTS.includes(slot as ReminderSlot));
  if (unexpected) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", `Unsupported LINE reminder enabled slot: ${unexpected}`);
  }
  return Object.fromEntries(REMINDER_SLOTS.map((slot) => [slot, value[slot]])) as Record<ReminderSlot, boolean>;
}

function parseReminderProfiles(value: Record<string, unknown>): Record<ReminderSlot, LineDueMessageProfile> {
  for (const slot of REMINDER_SLOTS) {
    if (!(slot in value)) {
      throw new LineDueTemplateError("TEMPLATE_INVALID", `LINE reminder configuration requires profile: ${slot}`);
    }
  }
  const unexpected = Object.keys(value).find((slot) => !REMINDER_SLOTS.includes(slot as ReminderSlot));
  if (unexpected) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", `Unsupported LINE reminder slot: ${unexpected}`);
  }
  return Object.fromEntries(REMINDER_SLOTS.map((slot) => [
    slot,
    parseLineDueMessageProfile(value[slot], "INSTALLMENTS"),
  ])) as Record<ReminderSlot, LineDueMessageProfile>;
}
```

Version 1 supplies a cloned `ALL_REMINDERS_ENABLED`; version 2 calls `parseReminderEnabled`. Always call `parseReminderProfiles` and return `{ version: 2, enabled, profiles }`.

Update `resolveLineInstallmentReminderConfig` fallback to spread the version 2 default and replace only `profiles.DUE_DATE`:

```ts
config: {
  ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
  enabled: { ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.enabled },
  profiles: {
    ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles,
    DUE_DATE: installmentProfile.profile,
  },
},
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: all selected tests PASS with no warnings.

- [ ] **Step 6: Commit configuration migration**

```bash
git add src/lib/line/message-profile.ts src/lib/line/message-profile.test.ts src/lib/sheets/settings.ts src/lib/sheets/settings.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts'
git commit -m "feat: version reminder enablement config"
```

---

### Task 2: Hard Delivery Guard for Disabled Slots

**Files:**
- Create: `src/lib/line/installment-reminders.test.ts`
- Modify: `src/lib/line/installment-reminders.ts:18-50`

**Interfaces:**
- Consumes: normalized `LineInstallmentReminderConfig.enabled` from Task 1.
- Preserves: `sendInstallmentReminderRequests({ baseUrl, today? }): Promise<string[]>`.
- Guarantees: disabled eligible and retryable slots do not resolve recipients, render values, mutate payment state, load LINE credentials, append audits, or call LINE.

- [ ] **Step 1: Write failing disabled scheduled-slot test**

Create these module-boundary mocks in `installment-reminders.test.ts`:

```ts
const mocks = vi.hoisted(() => ({
  runtimeConfig: vi.fn(),
  getLineChannelAccessToken: vi.fn(),
  appendAudit: vi.fn(),
  updatePayment: vi.fn(),
  readPaymentClientSnapshot: vi.fn(),
  getLineInstallmentReminderConfig: vi.fn(),
  renderLineDueMessageProfile: vi.fn(),
  resolveLineDueMessageValues: vi.fn(),
  isLinkedLinePaymentRecipient: vi.fn(),
  sendLinePushMessage: vi.fn(),
}));

vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/secrets/service", () => ({ getLineChannelAccessToken: mocks.getLineChannelAccessToken }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit, updatePayment: mocks.updatePayment }));
vi.mock("@/lib/sheets/payment-client-snapshot", () => ({ readPaymentClientSnapshot: mocks.readPaymentClientSnapshot }));
vi.mock("@/lib/sheets/settings", () => ({ getLineInstallmentReminderConfig: mocks.getLineInstallmentReminderConfig }));
vi.mock("./message-profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./message-profile")>();
  return { ...actual, renderLineDueMessageProfile: mocks.renderLineDueMessageProfile };
});
vi.mock("./message-values", () => ({ resolveLineDueMessageValues: mocks.resolveLineDueMessageValues }));
vi.mock("./recipient", () => ({ isLinkedLinePaymentRecipient: mocks.isLinkedLinePaymentRecipient }));
vi.mock("./client", () => ({ sendLinePushMessage: mocks.sendLinePushMessage }));
```

Use this payment fixture:

```ts
function payment(deliveryLog = "") {
  return {
    payment_id: "pay_1",
    client_id: "client_1",
    status: "PENDING",
    payment_type: "INSTALLMENTS",
    installment_number: "2",
    due_date: "2026-08-23",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    public_token: "token_1",
    line_reminder_delivery_log: deliveryLog,
  };
}
```

Return one linked client and no schedules from the snapshot. Clone default config, set `enabled.T_MINUS_7_DAYS = false`, run on `2026-08-16`, then assert:

```ts
await expect(sendInstallmentReminderRequests({
  baseUrl: "https://pay.example",
  today: "2026-08-16",
})).resolves.toEqual([]);

expect(mocks.getLineChannelAccessToken).not.toHaveBeenCalled();
expect(mocks.isLinkedLinePaymentRecipient).not.toHaveBeenCalled();
expect(mocks.resolveLineDueMessageValues).not.toHaveBeenCalled();
expect(mocks.renderLineDueMessageProfile).not.toHaveBeenCalled();
expect(mocks.updatePayment).not.toHaveBeenCalled();
expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
expect(mocks.appendAudit).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add failing retry-pause and re-enable tests**

Use this retry log:

```ts
const retryLog = JSON.stringify({
  version: 1,
  deliveries: {
    T_MINUS_7_DAYS: {
      status: "FAILED_RETRYABLE",
      renderedMessage: "Frozen reminder",
      retryKey: "retry-key-1",
      errorCode: "HTTP_500",
    },
  },
});
```

First return config with `T_MINUS_7_DAYS` disabled and assert zero work. Then return the same config with that flag enabled, make LINE return `{ accepted: true, retryable: false, requestId: "request_1", errorCode: "" }`, rerun, and assert the frozen message and retry key are used. Add a separate disabled-on-date then enabled-next-day test and assert the missed scheduled slot is not backfilled.

- [ ] **Step 3: Run sender test and verify RED**

Run:

```bash
npm test -- src/lib/line/installment-reminders.test.ts
```

Expected: FAIL because current sender ignores per-slot enabled flags and loads LINE credentials before checking work.

- [ ] **Step 4: Filter disabled slots and lazy-load credentials**

In `installment-reminders.ts`, remove eager token loading, keep one optional promise for the first actual send, and filter eligible slots before entering delivery work:

```ts
const clients = new Map(snapshot.clients.map((client) => [client.client_id, client]));
let tokenPromise: Promise<string> | undefined;
const accepted: string[] = [];

for (const payment of snapshot.payments) {
  if (payment.status !== "PENDING" || payment.payment_type !== "INSTALLMENTS" || Number(payment.installment_number) <= 1) continue;
  let log;
  try {
    log = parseReminderDeliveryLog(payment.line_reminder_delivery_log);
  } catch {
    continue;
  }
  const enabledSlots = eligibleReminderSlots({
    dueDate: payment.due_date,
    createdAt: payment.created_at,
    today,
    log,
  }).filter((slot) => resolved.config.enabled[slot]);

  for (const slot of enabledSlots) {
    const recipient = clients.get(payment.client_id);
    if (!isLinkedLinePaymentRecipient(recipient)) {
      log = updateReminderDelivery(log, slot, {
        status: "SKIPPED_MISSING_USER_ID",
        errorCode: "MISSING_USER_ID",
      });
      continue;
    }
    tokenPromise ??= getLineChannelAccessToken();
    const token = await tokenPromise;
```

Keep existing render, freeze, send, result persistence, audit, and accepted-ID logic after this guard. Do not create delivery-log entries for disabled slots.

- [ ] **Step 5: Run sender and scheduling tests and verify GREEN**

Run:

```bash
npm test -- src/lib/line/installment-reminders.test.ts src/lib/line/reminder-delivery.test.ts
```

Expected: all tests PASS; disabled scheduled and retry slots show zero downstream calls.

- [ ] **Step 6: Commit sender guard**

```bash
git add src/lib/line/installment-reminders.ts src/lib/line/installment-reminders.test.ts
git commit -m "feat: block disabled reminder deliveries"
```

---

### Task 3: Compact Reminder List and Focused Modal Editor

**Files:**
- Create: `src/components/ui/switch.tsx`
- Create: `src/components/ui/scroll-area.tsx`
- Modify: `src/components/admin/line-installment-reminder-form.tsx:1-285`
- Modify: `src/components/admin/line-installment-reminder-form.test.tsx:1-187`

**Interfaces:**
- Consumes: existing `previewAction`, `saveAction`, and `resetAction` prop signatures.
- Consumes: version 2 `LineInstallmentReminderConfig` from Task 1.
- Produces: five compact rows whose name opens the editor and whose switch saves only persisted config.
- Preserves: profile-local custom placeholders, safe preview, atomic full-config save, pending-request lock, and default reset.

- [ ] **Step 1: Rewrite component tests for the approved information hierarchy**

Keep the existing `renderReminderForm` helper and action mocks, then replace expanded-editor assertions with:

```ts
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks }));

const reminderNames = [
  "7 days before due date",
  "3 days before due date",
  "1 day before due date",
  "On due date",
  "1 day after due date",
];

it("shows five compact reminder-name triggers and independent switches", () => {
  renderReminderForm();

  for (const name of reminderNames) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("switch", { name: `Send ${name} reminder` })).toBeTruthy();
  }
  expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  expect(screen.queryByText(/enabled|paused/i)).toBeNull();
  expect(screen.queryByLabelText("T−7 days message")).toBeNull();
});

it("opens the selected reminder editor from its name", () => {
  renderReminderForm();
  fireEvent.click(screen.getByRole("button", { name: "3 days before due date" }));

  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Edit 3 days before due date" })).toBeTruthy();
  expect(screen.getByLabelText("3 days before due date message")).toBeTruthy();
});
```

- [ ] **Step 2: Add failing switch persistence and rollback tests**

Test a successful `T_MINUS_3_DAYS` switch click. Assert `saveAction` receives version 2 config with only `enabled.T_MINUS_3_DAYS` false, no dialog opens, and the switch remains off after resolution. For rejection, use `saveAction: vi.fn().mockRejectedValue(new Error("Workbook unavailable"))`; assert the switch returns to on and the error is announced through the mocked `toast.error`.

- [ ] **Step 3: Add failing modal draft, preview, save, and cancel tests**

Cover these independent behaviors:

```ts
it("discards a cancelled message draft", async () => {
  renderReminderForm();
  fireEvent.click(screen.getByRole("button", { name: "7 days before due date" }));
  fireEvent.change(screen.getByLabelText("7 days before due date message"), {
    target: { value: "Unsaved draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "7 days before due date" }));

  expect((screen.getByLabelText("7 days before due date message") as HTMLTextAreaElement).value)
    .toBe(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.T_MINUS_7_DAYS.message);
});
```

Also assert placeholder insertion buttons appear before the main textarea in DOM order, Preview submits only `{ slot, profile }`, Save message submits the full persisted config with only the active profile changed, successful save closes the dialog, and rejected save keeps both dialog and draft open with an inline error. Adapt the existing custom-placeholder test to open **7 days before due date**, add `payment_label`, edit its template, insert it into the message, and confirm no other slot changes.

Add a pending-request test that holds a deferred toggle or save promise and proves every switch, reminder-name trigger, Preview, Save message, Cancel, and Restore defaults action is disabled until it resolves. Add a reset test starting from one disabled switch and one edited message; assert `resetAction` returns documented defaults, all five switches become on, the editor closes, and `toast.success("Reminder defaults restored.")` fires.

- [ ] **Step 4: Run component test and verify RED**

Run:

```bash
npm test -- src/components/admin/line-installment-reminder-form.test.tsx
```

Expected: FAIL because current UI expands all five editors and has no switches or dialog.

- [ ] **Step 5: Add official shadcn switch and scroll-area sources**

Run:

```bash
npx shadcn@latest add switch scroll-area
```

Read both generated files. Confirm they use `@base-ui/react`, `@/lib/utils`, semantic tokens, and existing Lucide configuration. Do not overwrite or modify existing UI primitives.

- [ ] **Step 6: Refactor component around persisted state and one modal draft**

In `line-installment-reminder-form.tsx`, use these labels and state boundaries:

```ts
const labels: Record<ReminderSlot, string> = {
  T_MINUS_7_DAYS: "7 days before due date",
  T_MINUS_3_DAYS: "3 days before due date",
  T_MINUS_1_DAY: "1 day before due date",
  DUE_DATE: "On due date",
  T_PLUS_1_DAY: "1 day after due date",
};

const [config, setConfig] = useState<LineInstallmentReminderConfig | null>(() =>
  resolved.kind === "VALID" ? structuredClone(resolved.config) : null,
);
const [activeSlot, setActiveSlot] = useState<ReminderSlot | null>(null);
const [draftProfile, setDraftProfile] = useState<LineDueMessageProfile | null>(null);
const [previewText, setPreviewText] = useState("");
const [editorError, setEditorError] = useState("");
```

Opening clones `config.profiles[slot]`; closing clears slot, draft, preview, and error. Custom-placeholder helpers mutate `draftProfile`, never `config`.

Render rows with `Field orientation="horizontal"`, a ghost `Button` for the reminder name, an accessible `Switch`, and `Separator` between rows. Use no badge, excerpt, or Edit button.

Render one controlled `Dialog` with `DialogTitle`, `DialogDescription`, `ScrollArea`, existing `LinePlaceholderEditor`, inline `FieldError`, and `DialogFooter`. Use responsive max-height and max-width layout classes only; do not add raw colors, manual overlay z-index, or `space-y-*`.

- [ ] **Step 7: Implement atomic request behavior**

Keep one `requestInFlight` ref and pending state across toggle, preview, message save, and reset.

For toggle, capture previous config, optimistically set next config, call `saveAction` with full JSON, then accept returned config or restore previous state on failure. For message save, construct full config from persisted `config` plus the selected `draftProfile`; do not include any other draft. For preview, send only selected profile. For reset, accept returned defaults, close editor, and show Sonner success.

Use exact feedback:

```ts
toast.success("Reminder updated.");
toast.success("Reminder message saved.");
toast.success("Reminder defaults restored.");
toast.error(actionError(error, "Could not update reminder."));
```

Keep preview/save validation errors inside the open dialog through `editorError` rather than a toast.

- [ ] **Step 8: Run component and page tests and verify GREEN**

Run:

```bash
npm test -- src/components/admin/line-installment-reminder-form.test.tsx 'src/app/admin/(protected)/settings/messages/page.test.tsx' 'src/app/admin/(protected)/settings/line-actions.test.ts'
```

Expected: all selected tests PASS with no accessibility warnings or unhandled promise rejections.

- [ ] **Step 9: Review generated and composed UI against shadcn rules**

Confirm:

- every boolean setting uses `Switch`;
- every `Dialog` has title and description;
- forms use `Field`/`FieldGroup`;
- separators use `Separator`;
- feedback uses Sonner or inline `FieldError`;
- buttons use built-in variants and icon `data-icon` attributes;
- conditional classes use `cn()`;
- layout uses `gap-*`, not `space-x-*` or `space-y-*`;
- no custom palette, raw overlay, or manual z-index was added.

- [ ] **Step 10: Commit compact reminder UI**

```bash
git add src/components/ui/switch.tsx src/components/ui/scroll-area.tsx src/components/admin/line-installment-reminder-form.tsx src/components/admin/line-installment-reminder-form.test.tsx
git commit -m "feat: add reminder toggles and focused editor"
```

---

### Task 4: Full Regression Verification

**Files:**
- Verify: all files changed in Tasks 1-3
- Verify: `docs/superpowers/specs/2026-08-16-reminder-toggles-and-editor-design.md`

**Interfaces:**
- Confirms all design requirements and repository quality gates.
- Produces no source changes unless verification finds a defect; any defect returns to the owning task's RED-GREEN cycle.

- [ ] **Step 1: Run all reminder-focused tests**

```bash
npm test -- src/lib/line/message-profile.test.ts src/lib/sheets/settings.test.ts src/lib/line/reminder-delivery.test.ts src/lib/line/installment-reminders.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts' src/components/admin/line-installment-reminder-form.test.tsx 'src/app/admin/(protected)/settings/messages/page.test.tsx'
```

Expected: every selected test PASS.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: exit 0 with no ESLint errors.

- [ ] **Step 3: Run full Vitest suite**

```bash
npm test
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: exit 0 with successful Next.js compile, type checking, and route generation.

- [ ] **Step 5: Inspect final diff and requirements**

```bash
git status --short
git diff HEAD~3 --check
git diff HEAD~3 --stat
```

Read the final diff and verify each spec item: five separate switches; no badge, excerpt, or Edit button; name-triggered dialog; placeholders above textarea; preview/save/cancel; version 1 compatibility; disabled scheduled and retry guard; no backfill; all-enabled restore defaults; safe audit metadata.

- [ ] **Step 6: Record final evidence**

Report focused-test count, full-test count, lint exit, build exit, commit hashes, and any unrelated pre-existing worktree changes. Do not claim completion without fresh command output from Steps 1-5.

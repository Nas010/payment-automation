# Installment Payment Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send globally configured text-and-QR payment reminders for unpaid later installments at T−7, T−3, T−1, deadline, and T+1, while creating and sending initial/one-time requests immediately.

**Architecture:** Reuse the existing LINE profile renderer and sender. A single Settings JSON value owns the five installment reminder profiles; a new JSON column on each Payment stores independent per-slot delivery state and frozen retry payloads. Generation makes later-installment Payment rows available on T−7 (or immediately when scheduled later), while schedule-creation actions immediately generate and send first/one-time payment requests.

**Tech Stack:** Next.js server actions/routes, strict TypeScript, Vitest, Google Sheets settings and records, LINE Messaging API.

## Global Constraints

- Reminder slots are exactly `T_MINUS_7_DAYS`, `T_MINUS_3_DAYS`, `T_MINUS_1_DAY`, `DUE_DATE`, and `T_PLUS_1_DAY`; no toggles, arbitrary offsets, or client overrides.
- Reminders apply only to `INSTALLMENTS` Payments where `installment_number > 1`; all five include rendered text and exact-payment PromptPay QR.
- One-time and initial-installment requests generate and send immediately, never enter reminder scheduling.
- Late-created later installments create their link immediately but never backfill messages; they start at the next future slot only.
- Each installment creates one canonical Payment row, URL/public token, and QR at T−7 or late creation. Every reminder for that Payment reuses the same URL and QR; reminder delivery never regenerates a link.
- Rendered reminder text and LINE retry key are frozen before an attempt; audit metadata never contains template text, URLs, QR data, or private client data.
- Preserve legacy Payment rows, due-message state, and workbook column order. Never re-send an accepted legacy due-date message.
- Use Bangkok date keys for every calendar comparison. Keep tests offline; mock Sheets and LINE boundaries.

---

### Task 1: Define reminder slots, defaults, and Settings resolution

**Files:**
- Modify: `src/lib/line/message-profile.ts`
- Modify: `src/lib/line/message-profile.test.ts`
- Modify: `src/lib/sheets/settings.ts`
- Modify: `src/lib/sheets/settings.test.ts`

**Interfaces:**
- Produces `REMINDER_SLOTS`, `ReminderSlot`, `LineInstallmentReminderConfig`, `DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG`, `parseLineInstallmentReminderConfig`, and `resolveLineInstallmentReminderConfig`.
- Produces `getLineInstallmentReminderConfig(): Promise<ResolvedLineInstallmentReminderConfig>` and `saveLineInstallmentReminderConfig(config)` for Settings and the sender.

- [ ] **Step 1: Write failing profile-domain tests**

```ts
it("requires a valid installment profile for each fixed reminder slot", () => {
  expect(() => parseLineInstallmentReminderConfig({ version: 1, profiles: {} })).toThrow(/T_MINUS_7_DAYS/);
});

it("rejects a one-time-only reminder config and accepts five installment profiles", () => {
  expect(parseLineInstallmentReminderConfig(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG)).toEqual(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
});
```

- [ ] **Step 2: Run profile tests and verify RED**

Run: `npm test -- src/lib/line/message-profile.test.ts`

Expected: FAIL because reminder configuration exports and parser do not exist.

- [ ] **Step 3: Implement config types, five defaults, and parser**

Add a `line_installment_reminder_config` key constant. Validate `version: 1`, exactly the five slot keys, and each nested profile with `validateLineDueMessageProfile(profile, "INSTALLMENTS")`. Define defaults that mention the appropriate timing but each reference `amount`, `due_date`, and `payment_url`.

```ts
export const REMINDER_SLOTS = ["T_MINUS_7_DAYS", "T_MINUS_3_DAYS", "T_MINUS_1_DAY", "DUE_DATE", "T_PLUS_1_DAY"] as const;
export type ReminderSlot = (typeof REMINDER_SLOTS)[number];
export type LineInstallmentReminderConfig = { version: 1; profiles: Record<ReminderSlot, LineDueMessageProfile> };
```

- [ ] **Step 4: Run profile tests and verify GREEN**

Run: `npm test -- src/lib/line/message-profile.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing Settings compatibility tests**

```ts
it("uses existing installment profile as deadline fallback before reminder config is saved", () => {
  const resolved = resolveLineInstallmentReminderConfig([{ key: "line_due_message_profile_installments", value: JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS), rowNumber: 2 }]);
  expect(resolved.kind).toBe("VALID");
  if (resolved.kind === "VALID") expect(resolved.config.profiles.DUE_DATE).toEqual(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
});
```

- [ ] **Step 6: Implement Settings read/write helpers**

Resolve an absent reminder key without mutating Sheets: use the valid legacy installment profile for `DUE_DATE` and documented defaults for remaining slots. Return `{ kind: "INVALID" }` for corrupt stored reminder JSON. Validate config before `upsertOperationalSetting` writes the single JSON value.

- [ ] **Step 7: Run Settings tests and commit**

Run: `npm test -- src/lib/line/message-profile.test.ts src/lib/sheets/settings.test.ts`

Commit:

```bash
git add src/lib/line/message-profile.ts src/lib/line/message-profile.test.ts src/lib/sheets/settings.ts src/lib/sheets/settings.test.ts
git commit -m "feat: add installment reminder configuration"
```

### Task 2: Add pure reminder scheduling and delivery-log domain

**Files:**
- Create: `src/lib/line/reminder-delivery.ts`
- Create: `src/lib/line/reminder-delivery.test.ts`

**Interfaces:**
- Consumes `ReminderSlot` from `message-profile.ts` and Payment date/state fields.
- Produces `parseReminderDeliveryLog(value)`, `serializeReminderDeliveryLog(log)`, `reminderDate(dueDate, slot)`, `eligibleReminderSlots(input)`, and `updateReminderDelivery(log, slot, value)`.

- [ ] **Step 1: Write failing date and eligibility tests**

```ts
it("selects T_MINUS_1_DAY for a payment created two days before its deadline", () => {
  expect(eligibleReminderSlots({ dueDate: "2026-08-20", createdAt: "2026-08-18T08:00:00.000Z", today: "2026-08-19", log: emptyReminderDeliveryLog() })).toEqual(["T_MINUS_1_DAY"]);
});

it("does not backfill slots before payment creation", () => {
  expect(eligibleReminderSlots({ dueDate: "2026-08-20", createdAt: "2026-08-18T08:00:00.000Z", today: "2026-08-18", log: emptyReminderDeliveryLog() })).toEqual([]);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm test -- src/lib/line/reminder-delivery.test.ts`

Expected: FAIL because the reminder-delivery module does not exist.

- [ ] **Step 3: Implement minimal pure domain**

Use UTC date-only arithmetic for canonical `YYYY-MM-DD` values, with callers providing the Bangkok date key. A slot is calendar-eligible only when `today === reminderDate(dueDate, slot)` and `createdAt.slice(0, 10) <= today`. A frozen `SENDING` or `FAILED_RETRYABLE` slot remains eligible for retry after its calendar date; accepted, failed-final, skipped, and review slots do not.

```ts
export type ReminderDeliveryStatus = "PENDING" | "SENDING" | "ACCEPTED" | "FAILED_RETRYABLE" | "FAILED" | "SKIPPED_MISSING_USER_ID" | "REVIEW";
export type ReminderDelivery = { status: ReminderDeliveryStatus; renderedMessage?: string; retryKey?: string; firstAttemptedAt?: string; acceptedAt?: string; requestId?: string; errorCode?: string };
export type ReminderDeliveryLog = { version: 1; deliveries: Partial<Record<ReminderSlot, ReminderDelivery>> };
```

- [ ] **Step 4: Add retry, accepted, malformed-log, and T+1 tests**

Assert that corrupt stored JSON is reported as invalid, a retryable T-7 entry remains selected on T-6 with its frozen text/key, `ACCEPTED` is never selected again, and T+1 resolves to the calendar day after the deadline.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/lib/line/reminder-delivery.test.ts`

Commit:

```bash
git add src/lib/line/reminder-delivery.ts src/lib/line/reminder-delivery.test.ts
git commit -m "feat: add reminder delivery state domain"
```

### Task 3: Persist reminder state without breaking legacy Payments

**Files:**
- Modify: `src/lib/sheets/records.ts`
- Modify: `src/lib/sheets/records.test.ts`
- Modify: `src/lib/sheets/payments.ts`
- Modify: `src/lib/sheets/payments.test.ts`
- Modify: `src/lib/sheets/migration.test.ts`
- Modify: `src/lib/sheets/payment-client-snapshot.ts`
- Modify: `src/lib/sheets/payment-client-snapshot.test.ts`
- Modify: `src/lib/payments/generate.ts`
- Modify: `src/lib/payments/generate.test.ts`

**Interfaces:**
- Appends `line_reminder_delivery_log` as the final `PAYMENT_HEADERS` column.
- Ensures every new `NewPaymentRecord` starts with `line_reminder_delivery_log: ""`.

- [ ] **Step 1: Write failing record and generation tests**

```ts
it("appends reminder log after existing payment columns", () => {
  expect(PAYMENT_HEADERS.at(-1)).toBe("line_reminder_delivery_log");
});

it("creates new payments with an empty reminder delivery log", () => {
  expect(buildPaymentForSchedule(schedule, input).line_reminder_delivery_log).toBe("");
});
```

- [ ] **Step 2: Run affected tests and verify RED**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/payments/generate.test.ts`

Expected: FAIL because the header and field do not exist.

- [ ] **Step 3: Append the field and update all read/write ranges**

Append only—do not insert—the header. Replace hard-coded Payment end columns in Sheets reads/appends with `sheetColumnName(PAYMENT_HEADERS.length)` or the corresponding dynamic range. Keep schema migration append-only, so legacy workbook values and all pre-existing indices remain unchanged.

- [ ] **Step 4: Add migration/snapshot compatibility tests**

Test that a short legacy row receives `""` for `line_reminder_delivery_log`, schema migration fills only the blank trailing header, and the batched payment/client snapshot includes the new trailing column.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/sheets/payments.test.ts src/lib/sheets/migration.test.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/payments/generate.test.ts`

Commit:

```bash
git add src/lib/sheets/records.ts src/lib/sheets/records.test.ts src/lib/sheets/payments.ts src/lib/sheets/payments.test.ts src/lib/sheets/migration.test.ts src/lib/sheets/payment-client-snapshot.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/payments/generate.ts src/lib/payments/generate.test.ts
git commit -m "feat: persist payment reminder delivery logs"
```

### Task 4: Generate links at the right time and immediately create first payments

**Files:**
- Modify: `src/lib/plans/schedule.ts`
- Modify: `src/lib/plans/schedule.test.ts`
- Modify: `src/lib/payments/generate.ts`
- Modify: `src/lib/payments/generate.test.ts`
- Modify: `src/app/admin/(protected)/actions.ts`
- Modify: `src/app/admin/(protected)/actions.test.ts`

**Interfaces:**
- Produces `selectPaymentGenerationSchedules(schedules, today)` for cron: existing due rows plus later installments whose T-7 date has arrived.
- Extends `generateDuePaymentLinks` with `scheduleIds?: string[]` to force immediate generation for newly created initial/one-time schedules only.

- [ ] **Step 1: Write failing schedule-selection tests**

```ts
it("makes a second installment due on 2026-08-20 available on 2026-08-13", () => {
  expect(selectPaymentGenerationSchedules([laterInstallment], "2026-08-13")).toEqual([laterInstallment]);
});

it("does not select that later installment before T-7", () => {
  expect(selectPaymentGenerationSchedules([laterInstallment], "2026-08-12")).toEqual([]);
});
```

- [ ] **Step 2: Run schedule tests and verify RED**

Run: `npm test -- src/lib/plans/schedule.test.ts src/lib/payments/generate.test.ts`

Expected: FAIL because T-7 selection and forced generation are absent.

- [ ] **Step 3: Implement generation selection and force guard**

Generate unscheduled-without-payment rows when due today/past due, or when they are later installments and their T-7 date is today/past. Once generated, its existing `payment_id`, `payment_url`, and public token are the only link identity used by all later reminders. For `scheduleIds`, reject any target that is neither `ONE_TIME` nor installment number `1`; this prevents an admin/manual path from pre-sending later reminder payments outside the defined sequence.

- [ ] **Step 4: Write failing admin-action tests**

```ts
it("creates the first installment payment immediately after writing its schedule", async () => {
  await createClientAction(formDataForInstallments());
  expect(mocks.generateDuePaymentLinks).toHaveBeenCalledWith(expect.objectContaining({ scheduleIds: [firstScheduleId] }));
});
```

- [ ] **Step 5: Implement immediate creation in all schedule writers**

After `createClientAction`, `assignPackageAction`, and `createManualPaymentAction` finish their schedule writes, call forced generation for the first/one-time schedule. Call the LINE sender with exactly the generated payment IDs and its explicit immediate-delivery mode. Do not delay redirects or mutate unrelated schedules if no Payment was created.

- [ ] **Step 6: Run targeted tests and commit**

Run: `npm test -- src/lib/plans/schedule.test.ts src/lib/payments/generate.test.ts src/app/admin/(protected)/actions.test.ts`

Commit:

```bash
git add src/lib/plans/schedule.ts src/lib/plans/schedule.test.ts src/lib/payments/generate.ts src/lib/payments/generate.test.ts src/app/admin/(protected)/actions.ts src/app/admin/(protected)/actions.test.ts
git commit -m "feat: generate installment payment links before deadline"
```

### Task 5: Deliver immediate requests and per-slot reminders safely

**Files:**
- Modify: `src/lib/line/due-payments.ts`
- Modify: `src/lib/line/due-payments.test.ts`
- Modify: `src/app/api/cron/generate/route.ts`
- Modify: `src/app/api/cron/generate/route.test.ts`

**Interfaces:**
- Extends `SendDueLinePaymentRequestsOptions` with `deliveryMode?: "SCHEDULED" | "IMMEDIATE"`.
- Uses `getLineInstallmentReminderConfig` for later-installment reminder slots and existing `getLineDueMessageProfiles` for immediate/legacy due requests.

- [ ] **Step 1: Write failing delivery tests**

```ts
it("sends only T_MINUS_3_DAYS profile and QR for an unpaid later installment", async () => {
  await sendDueLinePaymentRequests({ baseUrl, today: "2026-08-17" }, dependenciesWithLaterInstallmentDue("2026-08-20"));
  expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ messages: [expect.objectContaining({ type: "text", text: expect.stringContaining("3 days") }), expect.objectContaining({ type: "image" })] }));
});

it("does not send a remaining slot after a payment becomes non-pending", async () => {
  await sendDueLinePaymentRequests({ baseUrl, today: "2026-08-19" }, dependenciesWithPaymentStatus("MANUAL_CONFIRMED"));
  expect(sendPush).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run sender tests and verify RED**

Run: `npm test -- src/lib/line/due-payments.test.ts`

Expected: FAIL because slot selection and reminder-log updates are absent.

- [ ] **Step 3: Extract common LINE attempt behavior and add reminder persistence**

Keep existing recipient validation, QR URL construction, three immediate transport attempts, token retrieval, terms-image composition, and audit reconciliation. Parameterize state persistence so immediate delivery continues using `line_message_*`, while a reminder delivery reads/writes only its `line_reminder_delivery_log[slot]`. Freeze template text and retry key before the first attempt. Record slot-aware audit metadata with only `{ paymentId, slot, status, requestCode }`.

- [ ] **Step 4: Implement scheduled selection and legacy compatibility**

For later installments, load the reminder config once, parse the payment log, and process only slots returned by `eligibleReminderSlots`. Build every reminder's QR URL from that Payment row's existing `public_token` and render its existing `payment_url`; never call payment generation from delivery. A legacy Payment with `line_message_status === "ACCEPTED"` on its due date must be treated as an already accepted `DUE_DATE` delivery. For immediate mode, allow only one-time/initial payments before due date and retain the current profile selection. A corrupt reminder config or log must send nothing and produce a retryable safe error state.

- [ ] **Step 5: Add sender regression tests**

Cover all five calendar slots, late-created payment beginning at next slot, accepted dedupe across two cron runs, frozen retry text/key, missing LINE recipient limited to one slot, invalid config, legacy due acceptance, initial/one-time immediate send, and existing terms-image message ordering.

- [ ] **Step 6: Update cron response test and run targeted suite**

Keep the one cron route. Confirm it generates T-7 links before calling the expanded sender and returns the existing response shape plus reminder results if added.

Run: `npm test -- src/lib/line/due-payments.test.ts src/app/api/cron/generate/route.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/lib/line/due-payments.ts src/lib/line/due-payments.test.ts src/app/api/cron/generate/route.ts src/app/api/cron/generate/route.test.ts
git commit -m "feat: send installment payment reminders"
```

### Task 6: Build Settings controls and secure server actions

**Files:**
- Modify: `src/components/admin/line-due-template-form.tsx`
- Modify: `src/components/admin/line-due-template-form.test.tsx`
- Modify: `src/app/admin/(protected)/settings/line-actions.ts`
- Modify: `src/app/admin/(protected)/settings/line-actions.test.ts`
- Modify: `src/app/admin/(protected)/settings/page.tsx`
- Modify: `src/app/admin/(protected)/settings/page.test.tsx`

**Interfaces:**
- Produces preview/save/reset actions accepting one complete `LineInstallmentReminderConfig` JSON payload and a selected `ReminderSlot` for preview/reset.
- Extends `LineDueTemplateForm` props with resolved reminder configuration and reminder actions.

- [ ] **Step 1: Write failing server-action tests**

```ts
it("saves all five reminder profiles atomically and audits only setting key", async () => {
  await saveLineInstallmentReminderConfigAction(formDataWithReminderConfig());
  expect(mocks.saveLineInstallmentReminderConfig).toHaveBeenCalledWith(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.DUE_DATE.message);
});
```

- [ ] **Step 2: Run action tests and verify RED**

Run: `npm test -- src/app/admin/(protected)/settings/line-actions.test.ts`

Expected: FAIL because reminder actions do not exist.

- [ ] **Step 3: Implement actions and audit**

Require admin access, parse entire submitted config before any persistence, preview only the named slot with existing safe installment values, save the one JSON setting, and audit `LINE_INSTALLMENT_REMINDER_CONFIG_SAVED` or reset without including template content. Revalidate `/admin/settings` only after a successful write.

- [ ] **Step 4: Write failing form/page tests**

```tsx
it("shows five fixed installment reminder editors and no slot toggle", () => {
  render(<LineDueTemplateForm {...props} />);
  expect(screen.getByLabelText("T−7 days message")).toBeInTheDocument();
  expect(screen.getByLabelText("T+1 day message")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /T−7/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Implement form extension and page wiring**

Keep the one-time editor unchanged. Replace the single installment tab content with five clearly labeled fixed sections. Each section uses existing `LinePlaceholderEditor` controls and slot-local custom placeholders. Keep edits client-local; one **Save reminder templates** action sends and saves the complete configuration atomically. Add the resolved config and actions in Settings page data flow.

- [ ] **Step 6: Run UI/action tests and commit**

Run: `npm test -- src/components/admin/line-due-template-form.test.tsx src/app/admin/(protected)/settings/line-actions.test.ts src/app/admin/(protected)/settings/page.test.tsx`

Commit:

```bash
git add src/components/admin/line-due-template-form.tsx src/components/admin/line-due-template-form.test.tsx src/app/admin/(protected)/settings/line-actions.ts src/app/admin/(protected)/settings/line-actions.test.ts src/app/admin/(protected)/settings/page.tsx src/app/admin/(protected)/settings/page.test.tsx
git commit -m "feat: configure installment reminder templates"
```

### Task 7: Verify full feature and document scope update

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-installment-payment-reminders-design.md`
- Create: no new production files

- [ ] **Step 1: Add or adjust cross-boundary regression tests**

Run focused tests that prove the public behavior: immediate initial/one-time generation, later-installment T-7 creation, five global configurable templates, no late backfill, QR attachment, payment-stop behavior, retry idempotency, and legacy deduplication.

- [ ] **Step 2: Run quality gates**

Run:

```bash
npm run lint
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Update design status and commit verification artifacts**

Mark the design implementation status complete only after all gates pass. Commit any final documentation/test-only fixes.

```bash
git add docs/superpowers/specs/2026-08-15-installment-payment-reminders-design.md
git commit -m "docs: finalize installment reminder design"
```

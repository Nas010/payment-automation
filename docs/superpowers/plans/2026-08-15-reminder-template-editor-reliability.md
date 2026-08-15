# Reminder Template Editor Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installment reminder templates accept optional placeholder usage, preview one slot independently, save all slots atomically, and report validation failures in the editor.

**Architecture:** Keep profile parsing and rendering in `message-profile.ts`, but remove its required-placeholder policy. Give reminder preview a profile-sized request boundary while preserving the full-config boundary for save. Rebuild the reminder client form from existing due-template editor primitives, with slot-local revisions, previews, outcomes, and profile-local custom-placeholder controls.

**Tech Stack:** Next.js 15 server actions, React 19, strict TypeScript, Zod, Vitest, Testing Library, existing shadcn UI components.

## Global Constraints

- Any system placeholder may be omitted from message text.
- Any used placeholder must be known and resolvable.
- Custom placeholders remain profile-local; `payment_label` requires a definition in that slot.
- Save validates and persists all five slots atomically.
- Preview validates only selected slot.
- Payment QR remains attached by delivery code.
- Validation errors must be visible without exposing template text in audit metadata.
- Preserve edits made while preview/save requests are pending.

---

### Task 1: Optional Placeholder Domain Validation

**Files:**
- Modify: `src/lib/line/message-profile.ts`
- Test: `src/lib/line/message-profile.test.ts`

**Interfaces:**
- Consumes: `validateLineDueMessageProfile(profile, paymentType)` and `renderLineDueMessageProfile(profile, paymentType, systemValues)`.
- Produces: same signatures; profiles no longer need `amount`, `due_date`, or `payment_url` unless their message references them.

- [ ] **Step 1: Write failing optional-placeholder tests**

Add tests proving plain text and a subset of system placeholders validate and render:

```ts
it("allows every system placeholder to be omitted", () => {
  const profile = { version: 1 as const, message: "Friendly reminder", customPlaceholders: [] };
  expect(() => validateLineDueMessageProfile(profile, "INSTALLMENTS")).not.toThrow();
  expect(renderLineDueMessageProfile(profile, "INSTALLMENTS", {})).toBe("Friendly reminder");
});

it("requires data only for placeholders used by the message", () => {
  const profile = { version: 1 as const, message: "Hi {{client_name}}", customPlaceholders: [] };
  expect(renderLineDueMessageProfile(profile, "INSTALLMENTS", { client_name: "Nisa" })).toBe("Hi Nisa");
});
```

Replace the obsolete test that expects unused required data to fail. Retain unknown-placeholder and missing-referenced-data tests.

- [ ] **Step 2: Run tests and verify red state**

Run:

```bash
npx vitest run src/lib/line/message-profile.test.ts
```

Expected: new optional-placeholder tests fail with `LINE profile requires placeholder: amount`.

- [ ] **Step 3: Remove required-placeholder reachability policy**

Delete `REQUIRED` and the `reachable` validation loop. Keep parsing main placeholders, validating unknown system/custom names, and validating custom definitions. Rendering remains responsible for rejecting missing data only when substitution encounters a referenced placeholder.

- [ ] **Step 4: Run domain tests and verify green state**

Run:

```bash
npx vitest run src/lib/line/message-profile.test.ts
```

Expected: all domain tests pass.

- [ ] **Step 5: Commit domain behavior**

```bash
git add src/lib/line/message-profile.ts src/lib/line/message-profile.test.ts
git commit -m "fix: make line message placeholders optional"
```

### Task 2: Independent Reminder Preview and Atomic Save Actions

**Files:**
- Modify: `src/app/admin/(protected)/settings/line-actions.ts`
- Test: `src/app/admin/(protected)/settings/line-actions.test.ts`

**Interfaces:**
- Consumes: `parseLineDueMessageProfile(value, "INSTALLMENTS")`, `parseLineInstallmentReminderConfig(value)`, and existing safe preview values.
- Produces: `previewLineInstallmentReminderAction(formData)` accepting `slot` plus `profile`; save continues accepting `slot` plus full `config`.
- Produces: `ReminderConfigActionResult` unchanged: `{ ok: true; slot; config; preview }`; preview returns submitted profile merged into a default-shaped config only for response compatibility.

- [ ] **Step 1: Extend action mocks and imports**

Add `saveLineInstallmentReminderConfig` to hoisted mocks and mocked `@/lib/sheets/settings`. Import reminder preview/save/reset actions and `DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG` in action tests.

- [ ] **Step 2: Write failing action tests**

Cover selected-profile preview, atomic full-config save, rejected invalid save, and admin protection:

```ts
it("previews only the selected reminder profile", async () => {
  const formData = new FormData();
  formData.set("slot", "T_MINUS_3_DAYS");
  formData.set("profile", JSON.stringify({ version: 1, message: "Three-day reminder", customPlaceholders: [] }));
  await expect(previewLineInstallmentReminderAction(formData)).resolves.toMatchObject({
    slot: "T_MINUS_3_DAYS",
    preview: "Three-day reminder",
  });
  expect(mocks.saveLineInstallmentReminderConfig).not.toHaveBeenCalled();
});
```

Save test must assert one call with complete config plus audit metadata containing only setting key. Invalid save must assert neither persistence nor audit occurred. Auth test must reject before parsing.

- [ ] **Step 3: Run action tests and verify red state**

Run:

```bash
npx vitest run 'src/app/admin/(protected)/settings/line-actions.test.ts'
```

Expected: preview test fails because current action requires `config`; reminder persistence mock coverage is absent.

- [ ] **Step 4: Split preview parsing from save parsing**

Add strict slot parsing:

```ts
function submittedReminderSlot(formData: FormData): ReminderSlot {
  const slot = String(formData.get("slot") ?? "");
  if (!REMINDER_SLOTS.includes(slot as ReminderSlot)) {
    throw new LineDueTemplateError("TEMPLATE_INVALID", "Reminder slot is required");
  }
  return slot as ReminderSlot;
}
```

Preview parses `profile`, renders it, and returns a response config with only that slot replaced. Save parses complete `config`, persists once, audits once, and returns due-date preview. Reset behavior stays full-config.

- [ ] **Step 5: Run action tests and verify green state**

Run:

```bash
npx vitest run 'src/app/admin/(protected)/settings/line-actions.test.ts'
```

Expected: all action tests pass.

- [ ] **Step 6: Commit action boundary**

```bash
git add 'src/app/admin/(protected)/settings/line-actions.ts' 'src/app/admin/(protected)/settings/line-actions.test.ts'
git commit -m "fix: isolate reminder template previews"
```

### Task 3: Reliable Reminder Template Editor

**Files:**
- Modify: `src/components/admin/line-installment-reminder-form.tsx`
- Create: `src/components/admin/line-installment-reminder-form.test.tsx`

**Interfaces:**
- Consumes: `LinePlaceholderEditor`, `systemPlaceholders("INSTALLMENTS")`, `lineDueTemplatePlaceholders`, reminder actions from Task 2.
- Produces: same component props; preview requests contain `slot` and `profile`, save requests contain `slot` and `config`.

- [ ] **Step 1: Create test harness**

Create jsdom test setup with structured-cloned defaults, mocked preview/save/reset actions, `requestAnimationFrame`, cleanup, and a `deferred<T>()` helper matching `line-due-template-form.test.ts`.

- [ ] **Step 2: Write failing editor tests**

Cover:

```ts
it("submits only selected profile for preview and shows slot-local output", async () => {
  renderReminderForm();
  fireEvent.click(screen.getByRole("button", { name: "Preview T−3 days message" }));
  await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());
  const data = previewAction.mock.calls[0][0] as FormData;
  expect(data.get("slot")).toBe("T_MINUS_3_DAYS");
  expect(data.get("profile")).toBeTruthy();
  expect(data.get("config")).toBeNull();
});

it("shows a rejected validation message", async () => {
  renderReminderForm({ previewAction: vi.fn().mockRejectedValue(new Error("Unsupported LINE placeholder: payment_label")) });
  fireEvent.click(screen.getByRole("button", { name: "Preview T−7 days message" }));
  expect(await screen.findByText("Unsupported LINE placeholder: payment_label")).toBeTruthy();
});
```

Also test adding/defining/inserting `payment_label`, saving complete config once, confirmation text, blocking overlaps, retaining edits during pending preview/save, and restore-default behavior.

- [ ] **Step 3: Run component tests and verify red state**

Run:

```bash
npx vitest run src/components/admin/line-installment-reminder-form.test.tsx
```

Expected: failures because current editor has raw textareas, shared preview state, full-config preview payloads, and no rejection handling.

- [ ] **Step 4: Implement profile-local editor helpers**

Use installment system options for custom definitions. Use system plus current custom options for main message. Implement `customIsReferenced`, `nextCustomName`, `updateCustomTemplate`, `renameCustom`, `removeCustom`, and `addCustom` against one `ReminderSlot`, preserving immutable state updates.

- [ ] **Step 5: Implement request and revision state**

Track:

```ts
const [previewBySlot, setPreviewBySlot] = useState<Record<ReminderSlot, string>>(emptySlotStrings);
const [outcomeBySlot, setOutcomeBySlot] = useState<Record<ReminderSlot, string>>(emptySlotStrings);
const revisions = useRef<Record<ReminderSlot, number>>(emptySlotNumbers);
const requestInFlight = useRef(false);
```

Preview sends selected profile and never replaces editor state. Save sends full config and applies returned config only when no slot revision changed since submission. Catch errors, expose message through `aria-live="polite"`, release request lock in `finally`.

- [ ] **Step 6: Render accessible per-slot controls**

Render a bordered fieldset per slot with `LinePlaceholderEditor`, custom placeholder controls, `Preview <label> message` accessible button names, and slot-local preview/outcome. Keep one atomic `Save reminder templates` button and one `Restore defaults` button. Describe placeholders as optional.

- [ ] **Step 7: Run component tests and verify green state**

Run:

```bash
npx vitest run src/components/admin/line-installment-reminder-form.test.tsx
```

Expected: all reminder editor tests pass.

- [ ] **Step 8: Commit editor behavior**

```bash
git add src/components/admin/line-installment-reminder-form.tsx src/components/admin/line-installment-reminder-form.test.tsx
git commit -m "fix: surface reminder template validation"
```

### Task 4: Regression Verification

**Files:**
- Verify all changed files from Tasks 1-3.

**Interfaces:**
- Consumes: final domain, action, and editor behavior.
- Produces: verified production-buildable change.

- [ ] **Step 1: Run focused regression tests**

```bash
npx vitest run src/lib/line/message-profile.test.ts 'src/app/admin/(protected)/settings/line-actions.test.ts' src/components/admin/line-installment-reminder-form.test.tsx src/components/admin/line-due-template-form.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run required project checks**

```bash
npm run lint
npm test
npm run build
```

Expected: zero failures.

- [ ] **Step 3: Review diff and working tree**

```bash
git diff --check
git status --short
git log -5 --oneline
```

Expected: no whitespace errors; only intended changes or clean tree after task commits.

- [ ] **Step 4: Record verification outcome**

Report focused-test count, full-test count, lint status, build status, commits, and any remaining deployment requirement. Do not claim production fixed until deployment succeeds.

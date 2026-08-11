# Existing Client Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins assign another package or schedule custom one-time/recurring payments for an existing client.

**Architecture:** Canonical `Installment Schedule` rows represent both package extensions and custom charges. Pure helpers construct rows and calculate client totals; authenticated server actions persist rows/audit entries, while a focused client component exposes both workflows on client detail.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zod, React Hook Form, shadcn/Base UI, Google Sheets repositories, Vitest, Testing Library.

## Global Constraints

- Existing schedules, payments, and audit history remain unchanged.
- Package assignment uses active package defaults and updates only the client row's current package summary.
- Manual payments do not mutate the client's current package summary.
- Recurrence is finite, uses a payment count, and supports whole-month intervals only.
- Payment links continue through the existing due-link generator; new actions do not generate links directly.
- No workbook schema, dependency, or live vendor configuration changes.
- Preserve unrelated dirty-worktree edits.

---

### Task 1: Canonical schedule-row construction

**Files:**
- Create: `src/lib/plans/assignment.ts`
- Test: `src/lib/plans/assignment.test.ts`

**Interfaces:**
- Consumes: `buildInstallmentPlan(input: InstallmentPlanInput): PlannedInstallment[]` and `NewScheduleRecord`.
- Produces: `buildAssignedScheduleRows(input: AssignedScheduleInput): NewScheduleRecord[]`.

- [ ] **Step 1: Write failing tests for package/custom schedule rows**

```ts
it("builds canonical rows for an existing linked client", () => {
  const rows = buildAssignedScheduleRows({
    client: { client_id: "client_1", client_name: "Nisa", line_user_id: "U1", line_display_name: "Nisa LINE" },
    label: "Extension", paymentType: "INSTALLMENTS", totalSatang: 10001,
    paymentCount: 2, intervalMonths: 1, firstDueDate: "2026-08-31",
    notes: "Round two", now: "2026-08-11T00:00:00.000Z",
    createScheduleId: (index) => `schedule_${index + 1}`,
  });
  expect(rows.map((row) => ({ id: row.schedule_id, amount: row.amount_thb, due: row.due_date }))).toEqual([
    { id: "schedule_1", amount: "50", due: "2026-08-31" },
    { id: "schedule_2", amount: "50.01", due: "2026-09-30" },
  ]);
  expect(rows[0]).toMatchObject({ client_id: "client_1", line_user_id: "U1", package_name: "Extension", status: "SCHEDULED" });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- src/lib/plans/assignment.test.ts`

Expected: FAIL because `assignment.ts` does not exist.

- [ ] **Step 3: Implement minimal row builder**

Use `buildInstallmentPlan` for amounts/dates. Map each planned installment into all 18 required schedule fields, copy client identity/LINE fields, set empty generation/payment fields, and call injected `createScheduleId(index)`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- src/lib/plans/assignment.test.ts src/lib/plans/schedule.test.ts`

Expected: both files pass.

- [ ] **Step 5: Commit domain unit**

```bash
git add src/lib/plans/assignment.ts src/lib/plans/assignment.test.ts
git commit -m "feat: build existing client schedules"
```

---

### Task 2: Client billing summary

**Files:**
- Create: `src/lib/admin/client-billing.ts`
- Test: `src/lib/admin/client-billing.test.ts`

**Interfaces:**
- Consumes: schedule-like values with `amount_thb`, `due_date`, and `status`.
- Produces: `buildClientBillingSummary(schedules)` returning `{ orderedSchedules, totalSatang, paidSatang, outstandingSatang, nextDueDate }`.

- [ ] **Step 1: Write a failing multi-plan summary test**

```ts
it("summarizes every package and custom charge chronologically", () => {
  const summary = buildClientBillingSummary([
    { schedule_id: "future", amount_thb: "200", due_date: "2026-10-01", status: "SCHEDULED" },
    { schedule_id: "paid", amount_thb: "100", due_date: "2026-08-01", status: "PAID" },
    { schedule_id: "next", amount_thb: "50.50", due_date: "2026-09-01", status: "GENERATED" },
  ]);
  expect(summary).toMatchObject({ totalSatang: 35050, paidSatang: 10000, outstandingSatang: 25050, nextDueDate: "2026-09-01" });
  expect(summary.orderedSchedules.map((row) => row.schedule_id)).toEqual(["paid", "next", "future"]);
});
```

- [ ] **Step 2: Run focused test and confirm RED**

Run: `npm test -- src/lib/admin/client-billing.test.ts`

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement pure summary helper**

Parse amounts with `parseSatang`, treat malformed values as zero for display, copy-sort by due date then schedule ID, count only `PAID` as paid, and find first chronological non-paid row.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- src/lib/admin/client-billing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit summary unit**

```bash
git add src/lib/admin/client-billing.ts src/lib/admin/client-billing.test.ts
git commit -m "feat: summarize client billing history"
```

---

### Task 3: Authenticated package and manual-payment actions

**Files:**
- Modify: `src/app/admin/(protected)/actions.ts`
- Modify: `src/app/admin/(protected)/actions.test.ts`

**Interfaces:**
- Consumes: `buildAssignedScheduleRows`, `listClients`, `listPackages`, `writeSchedule`, `updateClient`, `appendAudit`.
- Produces: `assignPackageAction(clientId: string, formData: FormData): Promise<void>` and `createManualPaymentAction(clientId: string, formData: FormData): Promise<void>`.

- [ ] **Step 1: Add failing action tests**

Test package assignment with a linked client and active installment package. Assert two canonical schedule writes, client summary update, `PACKAGE_ASSIGNED` audit, client/admin revalidation, and redirect. Add an inactive-package rejection asserting zero writes.

Test recurring manual payment with description `Nutrition check-in`, amount `1200`, count `3`, interval `1`, and first due `2026-08-15`. Assert three schedule writes, `MANUAL_PAYMENT_SCHEDULED` audit, and no client update. Add one-time normalization coverage proving browser-supplied count/interval values become `1`/`0`.

- [ ] **Step 2: Run action tests and confirm RED**

Run: `npm test -- 'src/app/admin/(protected)/actions.test.ts'`

Expected: FAIL because both exports are missing.

- [ ] **Step 3: Implement strict schemas and shared persistence helper**

Add Zod schemas:

```ts
const assignPackageSchema = z.object({
  package_name: z.string().trim().min(1),
  first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim(),
});

const manualPaymentSchema = z.object({
  description: z.string().trim().min(1),
  amount_thb: z.string(),
  frequency: z.enum(["ONE_TIME", "RECURRING"]),
  payment_count: z.coerce.number().int().min(1),
  interval_months: z.coerce.number().int().min(0),
  first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim(),
});
```

Resolve client/package from repositories, normalize package values and manual recurrence, build rows, write sequentially, append one audit record, revalidate `/admin`, `/admin/clients`, and selected detail path, then redirect.

- [ ] **Step 4: Run action and domain tests and confirm GREEN**

Run: `npm test -- 'src/app/admin/(protected)/actions.test.ts' src/lib/plans/assignment.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit action layer**

```bash
git add 'src/app/admin/(protected)/actions.ts' 'src/app/admin/(protected)/actions.test.ts'
git commit -m "feat: add existing client billing actions"
```

---

### Task 4: Existing-client billing forms

**Files:**
- Create: `src/components/admin/client-billing-actions.tsx`
- Create: `src/components/admin/client-billing-actions.test.ts`

**Interfaces:**
- Consumes: active package options and two bound `(formData: FormData) => void | Promise<void>` actions.
- Produces: `ClientBillingActions` containing accessible package and custom-payment forms.

- [ ] **Step 1: Write failing component tests**

Render with one active package. Assert headings `Assign package` and `Add manual payment`, labels for package/date/description/amount/frequency/count/interval, and submit buttons. Submit default forms and assert package action receives selected package/date while manual action receives `frequency=ONE_TIME`, `payment_count=1`, and `interval_months=0`.

- [ ] **Step 2: Run component test and confirm RED**

Run: `npm test -- src/components/admin/client-billing-actions.test.ts`

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement focused responsive forms**

Use two full shadcn cards in `grid gap-4 xl:grid-cols-2`. Compose forms with `FieldSet`, `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, `Input`, `Select`, `Textarea`, and `Button`. Use React Hook Form/Zod for client validation and `useTransition` for pending buttons. Package selection shows saved total/payment terms. One-time mode locks count/interval to `1`/`0`; recurring unlocks both and requires count ≥2 and interval ≥1.

- [ ] **Step 4: Run component test and confirm GREEN**

Run: `npm test -- src/components/admin/client-billing-actions.test.ts src/components/admin/client-form.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit UI unit**

```bash
git add src/components/admin/client-billing-actions.tsx src/components/admin/client-billing-actions.test.ts
git commit -m "feat: add client billing forms"
```

---

### Task 5: Integrate client detail read model and UI

**Files:**
- Modify: `src/app/admin/(protected)/clients/[clientId]/page.tsx`

**Interfaces:**
- Consumes: `buildClientBillingSummary`, `ClientBillingActions`, active packages, and bound server actions.
- Produces: client detail with correct all-schedule metrics, new billing workflows, package/custom schedule labels, chronological rows, and empty states.

- [ ] **Step 1: Add page integration using tested units**

Load clients, schedules, payments, audit, and packages in one `Promise.all`. Filter active packages, bind both actions to `clientId`, and render `ClientBillingActions` after metrics. Replace client-row total with summary values. Add `Plan or charge` to schedule table, render ordered schedules, and use existing `EmptyTableRow` when absent. Show concise empty copy for activity/payments.

- [ ] **Step 2: Run focused feature tests**

Run: `npm test -- src/lib/admin/client-billing.test.ts src/components/admin/client-billing-actions.test.ts 'src/app/admin/(protected)/actions.test.ts'`

Expected: PASS.

- [ ] **Step 3: Run lint for changed implementation**

Run: `npx eslint src/lib/plans/assignment.ts src/lib/admin/client-billing.ts src/components/admin/client-billing-actions.tsx 'src/app/admin/(protected)/actions.ts' 'src/app/admin/(protected)/clients/[clientId]/page.tsx'`

Expected: exit 0.

- [ ] **Step 4: Commit integration**

```bash
git add 'src/app/admin/(protected)/clients/[clientId]/page.tsx'
git commit -m "feat: expose existing client billing"
```

---

### Task 6: Full verification and browser QA

**Files:**
- Modify only if verification exposes feature defects.

**Interfaces:**
- Consumes: complete feature and existing admin app.
- Produces: evidence that behavior, build, and responsive UI are valid.

- [ ] **Step 1: Run full static and test verification**

Run: `npm run lint && npm test && npm run build`

Expected: lint exit 0, all tests pass, production build exit 0.

- [ ] **Step 2: Start local app**

Run: `npm run dev`

Expected: Next.js reports a localhost URL with no startup error.

- [ ] **Step 3: Verify desktop workflow**

Open an existing `/admin/clients/<clientId>` page. Confirm both action cards, active package options, package summary, manual one-time defaults, recurring count/interval controls, and chronological schedule labels. Submit only when local fake/safe Sheets configuration is available; otherwise verify form validation and record live-write limitation.

- [ ] **Step 4: Verify mobile workflow**

At a mobile viewport, confirm cards stack, fields/buttons remain visible, schedule table scrolls horizontally, and no content clips or overflows.

- [ ] **Step 5: Inspect final diff and spec coverage**

Run: `git diff --check && git status --short && git diff --stat HEAD~5..HEAD`

Confirm package extension, custom one-time/recurring scheduling, totals, audit, auth, error validation, responsive UI, and no spreadsheet/vendor changes are represented.

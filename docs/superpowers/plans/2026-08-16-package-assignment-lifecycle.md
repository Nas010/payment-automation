# Package Assignment Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Safely change, pause, resume, end, or delete an assigned client package while preserving paid and installment history.

**Architecture:** Schedule rows gain assignment identity/kind metadata but remain canonical ledger. Pure helpers group new and legacy package rows. Protected actions change only outstanding rows and void stale links. Detail UI derives assignment cards; public routes reject voided payments.

**Tech Stack:** Next.js 15 server actions, React 19, TypeScript, Google Sheets repositories, Zod, Vitest, Testing Library.

## Global Constraints

- Preserve paid schedules and terminal payments exactly.
- Replacement credits PAID amount; schedule max(targetTotal - paid, 0).
- PIF downgrade schedules no refund; write excess credit to audit metadata.
- Controls manage package assignments only, never manual charges.
- Void only PENDING generated payments. REVIEW and FLAGGED block mutation.
- Delete requires zero paid rows; mark DELETED, never erase.
- Unit tests make no live Google or LINE calls.

---

### Task 1: Extend schedule schema

**Files:**

- Modify: src/lib/sheets/records.ts
- Modify: src/lib/sheets/migration.ts
- Modify: src/lib/sheets/migration.test.ts
- Modify: src/lib/sheets/schedules.ts
- Modify: src/lib/sheets/schedules.test.ts
- Modify: src/lib/sheets/payment-client-snapshot.ts
- Modify: src/lib/sheets/payment-client-snapshot.test.ts
- Modify: src/lib/workspace/workbook.ts
- Modify: src/lib/workspace/workbook.test.ts

**Interfaces:**

- Consumes: 18-column Installment Schedule rows.
- Produces: assignment_id: string, assignment_kind: string, ensureScheduleSchema(): Promise<void>.

- [ ] **Step 1: Write failing tests**

Require metadata/header migration and dynamic final column:

~~~ts
expect(SCHEDULE_HEADERS.slice(-2)).toEqual(["assignment_id", "assignment_kind"]);
expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Installment Schedule!A1:T1" });
expect(update).toHaveBeenCalledWith(expect.objectContaining({
  range: "Installment Schedule!S1",
  requestBody: { values: [["assignment_id"]] },
}));
~~~

Require schedule reads/writes, payment snapshot, and provisioned workbook to use dynamic SCHEDULE_HEADERS.length.

- [ ] **Step 2: Verify RED**

Run: npx vitest run src/lib/sheets/migration.test.ts src/lib/sheets/schedules.test.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/workspace/workbook.test.ts

Expected: missing fields/ranges/migration assertions fail.

- [ ] **Step 3: Implement**

Append fields to SCHEDULE_HEADERS. Add cached ensureScheduleSchema wrapping ensureSheetSchema("Installment Schedule", SCHEDULE_HEADERS). Invoke it before all schedule and snapshot reads/writes. Replace hard-coded A:R with sheetColumnName(SCHEDULE_HEADERS.length).

~~~ts
export function ensureScheduleSchema(): Promise<void> {
  if (scheduleSchemaCheck) return scheduleSchemaCheck;
  const cached = ensureSheetSchema("Installment Schedule", SCHEDULE_HEADERS).catch((error) => {
    if (scheduleSchemaCheck === cached) scheduleSchemaCheck = null;
    throw error;
  });
  scheduleSchemaCheck = cached;
  return cached;
}
~~~

- [ ] **Step 4: Verify GREEN**

Run Step 2 command. Expected: all focused tests pass.

- [ ] **Step 5: Commit**

~~~bash
git add src/lib/sheets/records.ts src/lib/sheets/migration.ts src/lib/sheets/migration.test.ts src/lib/sheets/schedules.ts src/lib/sheets/schedules.test.ts src/lib/sheets/payment-client-snapshot.ts src/lib/sheets/payment-client-snapshot.test.ts src/lib/workspace/workbook.ts src/lib/workspace/workbook.test.ts
git commit -m "feat: add schedule assignment metadata"
~~~

### Task 2: Add assignment lifecycle domain model

**Files:**

- Create: src/lib/plans/assignment-lifecycle.ts
- Create: src/lib/plans/assignment-lifecycle.test.ts
- Modify: src/lib/plans/assignment.ts
- Modify: src/lib/plans/assignment.test.ts
- Modify: src/lib/plans/schedule.ts
- Modify: src/lib/plans/schedule.test.ts
- Modify: src/lib/admin/client-billing.ts
- Modify: src/lib/admin/client-billing.test.ts

**Interfaces:**

- Consumes: schedule rows with state and optional assignment metadata plus saved package names.
- Produces: assignmentIdForSchedule, buildPackageAssignments, assignment state/read model, and schedule builder metadata.

- [ ] **Step 1: Write failing tests**

~~~ts
const assignments = buildPackageAssignments(rows, new Set(["Coaching"]));
expect(assignments).toMatchObject([{
  id: "assignment_1",
  state: "PAUSED",
  paidSatang: 50_000,
  outstandingSatang: 50_000,
}]);
expect(assignments).not.toContainEqual(expect.objectContaining({ label: "Extra session" }));
expect(assignmentIdForSchedule(legacyRow)).toMatch(/^legacy:/);
~~~

Cover ACTIVE, PAUSED, ENDED, DELETED, COMPLETED; PIF/partial-installment totals; manual exclusion; and same-name assignments whose IDs prevent cross-plan totals. Require client totals to exclude CANCELLED/DELETED, retain paused balance, and omit paused next due date.

- [ ] **Step 2: Verify RED**

Run: npx vitest run src/lib/plans/assignment-lifecycle.test.ts src/lib/plans/assignment.test.ts src/lib/plans/schedule.test.ts src/lib/admin/client-billing.test.ts

Expected: module/metadata/state assertions fail.

- [ ] **Step 3: Implement**

Use deterministic legacy ID from client, package, payment type, installment count, and created time. Infer blank legacy group as PACKAGE only if name occurs in saved packages. Group new rows by assignment_id; derive state from non-paid statuses.

Update plan totals to prefer assignment identity:

~~~ts
const group = schedules.filter((item) => target.assignment_id
  ? item.assignment_id === target.assignment_id
  : item.client_id === target.client_id
    && item.package_name === target.package_name
    && item.payment_type === target.payment_type
    && item.installment_count === target.installment_count
    && item.created_at === target.created_at);
~~~

Accept assignmentId and assignmentKind in buildAssignedScheduleRows; emit them in every new row.

- [ ] **Step 4: Verify GREEN**

Run Step 2 command. Expected: all focused domain tests pass.

- [ ] **Step 5: Commit**

~~~bash
git add src/lib/plans/assignment-lifecycle.ts src/lib/plans/assignment-lifecycle.test.ts src/lib/plans/assignment.ts src/lib/plans/assignment.test.ts src/lib/plans/schedule.ts src/lib/plans/schedule.test.ts src/lib/admin/client-billing.ts src/lib/admin/client-billing.test.ts
git commit -m "feat: derive package assignment lifecycle"
~~~

### Task 3: Persist package lifecycle actions

**Files:**

- Modify: src/app/admin/(protected)/actions.ts
- Modify: src/app/admin/(protected)/actions.test.ts

**Interfaces:**

- Consumes: changePackageAssignmentAction(clientId, formData), pausePackageAssignmentAction(clientId, formData), resumePackageAssignmentAction(clientId, formData), endPackageAssignmentAction(clientId, formData), deletePackageAssignmentAction(clientId, formData).
- Produces: status updates, VOID payment updates, replacement schedules, client snapshots, and audit events.

- [ ] **Step 1: Write failing action tests**

Extend mocks with listPayments, updateSchedule, updatePaymentIfUnchanged. Fixture: two-row assignment_1, first PAID 500 THB, second GENERATED with PENDING payment.

~~~ts
await changePackageAssignmentAction("client_1", formData);
expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({
  payment: expect.objectContaining({ status: "VOID", line_slip_expected: "FALSE" }),
}));
expect(mocks.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({
  assignment_kind: "PACKAGE", amount_thb: "1000",
}));
~~~

Add PIF downgrade: no new schedule + excessCreditSatang audit. Add pause/resume/end, paid-row delete rejection, unpaid delete success, and REVIEW blocking. Require created/assigned packages use PACKAGE; manual rows use MANUAL.

- [ ] **Step 2: Verify RED**

Run: npx vitest run 'src/app/admin/(protected)/actions.test.ts'

Expected: lifecycle exports and new assertions fail.

- [ ] **Step 3: Implement**

Load client-owned schedules/payments; derive assignment ownership; reject foreign/manual/terminal rows. For each generated outstanding row, atomically void PENDING payment before detaching schedule link. Reject review/flagged payment.

~~~ts
const voided = {
  ...payment,
  status: "VOID",
  line_slip_expected: "FALSE",
  line_slip_processing_status: "STOPPED",
  updated_at: now,
};
if (!await updatePaymentIfUnchanged({ expectedPayment: payment, payment: voided })) {
  throw new Error("Payment changed before package lifecycle update");
}
await updateSchedule({
  ...schedule,
  status: nextStatus,
  generated_at: "",
  payment_id: "",
  payment_url: "",
  updated_at: now,
});
~~~

Use PAUSED, CANCELLED, DELETED only for non-paid schedules. Change action cancels old outstanding rows, creates new PACKAGE assignment for remaining balance/target terms, and audits after all required writes.

- [ ] **Step 4: Verify GREEN**

Run Step 2 command. Expected: PIF/installment/stale-link tests pass.

- [ ] **Step 5: Commit**

~~~bash
git add 'src/app/admin/(protected)/actions.ts' 'src/app/admin/(protected)/actions.test.ts'
git commit -m "feat: manage assigned package lifecycle"
~~~

### Task 4: Show lifecycle controls on client detail

**Files:**

- Create: src/components/admin/client-package-assignments.tsx
- Create: src/components/admin/client-package-assignments.test.tsx
- Modify: src/app/admin/(protected)/clients/[clientId]/page.tsx
- Modify: src/app/admin/(protected)/clients/[clientId]/client-detail-page.test.tsx

**Interfaces:**

- Consumes: assignment read model, active package templates, and bound lifecycle actions.
- Produces: cards/forms containing assignment_id, target package, first due date, and notes.

- [ ] **Step 1: Write failing UI/page tests**

Require a card for Coaching, 500 THB paid, 500 THB remaining, target selector, pause/end controls, and no manual Extra session card.

~~~ts
expect(Object.fromEntries(submitted)).toMatchObject({
  assignment_id: "assignment_1",
  package_name: "Premium coaching",
  first_due_date: "2026-09-01",
});
~~~

Require PIF card copy: deletion unavailable after recorded payment.

- [ ] **Step 2: Verify RED**

Run: npx vitest run src/components/admin/client-package-assignments.test.tsx 'src/app/admin/(protected)/clients/[clientId]/client-detail-page.test.tsx'

Expected: component/control assertions fail.

- [ ] **Step 3: Implement**

Render cards before New billing. Show state, paid, remaining, next due. Forms provide replacement and pause/resume/end/delete. Explain end/delete invalidates outstanding links; hide delete when paid amount nonzero. Manual payments stay in existing manual form.

- [ ] **Step 4: Verify GREEN**

Run Step 2 command. Expected: card/UI tests pass.

- [ ] **Step 5: Commit**

~~~bash
git add src/components/admin/client-package-assignments.tsx src/components/admin/client-package-assignments.test.tsx 'src/app/admin/(protected)/clients/[clientId]/page.tsx' 'src/app/admin/(protected)/clients/[clientId]/client-detail-page.test.tsx'
git commit -m "feat: add package lifecycle controls"
~~~

### Task 5: Disable voided payment links

**Files:**

- Modify: src/app/p/[token]/page.tsx
- Create: src/app/p/[token]/page.test.tsx
- Modify: src/app/api/payment/[token]/submit/route.ts
- Modify: src/app/api/payment/[token]/submit/route.test.ts
- Modify: src/app/api/payments/[publicToken]/promptpay-qr.png/route.ts
- Modify: src/app/api/payments/[publicToken]/promptpay-qr.png/route.test.ts

**Interfaces:**

- Consumes: Payment record status VOID.
- Produces: inactive-link UI, 409 upload rejection, 404 QR rejection.

- [ ] **Step 1: Write failing public-link tests**

~~~ts
mocks.getPaymentByToken.mockResolvedValue({ ...payment, status: "VOID" });
expect(await POST(request, context)).toMatchObject({ status: 409 });
expect(await GET(request, context)).toMatchObject({ status: 404 });
expect(html).toContain("This payment request is no longer active");
~~~

- [ ] **Step 2: Verify RED**

Run: npx vitest run 'src/app/p/[token]/page.test.tsx' 'src/app/api/payment/[token]/submit/route.test.ts' 'src/app/api/payments/[publicToken]/promptpay-qr.png/route.test.ts'

Expected: voided records still render, submit, or create QR.

- [ ] **Step 3: Implement**

Render inactive status before config/QR generation. Reject VOID with 409 before upload bytes. QR endpoint returns 404.

~~~ts
if (payment.status === "VOID") {
  return Response.json({ error: "This payment request is no longer active" }, { status: 409 });
}
~~~

- [ ] **Step 4: Verify GREEN**

Run Step 2 command. Expected: voided links cannot be used.

- [ ] **Step 5: Commit**

~~~bash
git add 'src/app/p/[token]/page.tsx' 'src/app/p/[token]/page.test.tsx' 'src/app/api/payment/[token]/submit/route.ts' 'src/app/api/payment/[token]/submit/route.test.ts' 'src/app/api/payments/[publicToken]/promptpay-qr.png/route.ts' 'src/app/api/payments/[publicToken]/promptpay-qr.png/route.test.ts'
git commit -m "fix: disable voided payment links"
~~~

### Task 6: Verify, review, and open PR

**Files:**

- Verify: Tasks 1-5 plus lifecycle docs.

- [ ] **Step 1: Inspect scope**

Run:

~~~bash
git diff main...HEAD --check
git status --short
~~~

Expected: planned files only; no whitespace errors.

- [ ] **Step 2: Focused regression**

Run:

~~~bash
npx vitest run src/lib/sheets/migration.test.ts src/lib/plans/assignment-lifecycle.test.ts 'src/app/admin/(protected)/actions.test.ts' src/components/admin/client-package-assignments.test.tsx 'src/app/api/payment/[token]/submit/route.test.ts'
~~~

Expected: zero failures.

- [ ] **Step 3: Full validation**

Run:

~~~bash
npm run lint && npm test && npm run build
~~~

Expected: each exits 0.

- [ ] **Step 4: Review**

Inspect git diff main...HEAD: PIF upgrade/downgrade, installment replacement, stale links, paid-history immutability. Add tests/fixes for findings, rerun affected tests, commit correction.

- [ ] **Step 5: Push and create PR**

~~~bash
git push -u origin codex/package-assignment-lifecycle
gh pr create --base main --head codex/package-assignment-lifecycle --title "feat: manage assigned package lifecycle" --body "..."
~~~

Expected: remote branch and PR exist. Do not merge or enable auto-merge.

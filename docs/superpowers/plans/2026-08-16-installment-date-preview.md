# Installment Date Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show exact installment due dates and amounts while configuring either client-payment plan.

**Architecture:** Add a focused preview child to shared `PaymentPlanFields`. It derives rows from watched values using `buildInstallmentPlan`, so UI schedule calculations match persisted schedule rows exactly.

**Tech Stack:** React 19, React Hook Form, Next.js, Vitest, Testing Library.

## Global Constraints

- Both new-client and assign-package flows use the same preview.
- Preview dates and satang allocations must use `buildInstallmentPlan`.
- Invalid/incomplete values produce no preview rows; no submission behavior changes.
- No live service calls in tests.

---

### Task 1: Establish date-preview behavior

**Files:**
- Modify: `src/components/admin/client-form.test.ts`
- Modify: `src/components/admin/client-billing-actions.test.ts`

**Interfaces:**
- Consumes: rendered forms with package-plan inputs.
- Produces: component expectations for exact preview rows.

- [ ] **Step 1: Write failing new-client test**

Add a test which enters total `100`, first date `2026-01-31`, installment count `3`, and interval `1`; it expects `Schedule preview`, then `31 Jan 2026 — ฿33.33`, `28 Feb 2026 — ฿33.33`, and `31 Mar 2026 — ฿33.34`.

- [ ] **Step 2: Write failing existing-client test**

Add a test which changes the assignment's first due date to `2026-01-31` and expects `Schedule preview`, `31 Jan 2026 — ฿600.00`, and `28 Feb 2026 — ฿600.00`.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run src/components/admin/client-form.test.ts src/components/admin/client-billing-actions.test.ts`

Expected: FAIL because no Schedule preview exists.

### Task 2: Render a shared schedule preview

**Files:**
- Create: `src/components/admin/installment-preview.tsx`
- Modify: `src/components/admin/payment-plan-fields.tsx`

**Interfaces:**
- Consumes: `totalPriceThb`, `firstDueDate`, `installmentCount`, and `intervalMonths` watched from `PaymentPlanFields`.
- Produces: `InstallmentPreview` with accessible heading and one formatted row per valid planned installment.

- [ ] **Step 1: Add preview component**

Export `InstallmentPreview`. Convert the submitted THB value into an exact non-negative satang integer, call `buildInstallmentPlan`, and return `null` for bad input or a thrown plan-validation error. Render compact rows using `formatDate(item.dueDate)` and `formatThb(item.amountSatang)`.

- [ ] **Step 2: Attach preview to shared form fields**

Watch price, due date, count, and interval in `PaymentPlanFields`; render `<InstallmentPreview>` after its numeric scheduling fields. It spans both grid columns and therefore appears in both payment-plan forms with no parent changes.

- [ ] **Step 3: Verify GREEN**

Run: `npx vitest run src/components/admin/client-form.test.ts src/components/admin/client-billing-actions.test.ts`

Expected: PASS; tests prove exact dates and split amounts in both flows.

### Task 3: Verify and deploy

**Files:**
- Verify: files above plus this spec and plan.

- [ ] **Step 1: Inspect change**

Run: `git diff --check` and `git status --short`; resolve any whitespace or unintended changes.

- [ ] **Step 2: Run required verification**

Run: `npm run lint && npm test && npm run build`.

Expected: all commands exit 0.

- [ ] **Step 3: Commit and deploy main**

Commit planned files with `feat: preview installment schedule dates`. Push `main`; deploy production via the repository's configured Vercel workflow and report deployment URL.

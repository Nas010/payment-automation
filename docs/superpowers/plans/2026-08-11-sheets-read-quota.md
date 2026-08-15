# Sheets Read Quota Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop normal payment writes and subsequent admin refreshes from exhausting Google Sheets' per-user read quota.

**Architecture:** Keep mutable payment rows uncached and preserve existing named-range concurrency control. Collapse Payments+Clients loading into one `values.batchGet` request, memoize successful schema checks per warm server process, reset failed schema promises for recovery, and replace misleading workbook-error copy.

**Tech Stack:** TypeScript, Google Sheets API v4, Next.js App Router, Vitest.

## Global Constraints

- Do not cache mutable payment or client row data across requests.
- Preserve payment CAS/named-range behavior.
- Failed schema checks must be retryable.
- Run lint, all tests, and production build before deployment.

---

### Task 1: Memoize successful schema checks

**Files:**
- Modify: `src/lib/sheets/migration.test.ts`
- Modify: `src/lib/sheets/migration.ts`

**Interfaces:**
- `ensureClientSchema(): Promise<void>`
- `ensurePaymentSchema(): Promise<void>`

- [x] **Step 1: Write failing tests**

Add tests proving two calls share one metadata/header read, while a rejected first call clears its promise and allows a second attempt.

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/lib/sheets/migration.test.ts`

Expected: repeated calls currently issue duplicate reads.

- [x] **Step 3: Implement minimal memoization**

Store one promise per schema. Retain successful promises; clear only the matching rejected promise before rethrowing.

- [x] **Step 4: Verify GREEN**

Run: `npx vitest run src/lib/sheets/migration.test.ts`

### Task 2: Batch Payments and Clients reads

**Files:**
- Create: `src/lib/sheets/payment-client-snapshot.test.ts`
- Create: `src/lib/sheets/payment-client-snapshot.ts`
- Modify: `src/app/admin/(protected)/payments/page.tsx`
- Modify: `src/app/admin/(protected)/payments/[paymentId]/page.tsx`
- Modify: `src/app/admin/(protected)/payments/payments-page.test.ts`
- Modify: `src/app/admin/(protected)/payments/[paymentId]/payment-detail-page.test.ts`
- Modify: `src/lib/line/due-payments.ts`
- Modify: `src/lib/line/due-payments.test.ts`

**Interfaces:**
- Produces: `readPaymentClientSnapshot(): Promise<{ payments: PaymentRecord[]; clients: ClientRecord[] }>`
- Adds optional dependency: `readPaymentClientSnapshot?: typeof readPaymentClientSnapshot`

- [x] **Step 1: Write failing repository test**

Require one `values.batchGet` call with literal ranges `Payments!A:AR` and `Clients!A:W`, then assert both parsed record collections.

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/lib/sheets/payment-client-snapshot.test.ts`

Expected: module does not exist.

- [x] **Step 3: Implement batched snapshot**

Ensure both schemas, call one `batchGet`, convert header-excluding rows with existing record helpers, and retain physical row numbers.

- [x] **Step 4: Use snapshot in hot paths**

Payment list/detail pages load one snapshot. Default LINE sender uses snapshot; injected unit-test dependencies retain separate loaders unless a snapshot loader is provided.

- [x] **Step 5: Verify focused tests**

Run: `npx vitest run src/lib/sheets/payment-client-snapshot.test.ts src/lib/line/due-payments.test.ts 'src/app/admin/(protected)/payments/payments-page.test.ts' 'src/app/admin/(protected)/payments/[paymentId]/payment-detail-page.test.ts'`

### Task 3: Correct quota-failure UI

**Files:**
- Create: `src/app/admin/(protected)/error.test.ts`
- Modify: `src/app/admin/(protected)/error.tsx`

**Interfaces:**
- Existing error-boundary component remains `AdminWorkbookError`.

- [x] **Step 1: Write failing UI test**

Require copy that says requests may be temporarily rate-limited, warns changes may already be saved, and removes false configuration-only diagnosis.

- [x] **Step 2: Verify RED**

Run: `npx vitest run 'src/app/admin/(protected)/error.test.ts'`

- [x] **Step 3: Implement accurate recovery copy**

Tell admin to wait one minute and retry once; if persistent, check workbook credentials/config.

- [x] **Step 4: Verify GREEN**

Run: `npx vitest run 'src/app/admin/(protected)/error.test.ts'`

### Task 4: Verify and deploy

**Files:**
- No additional source files.

- [ ] **Step 1: Run full checks**

Run: `npm run lint`, `npm test`, `npm run build`.

- [ ] **Step 2: Commit and publish**

Commit only scoped files, update GitHub `main`, wait for final Vercel production deployment, then verify `/api/health` returns 200.

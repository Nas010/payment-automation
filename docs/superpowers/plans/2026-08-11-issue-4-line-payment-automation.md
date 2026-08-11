# Issue #4 LINE Payment Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issue #4's idempotent LINE-first due-payment and chat-slip loop while retaining Google Sheets as system of record and `/p/[token]` as fallback.

**Architecture:** Append LINE delivery/intake fields to existing `Payments` rows, then compose focused template, PromptPay, LINE HTTP, outbound, and inbound services around that record. Both website and LINE images call one transport-independent slip processor; routes and admin actions only authenticate, select context, and invoke domain services.

**Tech Stack:** Next.js 15 App Router, strict TypeScript, React 19, Vitest, Google Sheets API, Google Apps Script, LINE Messaging API, `qrcode`, `sharp`, ZXing, Tesseract.

## Global Constraints

- GitHub issue #4 is approved source of truth; this plan maps implementation without replacing that specification.
- Google Sheets `Payments` remains payment system of record; schema changes append cells and never overwrite existing headers or values.
- PromptPay amounts use positive integer satang and the existing `buildPromptPayPayload` implementation for website and LINE QR output.
- LINE IDs must match `^U[0-9a-f]{32}$`; only #3-linked direct users receive automatic messages or have images evaluated.
- Persist rendered text and stable UUID retry key before first push; every retry reuses both values, including after template changes.
- `ACCEPTED` means LINE accepted the request, not read or delivered. A terminal payment never receives another QR request.
- LINE and website uploads converge on one evaluator; no paid payment/slip provider or bank-verification claim is introduced.
- Normal coaching images never reach download/OCR without a linked client and eligible `line_slip_expected=TRUE` payment.
- Reply failure occurs after payment persistence and never rolls back a recorded/review/flagged result.
- All external LINE, Google, storage, and OCR boundaries are mocked in unit tests; tests never use live credentials or services.
- Existing dirty admin-shell work in the original checkout is out of scope and must remain untouched.

---

### Task 1: Append payment schema and add due-message template domain

**Files:**
- Modify: `src/lib/sheets/records.ts`, `src/lib/sheets/payments.ts`, `src/lib/sheets/migration.ts`, `src/lib/sheets/settings.ts`
- Modify: `src/lib/sheets/records.test.ts`, `src/lib/sheets/migration.test.ts`
- Create: `src/lib/line/message-template.ts`, `src/lib/line/message-template.test.ts`
- Modify: `src/lib/plans/schedule.ts`, `src/lib/plans/schedule.test.ts`

**Interfaces:**
- `PAYMENT_HEADERS` appends `line_message_status`, `line_retry_key`, `line_message_attempted_at`, `line_message_sent_at`, `line_request_id`, `line_message_error`, `line_payment_requested_at`, `line_slip_expected`, `line_slip_received_at`, `line_source_message_id`, `line_slip_processing_status`, `line_slip_error`, `line_reply_status`, `line_reply_at` after existing column `qr_payload_hash`.
- `ensurePaymentSchema(): Promise<void>` expands `Payments` and fills blank appended header cells only.
- `DEFAULT_LINE_DUE_TEMPLATE`, `validateLineDueTemplate(template)`, and `renderLineDueTemplate(template, values)` allow only `client_name`, `payment_label`, `amount`, `due_date`, and `payment_url`; amount/date/URL are required and rendered text is 1-5000 characters.
- `getLineDueTemplate()` returns stored `line_due_message_template` or documented default.

- [ ] **Step 1: Write schema/template RED tests**

Add literal assertions for 44-column payment order, `Payments!A:AR` repository ranges, legacy 30-column expansion, blank-header-only writes, default/custom rendering, unsupported and missing placeholders, preview values, length rejection, and generated payment rows with blank LINE transport state.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/sheets/migration.test.ts src/lib/plans/schedule.test.ts src/lib/line/message-template.test.ts`

Expected: missing appended fields/template exports and old `A:AD` ranges fail for named behaviors.

- [ ] **Step 3: Implement schema and template**

Use one generic internal `ensureSheetSchema(title, headers)` migration helper. Call `ensurePaymentSchema()` before every payment read/write. Keep existing `line_message` blank at payment generation so only the sender freezes final text. Validate raw templates before save and rendered output before send.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command. Expected: all focused suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sheets src/lib/line/message-template.ts src/lib/line/message-template.test.ts src/lib/plans
git commit -m "feat: add LINE payment schema and templates"
```

### Task 2: Extend LINE adapter and add exact-payment public QR endpoint

**Files:**
- Modify: `src/lib/line/client.ts`, `src/lib/line/client.test.ts`
- Create: `src/lib/payments/promptpay.ts`, `src/lib/payments/promptpay.test.ts`
- Create: `src/app/api/payments/[publicToken]/promptpay-qr.png/route.ts`, `src/app/api/payments/[publicToken]/promptpay-qr.png/route.test.ts`
- Modify: `src/app/p/[token]/page.tsx`
- Modify: `src/lib/config.ts`, `src/lib/config.test.ts`, `.env.example`

**Interfaces:**
- `sendLinePushMessage({ channelAccessToken, to, messages, retryKey, fetchFn })` returns `{ accepted, retryable, requestId, errorCode }`, treats `2xx` and `409` plus `x-line-accepted-request-id` as accepted, and never returns remote body text.
- `sendLineReplyMessage(...)`, `getLineMessageContent(...)`, and existing `getLineProfile(...)` share authorization/error sanitization. Content download enforces timeout, 10 MiB maximum, and `image/jpeg`/`image/png` magic bytes.
- `buildPaymentPromptPayPayload(payment, config)` parses canonical satang and calls `buildPromptPayPayload`.
- Public QR route returns 404 for unknown/invalid payment, otherwise 720px high-contrast PNG plus `public, max-age=300, stale-while-revalidate=3600`.
- `lineMessagingEnabled()` and `lineChatPaymentsEnabled()` default false.

- [ ] **Step 1: Write adapter/QR/config RED tests**

Cover push headers/body, stable retry header, `2xx`, accepted `409`, retryable `429`/`5xx`/network failures, sanitized permanent failure, reply payload, content endpoint/auth/timeout/size/magic checks, false-by-default flags, unknown-token 404, PNG headers, and exact payload equality between route helper and website helper.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/line/client.test.ts src/lib/payments/promptpay.test.ts src/app/api/payments/'[publicToken]'/promptpay-qr.png/route.test.ts src/lib/config.test.ts`

Expected: missing adapter methods/route/helper/flags fail.

- [ ] **Step 3: Implement adapter and shared PromptPay boundary**

Keep fetch injected. Use `AbortSignal.timeout(10_000)` when no caller signal exists; reject oversized `content-length` before buffering and oversized bytes afterward. Refactor payment page to call shared payload helper while retaining current UI and website upload path.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command plus `npm test -- src/app/p src/lib/promptpay`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/line src/lib/payments/promptpay* src/app/api/payments src/app/p src/lib/config* .env.example
git commit -m "feat: add LINE API adapter and payment QR endpoint"
```

### Task 3: Build idempotent outbound delivery and sequential daily cron

**Files:**
- Create: `src/lib/line/due-payments.ts`, `src/lib/line/due-payments.test.ts`
- Modify: `src/lib/sheets/payments.ts`, `src/lib/sheets/payments.test.ts` (create if absent)
- Modify: `src/app/api/cron/generate/route.ts`
- Create: `src/app/api/cron/generate/route.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- `sendDueLinePaymentRequests({ baseUrl, today?, paymentIds? }, dependencies?)` returns `{ accepted, alreadyAccepted, skippedMissingUserId, failed, disabled }`.
- Candidate requires `PENDING`, valid payment URL/token, `due_date <=` Bangkok date, nonterminal state, and no prior `ACCEPTED`.
- Before fetch, sender persists UUID `line_retry_key`, rendered `line_message`, `SENDING`, and attempt timestamp. Retries (maximum three in one run) and later runs reuse key/text. `429`, `5xx`, and network ambiguity become `FAILED_RETRYABLE`; 24-hour-old ambiguity becomes `REVIEW` without a new request.
- Accepted push persists request ID, accepted/requested timestamps, `line_slip_expected=TRUE`, and `AWAITING`; missing user persists `SKIPPED_MISSING_USER_ID` and continues.
- Cron authenticates before work and awaits generation, manual reconciliation, then LINE delivery in that exact order.

- [ ] **Step 1: Write outbound/cron RED tests**

Cover catch-up date, future/terminal skips, valid linked recipient only, missing/invalid ID isolation, text date/amount/URL, HTTPS image URL, default/custom template, frozen retry text after setting edit, stable key across timeout and later retry, accepted `409`, retry exhaustion, one-client failure isolation, repeated accepted run, disabled flags, unauthorized cron, and strict call order.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/line/due-payments.test.ts src/app/api/cron/generate/route.test.ts`

Expected: imports missing and old parallel cron behavior fails.

- [ ] **Step 3: Implement outbound service and cron**

Build text/image messages from persisted payment/client state. Persist safe audit actions `LINE_DUE_MESSAGE_ACCEPTED`, `LINE_DUE_MESSAGE_FAILED`, `LINE_DUE_MESSAGE_SKIPPED`, and `LINE_PAYMENT_QR_SENT`; metadata contains IDs/status/request code only. Set `vercel.json` cron to `5 2 * * *`.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command plus `npm test -- src/lib/payments/generate.test.ts src/lib/payments/manual-confirmation.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/line/due-payments* src/lib/sheets/payments* src/app/api/cron/generate vercel.json
git commit -m "feat: send idempotent LINE due payments"
```

### Task 4: Extract one transport-independent slip processor

**Files:**
- Create: `src/lib/slip/process.ts`, `src/lib/slip/process.test.ts`
- Create: `src/lib/line/payment-match.ts`, `src/lib/line/payment-match.test.ts`
- Modify: `src/app/api/payment/[token]/submit/route.ts`, `src/app/api/payment/[token]/submit/route.test.ts` (create if absent)
- Modify: `src/lib/payments/transition.ts`, `src/lib/payments/transition.test.ts`

**Interfaces:**
- `processSlipImage({ bytes, declaredType, expectedPayment, source, analysis? }, dependencies?)` accepts source `{ type: "LINE"; lineUserId; lineMessageId } | { type: "WEB_UPLOAD" }` and returns `{ decision, duplicate, analysis, evaluation, payment }`.
- Processor performs analysis, same-payment image/ref idempotency, cross-payment image/ref flags, evaluation, exception-only storage, payment/schedule transition, and structured field persistence.
- LINE source verifies client association supplied by eligible selection and clears `line_slip_expected` for `AUTO_RECORDED`/`MANUAL_CONFIRMED`; website route preserves current response/status semantics.
- `resolveLinePaymentCandidate(payments, analysis)` uses one candidate directly, then unique exact amount, then closest plausible due date; unresolved ties return `null` for review rather than guessing.

- [ ] **Step 1: Write processor/matching RED tests**

Cover one candidate, unique amount/date among multiple, ambiguous tie, strong match auto-record, wrong amount/receiver flag, QR/ref uncertainty review, duplicate same-payment image/ref idempotency, cross-payment ref flag, exception storage only, LINE identity mismatch rejection, and website route delegation.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/slip/process.test.ts src/lib/line/payment-match.test.ts src/app/api/payment/'[token]'/submit/route.test.ts src/lib/payments/transition.test.ts`

Expected: shared processor/resolver missing and website route still owns orchestration.

- [ ] **Step 3: Implement shared processor and refactor website route**

Inject analysis, repositories, evaluator, transition, and storage boundaries. Preserve raw bytes only until analysis/storage decision completes. Add `LINE_WEBHOOK` transition source without weakening terminal transitions.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command plus `npm test -- src/lib/slip src/lib/payments`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slip/process* src/lib/line/payment-match* src/app/api/payment src/lib/payments/transition*
git commit -m "refactor: share slip payment processing"
```

### Task 5: Process eligible LINE images and send durable replies

**Files:**
- Create: `src/lib/line/slip-payments.ts`, `src/lib/line/slip-payments.test.ts`
- Modify: `src/app/api/line/webhook/route.ts`, `src/app/api/line/webhook/route.test.ts`
- Modify: `src/lib/line/client.ts`, `src/lib/line/client.test.ts`

**Interfaces:**
- Webhook parser accepts valid direct-user image events `{ webhookEventId, replyToken, lineUserId, messageId }` alongside existing LINK text events.
- `processLineSlipEvent(event, dependencies?)` resolves linked client and eligible awaiting payments before content download; no client/payment means ignored without OCR or reply.
- Eligible flow persists `DOWNLOADING`, then `ANALYZING`; download errors become `FAILED_TRANSIENT`. It analyzes once, resolves candidate, calls shared processor, persists `AUTO_RECORDED`/`REVIEW`/`FLAGGED`, then replies.
- Duplicate message/image/same-payment ref returns existing logical result without another transition/audit. Cross-payment ref stays flagged.
- Reply text matches issue success/review/mismatch copy; reply-token failure may fall back only through centralized adapter policy and always persists `line_reply_status` after payment result.

- [ ] **Step 1: Write webhook/intake RED tests**

Cover signed eligible image, invalid signature, zero events 200, unlinked/no-awaiting/group/room images ignored before credential/content/OCR work, correct content auth, message redelivery, image/ref duplicates, transient download, multiple-candidate review, success/review/mismatch replies, and reply failure preserving recorded payment.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/line/slip-payments.test.ts src/app/api/line/webhook/route.test.ts src/lib/line/client.test.ts`

Expected: image events ignored by current route and processor missing.

- [ ] **Step 3: Implement intake and reply isolation**

Keep raw-body signature verification unchanged. Resolve access token only after eligibility. Process webhook events sequentially and catch each event independently so one failure never changes signed response `200`. Audit safe LINE slip/reply events without raw OCR or user ID.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command plus `npm test -- src/lib/line`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/line src/app/api/line/webhook
git commit -m "feat: process LINE payment slips"
```

### Task 6: Add protected settings/payment controls and remove Apps Script scheduler

**Files:**
- Create: `src/components/admin/line-due-template-form.tsx`, `src/components/admin/line-due-template-form.test.ts`
- Create: `src/components/admin/line-payment-actions.tsx`, `src/components/admin/line-payment-actions.test.ts`
- Modify: `src/app/admin/(protected)/settings/page.tsx`, `src/app/admin/(protected)/settings/line-actions.ts`, `src/app/admin/(protected)/settings/line-actions.test.ts`
- Modify: `src/app/admin/(protected)/payments/page.tsx`, `src/app/admin/(protected)/payments/[paymentId]/page.tsx`, `src/app/admin/(protected)/actions.ts`, `src/app/admin/(protected)/actions.test.ts`
- Modify: `apps-script/Code.gs`, `src/apps-script/Code.test.ts`

**Interfaces:**
- Protected actions preview, save, and restore template; invalid saves retain last valid setting. Successful save/reset audits only setting key/action.
- Settings displays messaging/chat-payment enabled state and client component supports edit, server preview, save, reset.
- Payment actions call outbound service for one payment and can set `line_slip_expected=FALSE`; accepted requests cannot be blindly duplicated.
- Payment list/detail show message status, slip processing status, last attempt, linked/missing state, and fallback page action.
- Apps Script keeps manual `Generate links due today`, removes time-trigger installation, and exposes `Remove legacy daily payment scheduler` that deletes only `generateDuePaymentLinks` triggers.

- [ ] **Step 1: Write UI/action/Apps Script RED tests**

Cover protected preview/sample output, valid save, invalid save preservation, reset default, audit metadata, feature-state labels, payment send/stop actions, accepted resend refusal, displayed LINE statuses, menu retention/removal behavior, and deletion of only legacy payment triggers.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/components/admin/line-due-template-form.test.ts src/components/admin/line-payment-actions.test.ts src/app/admin/'(protected)'/settings/line-actions.test.ts src/app/admin/'(protected)'/actions.test.ts src/apps-script/Code.test.ts`

Expected: missing components/actions and legacy scheduler menu fail.

- [ ] **Step 3: Implement protected controls**

Use existing cards, fields, buttons, and server actions. Pass only operational template/flag values to client JS; never pass credentials. Revalidate settings/payment/dashboard paths after mutations.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command plus `npm test -- src/components/admin`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin src/app/admin/'(protected)' apps-script/Code.gs src/apps-script/Code.test.ts
git commit -m "feat: add LINE payment admin controls"
```

### Task 7: Document migration/rollout and close acceptance coverage

**Files:**
- Modify: `README.md`, `.env.example`
- Modify: targeted test files from Tasks 1-6 only when an acceptance mutation lacks coverage

- [ ] **Step 1: Run issue acceptance mutation review**

For each issue #4 checkbox, name implementation path and a test that would fail if behavior were removed. Add narrow failing tests for uncovered scheduler catch-up, QR parity, text freeze, zero-event 200, normal-image ignore, duplicate keys, reply rollback isolation, header alignment, or template semantics.

- [ ] **Step 2: Verify added regressions RED, then implement minimal gaps**

Run each changed focused suite before and after its fix. Expected: each new test fails for missing behavior, then passes after minimal implementation.

- [ ] **Step 3: Update deployment and migration docs**

Document daily `02:05 UTC` Vercel schedule, removal of existing Apps Script `generateDuePaymentLinks` trigger, both disabled-by-default flags, template setting/default/reset, non-destructive payment-column migration, LINE-first flow, website fallback, safe staged rollout, and explicit user-authorized low-value production test.

- [ ] **Step 4: Run fresh full verification**

Run in order:

```bash
npm run lint
npm test
npm run build
```

Expected: lint has zero errors, all Vitest files/tests pass, production build exits 0. Existing `<img>` lint warnings may remain only on unchanged website/slip preview surfaces.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example src apps-script/Code.gs vercel.json
git commit -m "docs: document LINE payment automation rollout"
```

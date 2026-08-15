# LINE Connect Due-Payment Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Immediately deliver an existing due or overdue initial payment request after successful LIFF connection, without changing or risking that connection.

**Architecture:** Preserve `createLineConnectionService` as the atomic identity-link boundary; make its successful result include canonical client ID. Add a post-connection service that reads current Payment rows, selects only eligible initial payments for that client, and delegates their exact IDs to the existing due-payment sender. The LIFF route awaits this service inside a nested failure boundary, then returns its original connection response unchanged.

**Tech Stack:** Next.js route handlers, strict TypeScript, Vitest, Google Sheets repository abstractions, existing LINE push sender.

## Global Constraints

- Do not generate, rotate, or expose payment tokens, payment URLs, QR payloads, ID tokens, connection tokens, LINE access tokens, or message text.
- Successful LINE link claims stay persisted even if selection, templates, recipients, persistence, or LINE transport fails.
- Reuse `sendDueLinePaymentRequests` for rendering, frozen retries, QR attachment, accepted-send deduplication, audit reconciliation, and retry/review behavior.
- Post-connection eligibility is client-scoped: `PENDING`, due on or before Bangkok today, one-time or installment 1, valid existing public token/HTTPS URL/positive amount, and not accepted or review.
- Sort multi-payment delivery by `created_at`, then `payment_id`; sender remains sequential.
- Normal cron behavior and API response body/status mappings remain unchanged.
- Tests use controlled fixtures and mocks only at Google Sheets/LINE/network boundaries; no live services.

---

### Task 1: Return canonical client ID from successful connection claims

**Files:**
- Modify: `src/lib/line/connection.ts:19-123`
- Test: `src/lib/line/connection.test.ts`

**Interfaces:**
- Produces `LineConnectionResult` as either `{ status: "LINKED" | "ALREADY_LINKED"; clientId: string }` or `{ status: "INVALID_OR_EXPIRED" | "CLIENT_INACTIVE" | "CONFLICT" }`.
- The route consumes `result.status` and only reads `clientId` after narrowing to success states.

- [ ] **Step 1: Write failing tests for success and non-success result shapes**

```ts
await expect(service.claim(validClaim)).resolves.toEqual({ status: "LINKED", clientId: "client_1" });
await expect(service.claim(alreadyLinkedClaim)).resolves.toEqual({ status: "ALREADY_LINKED", clientId: "client_1" });
await expect(service.claim(expiredClaim)).resolves.toEqual({ status: "INVALID_OR_EXPIRED" });
```

The tests catch a success result missing the target ID or a failure result leaking it.

- [ ] **Step 2: Run only connection-domain tests and verify RED**

Run: `npx vitest run src/lib/line/connection.test.ts`

Expected: FAIL because existing service returns status strings.

- [ ] **Step 3: Implement minimal discriminated result changes**

```ts
if (target.line_user_id === lineUserId) return { status: "ALREADY_LINKED", clientId: target.client_id };
// successful atomic claim
return { status: "LINKED", clientId: target.client_id };
```

Return `{ status: ... }` for all invalid/inactive/conflict paths. Do not alter atomic Sheets claim, target lookup, conflict marking, or connection audits.

- [ ] **Step 4: Re-run connection-domain tests and verify GREEN**

Run: `npx vitest run src/lib/line/connection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/line/connection.ts src/lib/line/connection.test.ts
git commit -m "feat: return client id from line connection"
```

### Task 2: Add client-scoped post-connection delivery orchestrator

**Files:**
- Create: `src/lib/line/post-connection-delivery.ts`
- Create: `src/lib/line/post-connection-delivery.test.ts`

**Interfaces:**
- Consumes `PaymentRecord`, `appendAudit`, `listPayments`, `runtimeConfig`, and `sendDueLinePaymentRequests`.
- Produces `selectDueInitialPaymentsAfterLineConnection(payments, { clientId, today }): string[]` and `deliverDueInitialPaymentsAfterLineConnection({ clientId, today? }, dependencies?): Promise<PostConnectionDeliveryResult>`.
- Sender receives `{ baseUrl, today, paymentIds }`, where `paymentIds` is sorted, eligible IDs only.

- [ ] **Step 1: Write failing pure-selection tests**

```ts
expect(selectDueInitialPaymentsAfterLineConnection(rows, {
  clientId: "client_1",
  today: "2026-08-15",
})).toEqual(["older-one-time", "same-time-a", "same-time-b", "initial-installment"]);
```

Include due-today and overdue one-time/installment-1 rows. Exclude another client, future due date, later installment, non-`PENDING` status, `ACCEPTED`/`REVIEW` LINE states, blank/invalid token, non-HTTPS URL, and non-positive/invalid amount. Give equal creation timestamps distinct IDs to prove deterministic tie ordering.

- [ ] **Step 2: Run only orchestrator tests and verify RED**

Run: `npx vitest run src/lib/line/post-connection-delivery.test.ts`

Expected: FAIL because module/export does not exist.

- [ ] **Step 3: Implement minimal selection and delegation**

Use the same validation rules as the existing due sender. Filter one-time rows by `payment_type === "ONE_TIME"`; filter installment rows by `installment_number === "1"`; sort `created_at`, then `payment_id`. Runtime dependencies obtain the configured public base URL and pass exact selected IDs to the existing sender. Empty selection returns a no-op result without invoking it.

- [ ] **Step 4: Add failing orchestration/failure-isolation tests**

```ts
await expect(deliverDueInitialPaymentsAfterLineConnection({ clientId: "client_1", today: "2026-08-15" }, deps))
  .resolves.toMatchObject({ paymentIds: ["pay_due"] });
expect(deps.sendDueLinePaymentRequests).toHaveBeenCalledWith({
  baseUrl: "https://pay.example",
  today: "2026-08-15",
  paymentIds: ["pay_due"],
});
```

Make `listPayments` reject. Assert a best-effort audit has blank payment ID, the connected client ID, a stable failure action/reason code only, and contains no secret/payment URL/message data. The service returns a safe selection-failure result so cron can later retry.

- [ ] **Step 5: Implement selection-failure audit and verify GREEN**

Use one client-level action such as `LINE_POST_CONNECT_DELIVERY_SELECTION_FAILED`, source `LINE_CONNECT`, and metadata `{"clientId":"...","reasonCode":"PAYMENT_SELECTION_FAILED"}`. Swallow only the audit failure after selection failure. Do not catch or convert sender results; sender retains per-payment delivery state.

Run: `npx vitest run src/lib/line/post-connection-delivery.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/line/post-connection-delivery.ts src/lib/line/post-connection-delivery.test.ts
git commit -m "feat: deliver due initial payments after line connect"
```

### Task 3: Trigger delivery after successful LIFF claims without changing responses

**Files:**
- Modify: `src/app/api/line/connect/route.ts:1-63`
- Test: `src/app/api/line/connect/route.test.ts`

**Interfaces:**
- Consumes discriminated `LineConnectionResult` and `deliverDueInitialPaymentsAfterLineConnection`.
- Successful `{ status: "LINKED" }` maps to existing `{ status: "success" }`; successful `{ status: "ALREADY_LINKED" }` maps to existing `{ status: "already_used" }`.

- [ ] **Step 1: Write failing successful-claim route tests**

```ts
mocks.claim.mockResolvedValue({ status: "LINKED", clientId: "client_1" });
await expect(POST(request({ idToken, connectionToken }))).resolves.toMatchObject({ status: 200 });
expect(mocks.deliverAfterConnection).toHaveBeenCalledWith({ clientId: "client_1" });
```

Add an `ALREADY_LINKED` recovery case, and make delivery reject in another test. Both must preserve the existing 200 response body and contain none of the ID token, connection token, client ID, payment ID, URL, QR data, or delivery error.

- [ ] **Step 2: Run only LIFF route tests and verify RED**

Run: `npx vitest run src/app/api/line/connect/route.test.ts`

Expected: FAIL because no delivery service is called and current string result mapping no longer matches fixture.

- [ ] **Step 3: Implement nested post-claim failure boundary**

```ts
if (result.status === "LINKED" || result.status === "ALREADY_LINKED") {
  try { await deliverDueInitialPaymentsAfterLineConnection({ clientId: result.clientId }); } catch {}
  return json(result.status === "LINKED" ? "success" : "already_used", 200);
}
```

Keep identity verification and claim failures in the outer boundary. Do not expose delivery result. Do not invoke delivery for invalid/expired, inactive, or conflict outcomes.

- [ ] **Step 4: Re-run route tests and verify GREEN**

Run: `npx vitest run src/app/api/line/connect/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Run focused integration regression tests**

Run: `npx vitest run src/lib/line/connection.test.ts src/lib/line/post-connection-delivery.test.ts src/lib/line/due-payments.test.ts src/app/api/line/connect/route.test.ts src/app/api/cron/generate/route.test.ts`

Expected: PASS; confirms connection, selection, reuse of sender QR/retry behavior, and cron fallback entry point.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/line/connect/route.ts src/app/api/line/connect/route.test.ts
git commit -m "feat: send due payment after liff connection"
```

### Task 4: Full verification and handoff evidence

**Files:**
- Modify only if prior test/lint/build failures identify a scoped defect.

- [ ] **Step 1: Inspect committed diff and plan coverage**

Run: `git log --oneline --decorate -4 && git diff 394da72..HEAD --check && git status --short`

Confirm: plan tasks cover successful and idempotent claims, client-scoped due/overdue eligibility, valid canonical payment artifacts, no-op/failure isolation, QR/retry dedup reuse, cron fallback, safe audits, and response privacy.

- [ ] **Step 2: Run required checks**

Run: `npm run lint && npm test && npm run build`

Expected: all exit 0.

- [ ] **Step 3: Inspect final status**

Run: `git status --short --branch && git log --oneline -4`

Expected: feature commits present; no unintended tracked changes.

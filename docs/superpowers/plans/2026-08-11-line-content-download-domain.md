# LINE Content Download Domain Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LINE payment-slip images download from LINE's documented binary-content API so QR and OCR validation can run.

**Architecture:** Keep the existing authenticated download, timeout, size limit, and image-sniffing behavior. Change only the content host from the normal Messaging API host to LINE's dedicated data host, protected by a client-boundary regression test.

**Tech Stack:** TypeScript, Vitest, Next.js, LINE Messaging API.

## Global Constraints

- Never expose the LINE channel access token or upstream response body.
- Preserve the 10-second timeout and 10 MiB limit.
- Deploy the verified fix to production from `main`.

---

### Task 1: Correct the LINE content endpoint

**Files:**
- Modify: `src/lib/line/client.test.ts`
- Modify: `src/lib/line/client.ts`

**Interfaces:**
- Consumes: `getLineMessageContent({ channelAccessToken, messageId, fetchFn, signal? })`
- Produces: the same return type, using `https://api-data.line.me/v2/bot/message/{messageId}/content`

- [x] **Step 1: Write the failing regression test**

Update the success and caller-signal expectations to require the literal `api-data.line.me` content URL.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/lib/line/client.test.ts`

Expected: the two URL assertions fail because production still calls `api.line.me`.

- [x] **Step 3: Write the minimal implementation**

Change only the URL passed by `getLineMessageContent` to the documented `api-data.line.me` host.

- [x] **Step 4: Run focused and full verification**

Run: `npx vitest run src/lib/line/client.test.ts`

Run: `npm run lint && npm test && npm run build`

Expected: all commands pass.

- [x] **Step 5: Publish and verify production**

Commit the source, regression test, and plan; update GitHub `main`; wait for Vercel production to become ready; then confirm the deployed source/health endpoint.

### Task 2: Let a new slip retry a transient failure

**Files:**
- Modify: `src/lib/line/slip-payments.test.ts`
- Modify: `src/lib/line/slip-payments.ts`

**Interfaces:**
- Consumes: a pending payment with `line_slip_expected === "TRUE"` and `line_slip_processing_status === "FAILED_TRANSIENT"`
- Produces: a normal new-slip processing attempt beginning at `DOWNLOADING`

- [x] **Step 1: Write the failing recovery test**

Add a test proving that a different image message retries a `FAILED_TRANSIENT` payment and reaches normal processing, while in-flight `DOWNLOADING` and `ANALYZING` payments remain ignored.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/lib/line/slip-payments.test.ts`

Expected: the transient-recovery test returns `ignored` before any content work.

- [x] **Step 3: Write the minimal implementation**

Allow `FAILED_TRANSIENT` rows into the eligible set and atomically claim either `AWAITING` or `FAILED_TRANSIENT` as `DOWNLOADING`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run src/lib/line/slip-payments.test.ts`

Expected: all slip state-machine tests pass.

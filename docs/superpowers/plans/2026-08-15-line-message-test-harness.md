# LINE Message Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated LIFF-linked test client that sends one-time, initial-installment, and later-installment reminder messages through the real LINE push endpoint using safe non-payable test data.

**Architecture:** Keep one versioned test-client profile in the Settings sheet, including its isolated LINE-link state. Reuse existing token encryption, LIFF page, LINE ID-token verification, template renderers, schedule math, reminder eligibility, terms-image selection, and LINE push client; construct payment records only in memory. Public test URL and QR routes contain no workbook or payment data.

**Tech Stack:** Next.js 15 App Router, React 19, strict TypeScript, Zod, Google Sheets API, LINE LIFF/Messaging API, `qrcode`, `sharp`, Vitest, Testing Library.

## Global Constraints

- Use one dedicated test recipient stored outside Clients, Schedules, and Payments.
- Use the existing LIFF application and unchanged `{ idToken, connectionToken }` request shape.
- A LINE user ID cannot belong to both a real client and the test profile.
- Supported scenarios are one-time initial, installment initial, and installment numbers `2..count` at exactly T-7, T-3, T-1, due date, or T+1.
- Use coach-entered test-client name, package, total price, payment type, installment count, interval, and first due date.
- Test messages use current saved production templates and first-payment terms image rules.
- Test URL and QR are public but non-payable, data-free, and visibly marked `TEST`.
- No test send may write client, schedule, payment, slip, dashboard, or reminder-delivery state.
- Audit metadata must exclude message text, full LINE IDs, connection tokens, client values, URLs, and QR data.
- Unit tests mock LINE and Google boundaries; no test calls a live vendor.
- Add no dependency: `qrcode` and `sharp` already exist.

---

### Task 1: Share LINE Reservation Primitives

**Files:**
- Create: `src/lib/line/connection-reservation.ts`
- Create: `src/lib/line/connection-reservation.test.ts`
- Modify: `src/lib/sheets/clients.ts`
- Test: `src/lib/sheets/clients.test.ts`

**Interfaces:**
- Produces: `lineReservationName(kind: "code" | "token" | "user", value: string): string`.
- Produces: `isLineReservationConflict(error: unknown): boolean`.
- Existing client repository keeps identical named-range names and conflict behavior.

- [ ] **Step 1: Write failing reservation-helper tests**

```ts
import { describe, expect, it } from "vitest";
import { isLineReservationConflict, lineReservationName } from "./connection-reservation";

describe("LINE connection reservations", () => {
  it("uses one hashed namespace across client and test claims", () => {
    expect(lineReservationName("user", "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .toMatch(/^line_link_user_[a-f0-9]{64}$/);
    expect(lineReservationName("token", "a".repeat(64)))
      .toBe(lineReservationName("token", "a".repeat(64)));
  });

  it("recognizes only Sheets duplicate named-range conflicts", () => {
    expect(isLineReservationConflict(Object.assign(new Error("Named range already exists"), { response: { status: 400 } }))).toBe(true);
    expect(isLineReservationConflict(new Error("network failure"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify missing module failure**

Run: `npx vitest run src/lib/line/connection-reservation.test.ts`

Expected: FAIL because `connection-reservation.ts` does not exist.

- [ ] **Step 3: Extract reservation helpers**

```ts
import { createHash } from "node:crypto";

export function lineReservationName(kind: "code" | "token" | "user", value: string): string {
  return `line_link_${kind}_${createHash("sha256").update(value).digest("hex")}`;
}

export function isLineReservationConflict(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { status?: unknown } }).response?.status
    : undefined;
  return status === 400 && error instanceof Error && /named range.*already exists/i.test(error.message);
}
```

Remove private copies from `src/lib/sheets/clients.ts`; import these functions. Keep `lineStateReservationName()` client-specific.

- [ ] **Step 4: Run helper and client repository tests**

Run: `npx vitest run src/lib/line/connection-reservation.test.ts src/lib/sheets/clients.test.ts`

Expected: PASS; current atomic client claims remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/line/connection-reservation.ts src/lib/line/connection-reservation.test.ts src/lib/sheets/clients.ts src/lib/sheets/clients.test.ts
git commit -m "refactor: share LINE connection reservations"
```

---

### Task 2: Define Test Profile and Synthetic Scenarios

**Files:**
- Create: `src/lib/line/message-test-profile.ts`
- Create: `src/lib/line/message-test-profile.test.ts`

**Interfaces:**
- Consumes: `buildInstallmentPlan`, `buildPaymentForSchedule`, `reminderDate`, and `eligibleReminderSlots`.
- Produces: `LINE_MESSAGE_TEST_PROFILE_SETTING_KEY` and `LINE_MESSAGE_TEST_SUBJECT_ID`.
- Produces: `LineMessageTestProfile`, redacted `LineMessageTestAdminView`, `LineMessageTestDetails`, `LineMessageTestScenario`, and `LineMessageTestFixture`.
- Produces: `createDefaultLineMessageTestProfile(today)`, `parseLineMessageTestProfile(value)`, `parseLineMessageTestDetails(value)`, `mergeLineMessageTestDetails(profile, details, now)`, `toLineMessageTestAdminView(profile)`, and `buildLineMessageTestFixture(input)`.

- [ ] **Step 1: Write failing domain tests**

Cover these exact cases:

```ts
it.each([
  [{ paymentType: "ONE_TIME", stage: "INITIAL" }, "ONE_TIME"],
  [{ paymentType: "INSTALLMENTS", stage: "INITIAL" }, "INSTALLMENTS"],
  [{ paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 2, reminderSlot: "T_MINUS_3_DAYS" }, "INSTALLMENTS"],
])("builds supported scenario %j", (scenario, paymentType) => {
  const fixture = buildLineMessageTestFixture({ profile: installmentProfile(), scenario, baseUrl: "https://pay.example", now: "2026-08-15T03:00:00.000Z" });
  expect(fixture.payment.payment_type).toBe(paymentType);
  expect(fixture.payment.payment_url).toBe("https://pay.example/line/message-test");
});

it("uses production allocation, due-date math, and simulated reminder day", () => {
  const fixture = buildLineMessageTestFixture({
    profile: installmentProfile({ totalPriceThb: "1000.01", firstDueDate: "2026-01-31" }),
    scenario: { paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 3, reminderSlot: "T_MINUS_1_DAY" },
    baseUrl: "https://pay.example",
    now: "2026-08-15T03:00:00.000Z",
  });
  expect(fixture.payment.amount_thb).toBe("333.35");
  expect(fixture.payment.due_date).toBe("2026-03-31");
  expect(fixture.simulatedToday).toBe("2026-03-30");
  expect(eligibleReminderSlots({ dueDate: fixture.payment.due_date, createdAt: fixture.payment.created_at, today: fixture.simulatedToday!, log: emptyReminderDeliveryLog() })).toContain("T_MINUS_1_DAY");
});
```

Also assert rejection of later one-time, installment #1 as later, installment number above count, missing reminder slot, invalid THB, invalid date, count below two, and interval below one. Assert saving editable details preserves every `line*` field.
Assert `toLineMessageTestAdminView()` omits full user ID, token hash, encrypted token, and token expiry while retaining display name, picture, status, linked time, and safe error.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run src/lib/line/message-test-profile.test.ts`

Expected: FAIL because profile module does not exist.

- [ ] **Step 3: Implement versioned profile parsing**

```ts
export const LINE_MESSAGE_TEST_PROFILE_SETTING_KEY = "line_message_test_profile";
export const LINE_MESSAGE_TEST_SUBJECT_ID = "line-message-test-profile";

export type LineMessageTestScenario =
  | { paymentType: "ONE_TIME"; stage: "INITIAL" }
  | { paymentType: "INSTALLMENTS"; stage: "INITIAL" }
  | { paymentType: "INSTALLMENTS"; stage: "LATER"; installmentNumber: number; reminderSlot: ReminderSlot };
```

Use Zod strict objects. Normalize one-time details to `installmentCount: 1` and `intervalMonths: 0`. Parse THB with `parseSatang()` and reject non-positive or unsafe values. Use `buildInstallmentPlan()` for all amounts and due dates.

- [ ] **Step 4: Implement in-memory fixture construction**

Build synthetic schedule rows with constant IDs beginning `line_test_`; call `buildPaymentForSchedule()`; then replace `payment_url` with `${baseUrl}/line/message-test`, clear `public_token`, and set `rowNumber: 0` only for compatibility with renderer types. For later scenarios, set `created_at` to T-7 and derive `simulatedToday = reminderDate(dueDate, slot)`. Assert `eligibleReminderSlots()` returns selected slot before returning fixture.

- [ ] **Step 5: Run domain tests**

Run: `npx vitest run src/lib/line/message-test-profile.test.ts src/lib/plans/schedule.test.ts src/lib/line/reminder-delivery.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/line/message-test-profile.ts src/lib/line/message-test-profile.test.ts
git commit -m "feat: model LINE message test scenarios"
```

---

### Task 3: Persist and Atomically Claim Test Recipient

**Files:**
- Create: `src/lib/sheets/line-message-test-profile.ts`
- Create: `src/lib/sheets/line-message-test-profile.test.ts`
- Modify: `src/lib/sheets/settings.ts`
- Test: `src/lib/sheets/settings.test.ts`

**Interfaces:**
- Consumes: Settings row `{ rowNumber, key, value }`, shared `lineReservationName()`, and `LineLinkClaimResult`.
- Produces: `resolveLineMessageTestProfile(settings)`, `getLineMessageTestProfile()`, `saveLineMessageTestProfile(profile)`, `updateLineMessageTestProfileIfUnchanged(input)`, `claimLineMessageTestConnection(input)`, and `disconnectLineMessageTestConnection(input)`.

- [ ] **Step 1: Write failing parser/persistence tests**

Add Settings tests proving missing key returns the supplied default and invalid JSON returns `{ kind: "INVALID" }`. Add repository tests mocking Sheets:

```ts
await expect(claimLineMessageTestConnection({ expectedProfile, profile: linked, tokenHash, lineUserId })).resolves.toBe("CLAIMED");
expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { requests: expect.arrayContaining([
  { addNamedRange: { namedRange: expect.objectContaining({ name: lineReservationName("token", tokenHash) }) } },
  { addNamedRange: { namedRange: expect.objectContaining({ name: lineReservationName("user", lineUserId) }) } },
]) } }));
```

Test duplicate named-range outcomes: same token/user/profile -> `ALREADY_LINKED`; existing client user reservation -> `CONFLICT`; stale state -> `STALE`. Test disconnect deletes only test-profile user reservation and clears test connection fields.

- [ ] **Step 2: Run tests and verify missing exports**

Run: `npx vitest run src/lib/sheets/line-message-test-profile.test.ts src/lib/sheets/settings.test.ts`

Expected: FAIL because test-profile persistence functions do not exist.

- [ ] **Step 3: Implement Settings resolution and normal writes**

`resolveLineMessageTestProfile()` parses only `line_message_test_profile`. `saveLineMessageTestProfile()` validates then uses `upsertOperationalSetting()`. Never accept raw JSON from a client action without parsing.

- [ ] **Step 4: Implement atomic claim/update/release**

Use the Settings row's B cell as reservation range. Compute a test-state named range from SHA-256 of the full expected serialized profile. One `spreadsheets.batchUpdate` must add state, global token, and global user reservations before updating B cell. On duplicate range, reread profile and global metadata to classify `ALREADY_LINKED`, `CONFLICT`, or `STALE`. Disconnect deletes matching `line_link_user_*` range in the same batch that clears profile link fields.

- [ ] **Step 5: Run persistence tests**

Run: `npx vitest run src/lib/sheets/line-message-test-profile.test.ts src/lib/sheets/settings.test.ts src/lib/sheets/clients.test.ts`

Expected: PASS; test and client claims share global token/user namespaces.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sheets/line-message-test-profile.ts src/lib/sheets/line-message-test-profile.test.ts src/lib/sheets/settings.ts src/lib/sheets/settings.test.ts
git commit -m "feat: persist LINE test recipient safely"
```

---

### Task 4: Route Test Tokens Through Existing LIFF Endpoint

**Files:**
- Create: `src/lib/line/message-test-connection.ts`
- Create: `src/lib/line/message-test-connection.test.ts`
- Modify: `src/lib/line/connection.ts`
- Test: `src/lib/line/connection.test.ts`
- Modify: `src/app/api/line/connect/route.ts`
- Test: `src/app/api/line/connect/route.test.ts`

**Interfaces:**
- Produces: `resolveLineConnectionScope({ token, now, clients, testProfile }): "CLIENT" | "TEST" | "INVALID"`.
- Produces: `createLineMessageTestConnectionService(dependencies)` with `issue`, `claim`, and `disconnect` methods.
- Keeps LIFF POST request and response schema unchanged.

- [ ] **Step 1: Write failing scope and service tests**

```ts
expect(resolveLineConnectionScope({ token, now, clients: [activeClient(token)], testProfile: null })).toBe("CLIENT");
expect(resolveLineConnectionScope({ token, now, clients: [], testProfile: activeTestProfile(token) })).toBe("TEST");
expect(resolveLineConnectionScope({ token, now, clients: [activeClient(token)], testProfile: activeTestProfile(token) })).toBe("INVALID");
```

Test `issue()` stores encrypted seven-day token using `LINE_MESSAGE_TEST_SUBJECT_ID`; `claim()` sheet-safes display names, rejects a LINE ID already present on any real client, consumes token atomically, and audits only recipient suffix; `disconnect()` clears test link only.

- [ ] **Step 2: Add failing route tests**

Mock scope resolution. Assert invalid/expired token returns `410` before `verifyLineIdToken`. Assert TEST scope verifies once then calls only test claim. Assert CLIENT scope preserves current client claim mapping. Assert raw ID token, connection token, and full LINE ID never enter response.

- [ ] **Step 3: Run connection tests and verify failure**

Run: `npx vitest run src/lib/line/message-test-connection.test.ts src/lib/line/connection.test.ts src/app/api/line/connect/route.test.ts`

Expected: FAIL on missing scope and test connection service.

- [ ] **Step 4: Implement connection service and pure scope resolver**

```ts
export function resolveLineConnectionScope(input: ResolveLineConnectionScopeInput): "CLIENT" | "TEST" | "INVALID" {
  const tokenHash = hashLineConnectionToken(input.token);
  const clientMatches = input.clients.filter((client) => activeClientToken(client, tokenHash, input.now));
  const testMatches = input.testProfile && activeTestToken(input.testProfile, tokenHash, input.now) ? 1 : 0;
  return clientMatches.length + testMatches !== 1 ? "INVALID" : clientMatches.length === 1 ? "CLIENT" : "TEST";
}
```

Reuse `createLineConnectionTokenFields({ clientId: LINE_MESSAGE_TEST_SUBJECT_ID, now })` and `recoverLineConnectionToken()` with the same subject constant. Never expose recovered token except while building LIFF URL server-side.

- [ ] **Step 5: Update route ordering**

After body/rate-limit validation, read clients and test profile, resolve scope, reject invalid scope, verify LINE ID token once, then call the selected claim service. Map both services through existing `success`, `already_used`, `conflict`, `expired`, and `temporary_failure` responses.

- [ ] **Step 6: Run connection tests**

Run: `npx vitest run src/lib/line/message-test-connection.test.ts src/lib/line/connection.test.ts src/app/api/line/connect/route.test.ts src/components/line/line-connect-client.test.tsx`

Expected: PASS; LIFF client requires no change.

- [ ] **Step 7: Commit**

```bash
git add src/lib/line/message-test-connection.ts src/lib/line/message-test-connection.test.ts src/lib/line/connection.ts src/lib/line/connection.test.ts src/app/api/line/connect/route.ts src/app/api/line/connect/route.test.ts
git commit -m "feat: connect dedicated LINE test account"
```

---

### Task 5: Add Non-Payable Test URL and Marked QR

**Files:**
- Create: `src/app/line/message-test/page.tsx`
- Create: `src/app/line/message-test/page.test.tsx`
- Create: `src/app/api/line/message-test-qr/route.ts`
- Create: `src/app/api/line/message-test-qr/route.test.ts`

**Interfaces:**
- Produces public `/line/message-test` page with no params or data access.
- Produces public `/api/line/message-test-qr` PNG encoding only configured base URL plus `/line/message-test`.

- [ ] **Step 1: Write failing public-page and QR route tests**

```ts
it("renders a data-free non-payment warning", async () => {
  const html = renderToStaticMarkup(await MessageTestPage());
  expect(html).toContain("Test message only");
  expect(html).toContain("No payment is due");
});

it("encodes only the harmless test URL and adds a visible TEST label", async () => {
  const response = await GET();
  expect(QRCode.toBuffer).toHaveBeenCalledWith("https://pay.example/line/message-test", expect.any(Object));
  expect(sharpComposite).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ input: expect.any(Buffer) })]));
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toContain("public");
});
```

Mock `runtimeConfig`, `qrcode`, and `sharp`. Assert workbook repositories are never imported or called.

- [ ] **Step 2: Run route tests and verify failure**

Run: `npx vitest run src/app/line/message-test/page.test.tsx src/app/api/line/message-test-qr/route.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement public warning page**

Return static copy only: heading `Test message only`, text `No payment is due. This page was opened from a LINE delivery test.`, and no forms, tokens, search-param rendering, or repository reads.

- [ ] **Step 4: Implement marked PNG**

Generate QR with `QRCode.toBuffer(testUrl, { width: 640, margin: 2, errorCorrectionLevel: "M" })`. Use `sharp` to composite it onto a 640×736 white PNG plus an SVG label containing `TEST — NOT PAYABLE`. Return `Content-Type: image/png`, `Cache-Control: public, max-age=3600, immutable`, and `X-Content-Type-Options: nosniff`.

- [ ] **Step 5: Run route tests**

Run: `npx vitest run src/app/line/message-test/page.test.tsx src/app/api/line/message-test-qr/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/line/message-test/page.tsx src/app/line/message-test/page.test.tsx src/app/api/line/message-test-qr/route.ts src/app/api/line/message-test-qr/route.test.ts
git commit -m "feat: add safe LINE test QR"
```

---

### Task 6: Render and Send Test Messages Through Production LINE Client

**Files:**
- Create: `src/lib/line/payment-message-images.ts`
- Create: `src/lib/line/payment-message-images.test.ts`
- Modify: `src/lib/line/due-payments.ts`
- Test: `src/lib/line/due-payments.test.ts`
- Create: `src/lib/line/message-test-delivery.ts`
- Create: `src/lib/line/message-test-delivery.test.ts`

**Interfaces:**
- Produces shared `selectLineTermsImage(input, dependencies): Promise<TermsImageSelection>` and `lineImageMessage(url)`.
- Produces `previewLineMessageTest(input, dependencies): Promise<LineMessageTestPreview>`.
- Produces `sendLineMessageTest(input, dependencies): Promise<LineMessageTestSendResult>`.
- `LineMessageTestSendResult.outcome` is `"ACCEPTED" | "FAILED" | "REVIEW"`.

- [ ] **Step 1: Write failing shared-image tests**

Move current terms-image selection cases from due-payment tests into focused helper tests: initial one-time and installment #1 include validated active image; later installment omits it; missing/config-invalid/asset-unavailable produce existing reason codes; frozen production retries retain selected token. Add assertions that refactored due sender emits identical message arrays.

- [ ] **Step 2: Run image and due tests to verify failure**

Run: `npx vitest run src/lib/line/payment-message-images.test.ts src/lib/line/due-payments.test.ts`

Expected: FAIL because shared helper does not exist.

- [ ] **Step 3: Extract image selection without behavior changes**

Move `termsImageUrl`, `TermsImageSelection`, and `selectTermsImage` into `payment-message-images.ts`. Parameterize frozen-token access rather than importing payment persistence. Update due sender to consume helper. Keep all existing due-payment audit behavior.

- [ ] **Step 4: Write failing delivery-service tests**

Build dependency fakes for profile/config reads, terms asset validation, channel token, push, audit, and retry-key generator. Assert:

```ts
expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({
  to: testProfile.lineUserId,
  retryKey: "11111111-1111-4111-8111-111111111111",
  messages: [
    { type: "text", text: expect.stringContaining(testProfile.clientName) },
    { type: "image", originalContentUrl: "https://pay.example/api/line/message-test-qr", previewImageUrl: "https://pay.example/api/line/message-test-qr" },
    expect.objectContaining({ type: "image", originalContentUrl: expect.stringContaining("/api/line/terms-image/") }),
  ],
}));
expect(paymentWriters.writePayment).not.toHaveBeenCalled();
```

Cover one-time initial, installment initial, each later reminder slot, invalid template, disconnected recipient, explicit HTTP failure, retryable 5xx with three attempts/same retry key, network ambiguity -> REVIEW, accepted 409, and audit failure after accepted delivery. Later reminder arrays must omit terms image.

- [ ] **Step 5: Run delivery tests and verify failure**

Run: `npx vitest run src/lib/line/message-test-delivery.test.ts`

Expected: FAIL because delivery service does not exist.

- [ ] **Step 6: Implement preview and delivery service**

`previewLineMessageTest()` builds fixture, resolves message values with `resolveLineDueMessageValues()`, selects current one-time/installment profile or reminder-slot profile, and renders with `renderLineDueMessageProfile()`.

`sendLineMessageTest()` requires linked test profile, creates one retry key, sends text + test QR + optional terms image, and retries only retryable results up to three total attempts using the same key. Any unresolved network error returns REVIEW; explicit exhausted HTTP failure returns FAILED; accepted/409 returns ACCEPTED.

Append exactly one audit with empty payment/client IDs, source `LINE_MESSAGE_TEST`, and metadata:

```ts
JSON.stringify({
  scenario: input.scenario.stage === "INITIAL" ? "INITIAL" : "REMINDER",
  paymentType: input.scenario.paymentType,
  stage: input.scenario.stage,
  ...(input.scenario.stage === "LATER" ? { installmentNumber: input.scenario.installmentNumber, reminderSlot: input.scenario.reminderSlot } : {}),
  lineUserSuffix: profile.lineUserId.slice(-4),
  requestCode: result.requestId || result.errorCode,
  outcome,
})
```

- [ ] **Step 7: Run delivery regression tests**

Run: `npx vitest run src/lib/line/payment-message-images.test.ts src/lib/line/message-test-delivery.test.ts src/lib/line/due-payments.test.ts src/lib/line/message-values.test.ts src/lib/line/reminder-delivery.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/line/payment-message-images.ts src/lib/line/payment-message-images.test.ts src/lib/line/due-payments.ts src/lib/line/due-payments.test.ts src/lib/line/message-test-delivery.ts src/lib/line/message-test-delivery.test.ts
git commit -m "feat: send isolated LINE test messages"
```

---

### Task 7: Add Protected Test-Profile Server Actions

**Files:**
- Create: `src/app/admin/(protected)/settings/line-test-actions.ts`
- Create: `src/app/admin/(protected)/settings/line-test-actions.test.ts`

**Interfaces:**
- Produces: `saveLineMessageTestProfileAction(formData)`.
- Produces: `renewLineMessageTestConnectionAction()` and `disconnectLineMessageTestConnectionAction()`.
- Produces: `previewLineMessageTestAction(formData)` and `sendLineMessageTestAction(formData)`.
- Every action returns a discriminated, client-safe result and calls `requireAdmin()` first.

- [ ] **Step 1: Write failing action tests**

Mock admin auth, profile repo/service, runtime config, template settings, terms state, LINE secret/client, and audit. Assert:

- every action calls `requireAdmin()` before dependencies;
- save accepts only editable details and preserves stored LINE identity/link fields;
- renew returns LIFF URL built from existing `lineLiffId` and recovered test-scoped token;
- disconnect affects only test profile;
- preview never reads channel access token or sends/audits;
- send uses runtime `publicBaseUrl`, returns safe Accepted/Failed/Review status, and never returns full user ID, token, or message URL; and
- all mutating actions revalidate `/admin/settings`.

- [ ] **Step 2: Run action tests and verify failure**

Run: `npx vitest run 'src/app/admin/(protected)/settings/line-test-actions.test.ts'`

Expected: FAIL because actions do not exist.

- [ ] **Step 3: Implement form parsing and actions**

Parse details with `parseLineMessageTestDetails(Object.fromEntries(formData))`. Parse scenario with a strict server-side discriminated union. Never accept submitted `lineUserId`, link status, token hashes, encrypted tokens, timestamps, retry keys, or audit fields.

Use result shapes:

```ts
type LineMessageTestActionResult =
  | { ok: true; profile: LineMessageTestAdminView; preview?: string; outcome?: "ACCEPTED" | "FAILED" | "REVIEW"; requestCode?: string; connectUrl?: string }
  | { ok: false; message: string };
```

Map internal errors to fixed admin copy; do not return raw Google, crypto, LINE, URL, or template error messages. `connectUrl` is the only intentional browser exposure of the raw connection token; return it only from the admin-authorized renew action, never as a separate token field or in audit/log output.

- [ ] **Step 4: Run action tests**

Run: `npx vitest run 'src/app/admin/(protected)/settings/line-test-actions.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/admin/(protected)/settings/line-test-actions.ts' 'src/app/admin/(protected)/settings/line-test-actions.test.ts'
git commit -m "feat: add LINE message test actions"
```

---

### Task 8: Add Settings Test Harness UI

**Files:**
- Create: `src/components/admin/line-message-test-form.tsx`
- Create: `src/components/admin/line-message-test-form.test.tsx`
- Modify: `src/app/admin/(protected)/settings/page.tsx`
- Modify: `src/app/admin/(protected)/settings/page.test.tsx`

**Interfaces:**
- Consumes: redacted admin profile view, connect URL, LINE feature flags, and Task 7 actions.
- Produces: accessible Settings card titled `LINE message testing`.

- [ ] **Step 1: Write failing component tests**

Using Testing Library, verify:

- test-client fields start with persisted values;
- one-time selection forces Initial and hides installment/slot controls;
- installment Initial hides reminder slot;
- installment Later shows installment number `2..count` plus five fixed slots;
- preview displays rendered text without sending;
- send button remains disabled until test recipient status is LINKED;
- Connect uses same LIFF URL; reconnect and disconnect call dedicated actions;
- Accepted, Failed, and Review outcomes appear in `aria-live`; and
- no control offers a real client recipient or real payment URL.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npx vitest run src/components/admin/line-message-test-form.test.tsx`

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement component**

Use existing Card, Field, Input, Select, Button, and status patterns. Keep connection controls and scenario fields inside one form card. Submit editable profile fields with preview/send so server always validates current UI state. Disable double-submission with `useTransition()`.

- [ ] **Step 4: Add failing Settings page wiring test**

Mock test-profile resolution and component. Assert one existing Settings read supplies profile, runtime config supplies `lineLiffId`/feature flags, and all five actions are passed.

- [ ] **Step 5: Wire Settings page**

Resolve test profile from already-loaded Settings records; use default profile only when absent. Recover/build connect URL server-side only for a valid LINK_ACTIVE test profile. Render card after installment reminder templates and before terms-image settings.

- [ ] **Step 6: Run UI tests**

Run: `npx vitest run src/components/admin/line-message-test-form.test.tsx 'src/app/admin/(protected)/settings/page.test.tsx'`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/line-message-test-form.tsx src/components/admin/line-message-test-form.test.tsx 'src/app/admin/(protected)/settings/page.tsx' 'src/app/admin/(protected)/settings/page.test.tsx'
git commit -m "feat: add LINE message testing UI"
```

---

### Task 9: End-to-End Regression and Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-line-message-test-harness-design.md`
- Test: all changed test files

**Interfaces:**
- Consumes all prior tasks.
- Produces green lint, full Vitest suite, production build, and implementation-status docs.

- [ ] **Step 1: Run focused feature suite**

Run:

```bash
npx vitest run \
  src/lib/line/connection-reservation.test.ts \
  src/lib/line/message-test-profile.test.ts \
  src/lib/sheets/line-message-test-profile.test.ts \
  src/lib/line/message-test-connection.test.ts \
  src/app/api/line/connect/route.test.ts \
  src/app/line/message-test/page.test.tsx \
  src/app/api/line/message-test-qr/route.test.ts \
  src/lib/line/payment-message-images.test.ts \
  src/lib/line/message-test-delivery.test.ts \
  'src/app/admin/(protected)/settings/line-test-actions.test.ts' \
  src/components/admin/line-message-test-form.test.tsx \
  'src/app/admin/(protected)/settings/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run full required verification**

Run: `npm run lint && npm test && npm run build`

Expected: all commands exit 0. Existing `<img>` lint warnings may remain; no new warnings or failures.

- [ ] **Step 3: Perform security/state review**

Run:

```bash
rg -n "lineUserId|connectionToken|payment_url|public_token|line_reminder_delivery_log" \
  src/lib/line/message-test-* \
  src/app/admin/'(protected)'/settings/line-test-actions.ts \
  src/components/admin/line-message-test-form.tsx
```

Verify full IDs/tokens appear only in server-side claim/delivery inputs. Authorized renew may expose token only inside `connectUrl`; no result contains a separate token or full LINE ID. Audit metadata exposes suffix/safe codes only. Verify delivery service imports no client, schedule, or payment writer.

- [ ] **Step 4: Mark design implemented**

Change design header from `**Status:** Approved design` to `**Status:** Implemented`. Do not add deployment claims or manual LINE acceptance results unless actually performed.

- [ ] **Step 5: Commit final verification state**

```bash
git add docs/superpowers/specs/2026-08-15-line-message-test-harness-design.md
git commit -m "docs: finalize LINE message test harness"
```

- [ ] **Step 6: Manual deployed acceptance checklist**

After deployment, coach performs these real-endpoint checks with dedicated account:

1. Save test-client details.
2. Connect through same LIFF page used by clients.
3. Send one-time Initial; confirm current one-time text, test QR, and configured terms image arrive.
4. Send installment Initial; confirm current installment text, test QR, and configured terms image arrive.
5. Send installment Later for each five slots; confirm selected template, derived due date/installment values, same safe QR, and no terms image.
6. Open URL/scan QR; confirm only non-payment warning appears.
7. Confirm Clients, Schedules, Payments, dashboards, and reminder logs remain unchanged; only test-specific audit rows appear.

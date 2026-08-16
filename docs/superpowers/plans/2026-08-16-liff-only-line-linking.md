# LIFF-Only LINE Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove chat-command LINE linking and connection replies so LIFF is the only account-linking path.

**Architecture:** Preserve LIFF connection, disconnect, payment-slip webhook, and profile refresh behind LIFF-oriented services. Remove command/reply modules, reduce reply config to slip messages, then physically delete three obsolete Clients columns and stale code reservations before normal Sheets access.

**Tech Stack:** Next.js App Router, strict TypeScript, React, Zod, Google Sheets API, Vitest, Testing Library.

## Global Constraints

- LIFF `POST /api/line/connect` is sole account-linking endpoint.
- LINE webhook keeps signature verification, slip-image processing, and linked-profile refresh.
- `LINK <code>` performs no linking and receives no connection reply.
- Preserve LIFF connect, reconnect, disconnect, test-recipient linking, payment delivery, and slip replies.
- Delete `line_link_code`, `line_link_code_expires_at`, and `line_link_message` physically from Clients sheets.
- Keep current LIFF status, linked timestamp, error, token, user identity, display name, and picture fields.
- Unit tests never call live LINE or Google APIs.

---

### Task 1: Make Automatic Reply Configuration Slip-Only

**Files:**
- Modify: `src/lib/line/reply-config.test.ts`
- Modify: `src/lib/line/reply-config.ts`
- Modify: `src/components/admin/line-automatic-reply-form.test.tsx`
- Modify: `src/components/admin/line-automatic-reply-form.tsx`
- Modify: `src/app/admin/(protected)/settings/line-actions.test.ts`
- Modify: `src/app/admin/(protected)/settings/messages/page.test.tsx`
- Modify: `src/lib/sheets/settings.test.ts`
- Modify: `src/lib/line/slip-payments.test.ts`

**Interfaces:**
- Produces: `LineAutomaticReplyConfig = { version: 2; slip: { autoRecorded; review; flagged } }`.
- Keeps: parser, resolver, `lineSlipReplyText`, save/reset actions, and setting key `line_automatic_reply_config`.
- Removes: `connection` config and `lineConnectionReplyText`.

- [ ] **Step 1: Write failing reply-config tests**

```ts
const custom = {
  version: 2 as const,
  slip: {
    autoRecorded: "recorded-custom",
    review: "review-custom",
    flagged: "flagged-custom",
  },
};

expect(parseLineAutomaticReplyConfig(custom)).toEqual(custom);
expect(() => parseLineAutomaticReplyConfig({
  ...custom,
  connection: { linked: "legacy" },
})).toThrow("LINE automatic reply configuration is invalid");
```

Production change caught: accepting or exposing removed connection-reply data.

- [ ] **Step 2: Write failing dashboard test**

```ts
render(<LineAutomaticReplyForm resolved={valid} saveAction={saveAction} resetAction={resetAction} />);
expect(screen.getByText("Payment slip replies")).toBeTruthy();
expect(screen.queryByText("LINE connection replies")).toBeNull();
expect(screen.queryByLabelText("Connected successfully")).toBeNull();
```

Production change caught: connection editors remaining visible in Settings.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npx vitest run src/lib/line/reply-config.test.ts src/components/admin/line-automatic-reply-form.test.tsx
```

Expected: FAIL because production schema still requires version 1 plus `connection`, and UI still renders connection fields.

- [ ] **Step 4: Implement slip-only config and form**

```ts
const automaticReplyConfigSchema = z.object({
  version: z.literal(2),
  slip: z.object({
    autoRecorded: messageSchema,
    review: messageSchema,
    flagged: messageSchema,
  }).strict(),
}).strict();
```

Set defaults to `{ version: 2, slip: ... }`. Delete `LinkResult` import and `lineConnectionReplyText`. In form, delete `ConnectionField`, `updateConnection`, connection card, and connection wording. Keep save/reset behavior; description becomes `Messages LINE sends after payment-slip processing.`

- [ ] **Step 5: Update consumers and fixtures**

Change tests and fixtures to version-2 slip-only objects. Keep settings validation/fallback. Ensure form submits JSON containing only `version` and `slip`.

- [ ] **Step 6: Run focused reply tests and verify GREEN**

```bash
npx vitest run src/lib/line/reply-config.test.ts src/components/admin/line-automatic-reply-form.test.tsx src/app/admin/'(protected)'/settings/line-actions.test.ts src/app/admin/'(protected)'/settings/messages/page.test.tsx src/lib/sheets/settings.test.ts src/lib/line/slip-payments.test.ts
```

Expected: all pass; connection reply fields absent from rendered Settings.

- [ ] **Step 7: Commit**

```bash
git add src/lib/line/reply-config.ts src/lib/line/reply-config.test.ts src/components/admin/line-automatic-reply-form.tsx src/components/admin/line-automatic-reply-form.test.tsx src/app/admin/'(protected)'/settings/line-actions.test.ts src/app/admin/'(protected)'/settings/messages/page.test.tsx src/lib/sheets/settings.test.ts src/lib/line/slip-payments.test.ts
git commit -m "refactor: keep only LINE slip replies"
```

### Task 2: Move Current Profile and Disconnect Behavior Out of Legacy Linking

**Files:**
- Modify: `src/lib/line/profile.test.ts`
- Modify: `src/lib/line/profile.ts`
- Modify: `src/lib/line/connection.test.ts`
- Modify: `src/lib/line/connection.ts`
- Modify: `src/app/api/line/webhook/route.ts`
- Modify: `src/app/api/line/webhook/route.test.ts`
- Modify: `src/app/admin/(protected)/actions.ts`
- Modify: `src/app/admin/(protected)/actions.test.ts`

**Interfaces:**
- Produces: `persistLineProfile(dependencies, input): Promise<boolean>` in `profile.ts`.
- Produces: `disconnectLineUser(dependencies, input): Promise<boolean>` in `connection.ts`.
- Both consume current Sheets dependencies; disconnect also consumes current audit dependency.

- [ ] **Step 1: Write failing profile persistence tests**

Move current behavior cases from `linking.test.ts` into `profile.test.ts`:

```ts
await expect(persistLineProfile(deps, {
  lineUserId: userA,
  displayName: "Nisa LINE",
  pictureUrl: "https://profile.line-scdn.net/avatar/path",
  now,
})).resolves.toBe(true);

expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({
  client: expect.objectContaining({
    line_display_name: "Nisa LINE",
    line_picture_url: "https://profile.line-scdn.net/avatar/path",
  }),
}));
```

Also retain cases for formula-safe names, missing linked user, stale optimistic update, and valid empty picture URL. Production change caught: profile refresh lost when legacy service is deleted.

- [ ] **Step 2: Write failing disconnect test in connection suite**

```ts
await expect(disconnectLineUser(deps, { clientId: "client_1", now })).resolves.toBe(true);
expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({
  client: expect.objectContaining({
    line_user_id: "",
    line_display_name: "",
    line_picture_url: "",
    line_link_status: "",
    line_link_token_hash: "",
    line_link_token_encrypted: "",
    line_link_token_expires_at: "",
  }),
  releaseLineUserId: userA,
}));
```

Production change caught: admin disconnect no longer clearing LIFF identity/token state.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npx vitest run src/lib/line/profile.test.ts src/lib/line/connection.test.ts
```

Expected: FAIL because new exports do not exist.

- [ ] **Step 4: Implement current services**

Add profile persistence beside URL normalization. Locate `line_user_id` with status `LINKED`, make display name formula-safe, update profile fields plus `updated_at`, return optimistic update result.

Add disconnect to `connection.ts`. Clear identity, profile, status, linked timestamp, error, and LIFF token fields; release current LINE-user reservation; append `LINE_LINK_DISCONNECTED` only after successful update.

- [ ] **Step 5: Switch route and admin action imports**

Use `persistLineProfile` for webhook profile refresh. Use `disconnectLineUser` from `connection.ts` in admin action. Do not alter event routing yet.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npx vitest run src/lib/line/profile.test.ts src/lib/line/connection.test.ts src/app/api/line/webhook/route.test.ts src/app/admin/'(protected)'/actions.test.ts
```

Expected: all pass with profile refresh and disconnect behavior unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/line/profile.ts src/lib/line/profile.test.ts src/lib/line/connection.ts src/lib/line/connection.test.ts src/app/api/line/webhook/route.ts src/app/api/line/webhook/route.test.ts src/app/admin/'(protected)'/actions.ts src/app/admin/'(protected)'/actions.test.ts
git commit -m "refactor: move LINE profile lifecycle to LIFF services"
```

### Task 3: Remove Chat-Command Linking From Webhook and Codebase

**Files:**
- Modify: `src/app/api/line/webhook/route.test.ts`
- Modify: `src/app/api/line/webhook/route.ts`
- Modify: `src/lib/line/client.test.ts`
- Modify: `src/lib/line/client.ts`
- Delete: `src/lib/line/link-code.test.ts`
- Delete: `src/lib/line/link-code.ts`
- Delete: `src/lib/line/link-command.test.ts`
- Delete: `src/lib/line/link-command.ts`
- Delete: `src/lib/line/link-message.test.ts`
- Delete: `src/lib/line/link-message.ts`
- Delete: `src/lib/line/linking.test.ts`
- Delete: `src/lib/line/linking.ts`

**Interfaces:**
- Keeps: signed webhook handling, image event, profile event, slip processing, profile refresh.
- Removes: direct-link event, link processing/reply audit, `replyLineMessage` convenience client.
- Keeps: `sendLineReplyMessage`, used for payment-slip replies.

- [ ] **Step 1: Replace legacy webhook tests with failing no-link/no-reply test**

```ts
it("treats legacy LINK text as an ordinary profile-refresh event without linking or replying", async () => {
  mocks.listClients.mockResolvedValue([]);
  mocks.fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ displayName: "Unknown" }), { status: 200 }));

  await expect(POST(signedRequest({ events: [event()] }))).resolves.toMatchObject({ status: 200 });

  expect(mocks.getLineAutomaticReplyConfig).not.toHaveBeenCalled();
  expect(mocks.fetchFn).not.toHaveBeenCalledWith(
    "https://api.line.me/v2/bot/message/reply",
    expect.anything(),
  );
});
```

Delete tests for connection wording, claims, inactive masking, and link-reply audits. Production change caught: `LINK` still invokes link/reply branch.

- [ ] **Step 2: Run webhook test and verify RED**

```bash
npx vitest run src/app/api/line/webhook/route.test.ts
```

Expected: FAIL because webhook still loads connection replies and calls reply endpoint.

- [ ] **Step 3: Remove legacy webhook branch**

Delete legacy imports, direct-link type/parser, reply-failure audit, link processor, connection-reply config loading, and link-event branch. Let direct text continue through profile refresh. Preserve event isolation.

- [ ] **Step 4: Delete unused reply convenience and legacy modules**

Remove `replyLineMessage` plus its direct unit tests. Keep generalized `sendLineReplyMessage` and slip coverage. Delete listed legacy modules/tests.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npx vitest run src/app/api/line/webhook/route.test.ts src/lib/line/client.test.ts src/lib/line/profile.test.ts src/lib/line/slip-payments.test.ts
```

Expected: all pass; text acknowledged without link/reply; images/profile refresh functional.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/line/webhook/route.ts src/app/api/line/webhook/route.test.ts src/lib/line/client.ts src/lib/line/client.test.ts src/lib/line/link-code.ts src/lib/line/link-code.test.ts src/lib/line/link-command.ts src/lib/line/link-command.test.ts src/lib/line/link-message.ts src/lib/line/link-message.test.ts src/lib/line/linking.ts src/lib/line/linking.test.ts
git commit -m "refactor: remove legacy LINE chat linking"
```

### Task 4: Remove Legacy Client Fields and Code Reservations

**Files:**
- Modify: `src/lib/sheets/records.test.ts`
- Modify: `src/lib/sheets/records.ts`
- Modify: `src/lib/sheets/migration.test.ts`
- Modify: `src/lib/sheets/migration.ts`
- Modify: `src/lib/sheets/clients.test.ts`
- Modify: `src/lib/sheets/clients.ts`
- Modify: `src/lib/line/connection-reservation.test.ts`
- Modify: `src/lib/line/connection-reservation.ts`
- Modify: `src/lib/line/connection.ts`
- Modify: `src/lib/line/connection.test.ts`
- Modify: `src/lib/line/message-test-profile.ts`
- Modify: `src/lib/line/message-test-connection.test.ts`
- Modify: `src/lib/line/due-payments.test.ts`
- Modify: `src/lib/line/welcome-message.test.ts`
- Modify: `src/app/admin/(protected)/actions.ts`
- Modify: `src/app/admin/(protected)/actions.test.ts`
- Modify: `src/app/admin/(protected)/clients/clients-page.test.tsx`
- Modify: `src/app/admin/(protected)/clients/[clientId]/client-detail-page.test.tsx`
- Modify: `src/lib/workspace/workbook.test.ts`
- Modify: other `ClientRecord` fixtures found by tests/build.

**Interfaces:**
- Produces 24-column `CLIENT_HEADERS`, ending at `X`.
- Keeps `LineConnectionClaimInput`, `updateLineLinkClient`, and `claimLineConnection`.
- Produces renamed `LineConnectionClaimResult = "CLAIMED" | "ALREADY_LINKED" | "CONFLICT" | "STALE"`.
- Removes `LineLinkClaimInput`, `LineLinkClaimResult`, `claimLineLink`, and `lineReservationName("code", ...)`.

- [ ] **Step 1: Write failing schema and migration tests**

```ts
expect(CLIENT_HEADERS).toEqual([
  "client_id", "active", "client_name", "line_user_id", "line_display_name",
  "package_name", "payment_type", "total_price_thb", "installment_count",
  "interval_months", "first_due_date", "default_amount_thb",
  "billing_frequency", "next_due_date", "notes", "created_at", "updated_at",
  "line_link_status", "line_linked_at", "line_link_error",
  "line_link_token_hash", "line_link_token_encrypted",
  "line_link_token_expires_at", "line_picture_url",
]);
```

Migration fixture returns old 27-column header plus `line_link_code_<hash>` named range. Assert descending deletion and named-range cleanup:

```ts
expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
  requestBody: { requests: [
    { deleteDimension: { range: { sheetId: 9, dimension: "COLUMNS", startIndex: 21, endIndex: 22 } } },
    { deleteDimension: { range: { sheetId: 9, dimension: "COLUMNS", startIndex: 18, endIndex: 19 } } },
    { deleteDimension: { range: { sheetId: 9, dimension: "COLUMNS", startIndex: 17, endIndex: 18 } } },
    { deleteNamedRange: { namedRangeId: "legacy-code-range" } },
  ] },
}));
```

Production change caught: obsolete columns/reservations surviving, or wrong deletion order.

- [ ] **Step 2: Write failing client repository test**

```ts
expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
  requestBody: { requests: expect.arrayContaining([
    expect.objectContaining({
      updateCells: expect.objectContaining({
        range: expect.objectContaining({ startColumnIndex: 16, endColumnIndex: 23 }),
      }),
    }),
  ]) },
}));
```

Production change caught: shifted row updates corrupting LIFF status/token columns.

- [ ] **Step 3: Run schema/repository tests and verify RED**

```bash
npx vitest run src/lib/sheets/records.test.ts src/lib/sheets/migration.test.ts src/lib/sheets/clients.test.ts src/lib/line/connection-reservation.test.ts
```

Expected: FAIL because current schema has 27 columns, migration only appends, repository exposes code reservation.

- [ ] **Step 4: Implement physical schema cleanup**

Before normal client schema setup, inspect Clients headers through old `AA` plus named ranges. Delete matching legacy columns by exact header name in descending index order. Delete named ranges beginning `line_link_code_`. Then run 24-column schema validation. Keep cached/idempotent behavior. Never delete unknown columns by numeric position.

- [ ] **Step 5: Reduce records and atomic row updates**

Remove three properties from headers, link field types, state hashing, and constructors. Update current state write:

```ts
{ updateCells: {
  range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 16, endColumnIndex: 23 },
  rows: [{ values: [
    claimCell(client.updated_at),
    claimCell(client.line_link_status),
    claimCell(client.line_linked_at),
    claimCell(client.line_link_error),
    claimCell(client.line_link_token_hash),
    claimCell(client.line_link_token_encrypted),
    claimCell(client.line_link_token_expires_at),
  ] }],
  fields: "userEnteredValue",
} }
```

Write `line_picture_url` at index `23..24`. Change workbook header ranges from `AA` to `X`.

- [ ] **Step 6: Delete code reservation API and update constructors**

Remove `LineLinkClaimInput`, `LineLinkClaimResult`, `claimLineLink`, and `"code"` reservation kind. Rename current claim result to `LineConnectionClaimResult` and update its LIFF consumers. Remove obsolete fields from `LineConnectionFields`, new-client data, disconnect data, test-profile adapters, and every complete `ClientRecord` fixture. Keep token/user reservations unchanged.

- [ ] **Step 7: Run affected tests and fix fixture/type fallout**

```bash
npx vitest run src/lib/sheets/records.test.ts src/lib/sheets/migration.test.ts src/lib/sheets/clients.test.ts src/lib/line/connection-reservation.test.ts src/lib/line/connection.test.ts src/lib/line/message-test-connection.test.ts src/lib/line/due-payments.test.ts src/lib/line/welcome-message.test.ts src/app/admin/'(protected)'/actions.test.ts src/app/admin/'(protected)'/clients/clients-page.test.tsx src/app/admin/'(protected)'/clients/'[clientId]'/client-detail-page.test.tsx src/lib/workspace/workbook.test.ts
```

Expected: all pass with 24-column schema and LIFF-only reservations.

- [ ] **Step 8: Run build for strict fixture fallout**

```bash
npm run build
```

Expected: exit 0. Remove deleted properties from any remaining strict fixtures; rerun owner test before build.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sheets src/lib/line src/lib/workspace src/app/admin src/components/admin
git commit -m "refactor: remove legacy LINE link fields"
```

### Task 5: Final Regression and Trace Review

**Files:**
- Modify only files implicated by failed verification.

**Interfaces:**
- Verifies all design requirements; introduces no interface.

- [ ] **Step 1: Search active code for removed traces**

```bash
rg -n "line_link_code|line_link_code_expires_at|line_link_message|claimLineLink|parseLineLinkCommand|lineConnectionReplyText|LINE connection replies|LINE_LINK_REPLY_FAILED" src apps-script
```

Expected: no matches. Historical design/plan docs intentionally remain.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: exit 0, no ESLint errors.

- [ ] **Step 3: Run full tests**

```bash
npm test
```

Expected: exit 0, zero failed Vitest tests.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: exit 0, Next.js build completes.

- [ ] **Step 5: Review final diff against spec**

```bash
git diff --check HEAD~4..HEAD
git status --short
```

Confirm LIFF route remains, webhook image/profile paths remain, connection editors absent, deleted columns migrate physically, and no unrelated changes appear.

- [ ] **Step 6: Commit verification fixes if needed**

```bash
git add -u
git commit -m "test: verify LIFF-only LINE linking"
```

Skip when verification requires no fixes.

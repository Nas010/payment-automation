# LINE Client Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store verified LINE profile-picture URLs on client records, refresh them from later LINE profile events, and render avatars in client list and detail views.

**Architecture:** Add one normalized `line_picture_url` field to the additive Google Sheets client schema. Pass it only from trusted LINE server responses through existing atomic linking/profile update services. Render it through a focused client avatar component with LINE-CDN allowlisting and initials fallback.

**Tech Stack:** Next.js 15 App Router, React 19, strict TypeScript, Google Sheets API, LINE Login/Messaging APIs, Vitest, Tailwind CSS.

## Global Constraints

- Keep browser-decoded LINE claims untrusted; consume `picture` only from LINE's server-side ID-token verification response.
- Store URL only; do not download or cache profile-image bytes.
- Accept only HTTPS URLs on `profile.line-scdn.net`; invalid values become empty strings and never block account linking.
- Append `line_picture_url` without overwriting existing workbook cells.
- Refresh profile on later supported LINE follow/message events; failed profile requests preserve current values.
- Clear picture with other LINE identity fields on disconnect.
- No avatar URL in logs or audit metadata.
- Test-first for every behavior change.
- Real LINE avatar validation requires LIFF `profile` scope and a real mobile LINE interaction; never claim it passed without evidence.

---

### Task 1: Normalize Trusted LINE Picture URLs

**Files:**
- Create: `src/lib/line/profile.ts`
- Create: `src/lib/line/profile.test.ts`
- Modify: `src/lib/line/liff-verification.ts`
- Modify: `src/lib/line/liff-verification.test.ts`
- Modify: `src/lib/line/client.ts`
- Modify: `src/lib/line/client.test.ts`

**Interfaces:**
- Produces: `normalizeLinePictureUrl(value: unknown): string`
- Changes: `verifyLineIdToken(...): Promise<{ lineUserId: string; displayName: string; pictureUrl: string }>`
- Changes: `getLineProfile(...): Promise<{ displayName: string; pictureUrl: string }>`

- [ ] **Step 1: Write failing URL-normalization tests**

```ts
expect(normalizeLinePictureUrl("https://profile.line-scdn.net/avatar")).toBe("https://profile.line-scdn.net/avatar");
expect(normalizeLinePictureUrl("http://profile.line-scdn.net/avatar")).toBe("");
expect(normalizeLinePictureUrl("https://attacker.example/avatar")).toBe("");
expect(normalizeLinePictureUrl(undefined)).toBe("");
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run src/lib/line/profile.test.ts`
Expected: FAIL because module/function does not exist.

- [ ] **Step 3: Implement strict normalizer**

```ts
export function normalizeLinePictureUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "profile.line-scdn.net" ? url.toString() : "";
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Extend LINE verification and profile-client tests**

Assert valid `picture`/`pictureUrl` values are returned as `pictureUrl`, missing/unsafe values return `""`, and existing sanitized error behavior remains unchanged.

- [ ] **Step 5: Run focused tests and verify RED**

Run: `npx vitest run src/lib/line/profile.test.ts src/lib/line/liff-verification.test.ts src/lib/line/client.test.ts`
Expected: new return-shape expectations fail.

- [ ] **Step 6: Pass normalized picture through trusted LINE responses**

```ts
const pictureUrl = normalizeLinePictureUrl(claims.picture);
return { lineUserId: claims.sub, displayName, pictureUrl };
```

`getLineProfile` must read optional `pictureUrl`, normalize it, and keep requiring a string `displayName`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npx vitest run src/lib/line/profile.test.ts src/lib/line/liff-verification.test.ts src/lib/line/client.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit trusted-profile boundary**

```bash
git add src/lib/line/profile.ts src/lib/line/profile.test.ts src/lib/line/liff-verification.ts src/lib/line/liff-verification.test.ts src/lib/line/client.ts src/lib/line/client.test.ts
git commit -m "feat: verify LINE client avatar URLs"
```

### Task 2: Extend Client Sheet Schema and Atomic Writes

**Files:**
- Modify: `src/lib/sheets/records.ts`
- Modify: `src/lib/sheets/records.test.ts`
- Modify: `src/lib/sheets/clients.ts`
- Modify: `src/lib/sheets/clients.test.ts`
- Modify: `src/lib/sheets/migration.test.ts`
- Modify: `src/app/admin/(protected)/actions.test.ts`
- Modify: `src/app/admin/(protected)/clients/[clientId]/client-detail-page.test.tsx`
- Modify: `src/app/admin/(protected)/clients/clients-page.test.tsx`
- Modify: `src/app/admin/(protected)/payments/[paymentId]/payment-detail-page.test.ts`
- Modify: `src/app/admin/(protected)/payments/payments-page.test.ts`
- Modify: `src/app/api/line/webhook/route.test.ts`
- Modify: `src/lib/line/connection.test.ts`
- Modify: `src/lib/line/due-payments.test.ts`
- Modify: `src/lib/line/linking.test.ts`
- Modify: `src/lib/line/welcome-message.test.ts`
- Modify: `src/lib/payments/generate.test.ts`
- Modify: `src/lib/plans/assignment.test.ts`
- Modify: `src/lib/plans/schedule.test.ts`
- Modify: `src/app/admin/(protected)/actions.ts`

**Interfaces:**
- Changes: `ClientRecord` includes `line_picture_url: string`
- Changes: `CLIENT_HEADERS` ends with `line_picture_url`
- Produces: `sheetColumnName(column: number): string`
- Keeps: existing `updateLineLinkClient`, `claimLineLink`, and `claimLineConnection` public signatures

- [ ] **Step 1: Write failing schema/range tests**

```ts
expect(CLIENT_HEADERS.at(-1)).toBe("line_picture_url");
expect(get).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet_1", range: "Clients!A:AA" });
expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "Clients!A2:AA2" }));
```

Extend atomic update expectations to require an `AA` cell write in the same `batchUpdate` request as LINE user ID/name/status.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run src/lib/sheets/records.test.ts src/lib/sheets/clients.test.ts src/lib/sheets/migration.test.ts`
Expected: schema remains 26 columns and reads/writes stop at Z.

- [ ] **Step 3: Append field and derive client range**

```ts
export const CLIENT_HEADERS = [
  "client_id", "active", "client_name", "line_user_id", "line_display_name", "package_name", "payment_type",
  "total_price_thb", "installment_count", "interval_months", "first_due_date", "default_amount_thb",
  "billing_frequency", "next_due_date", "notes", "created_at", "updated_at", "line_link_code",
  "line_link_code_expires_at", "line_link_status", "line_linked_at", "line_link_message", "line_link_error",
  "line_link_token_hash", "line_link_token_encrypted", "line_link_token_expires_at", "line_picture_url",
] as const;

export function sheetColumnName(column: number): string {
  let value = column;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

export type ClientRecord = {
  // existing fields
  line_picture_url: string;
} & LineLinkFields;
```

Import `sheetColumnName` into `clients.ts`, calculate `const CLIENT_END_COLUMN = sheetColumnName(CLIENT_HEADERS.length)`, then use it so list/write/update ranges become `A:AA` without another hard-coded boundary. Replace migration's private `columnName` with this exported helper.

- [ ] **Step 4: Include picture in optimistic identity state and atomic update**

Add `client.line_picture_url` to `lineStateReservationName`. Add an `updateCells` entry targeting zero-based column 26 through 27 with `claimCell(client.line_picture_url)` inside `lineLinkCellUpdates`.

- [ ] **Step 5: Initialize new clients and update typed fixtures**

New-client action writes `line_picture_url: ""`. Every strict `ClientRecord` fixture supplies empty string unless testing a real picture URL.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run src/lib/sheets/records.test.ts src/lib/sheets/clients.test.ts src/lib/sheets/migration.test.ts src/app/admin/'(protected)'/actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit schema change**

```bash
git add src/lib/sheets src/app/admin/'(protected)'/actions.ts src/app/admin/'(protected)'/actions.test.ts src
git commit -m "feat: store LINE client avatar URLs"
```

### Task 3: Persist Pictures During Linking, Refresh, and Disconnect

**Files:**
- Modify: `src/lib/line/connection.ts`
- Modify: `src/lib/line/connection.test.ts`
- Modify: `src/app/api/line/connect/route.ts`
- Modify: `src/app/api/line/connect/route.test.ts`
- Modify: `src/lib/line/linking.ts`
- Modify: `src/lib/line/linking.test.ts`
- Modify: `src/app/api/line/webhook/route.ts`
- Modify: `src/app/api/line/webhook/route.test.ts`

**Interfaces:**
- Changes: connection `claim` accepts optional `pictureUrl?: string`
- Replaces: `persistLineDisplayName(...)` with `persistLineProfile({ lineUserId, displayName, pictureUrl, now })`
- Produces: webhook profile-event parsing for supported user `follow` and `message` events

- [ ] **Step 1: Write failing one-tap persistence tests**

```ts
await service.claim({ token, lineUserId, displayName: "Nisa LINE", pictureUrl, now });
expect(deps.claimLineConnection).toHaveBeenCalledWith(expect.objectContaining({
  client: expect.objectContaining({ line_user_id: lineUserId, line_display_name: "Nisa LINE", line_picture_url: pictureUrl }),
}));
```

Route test must expect `pictureUrl` from `verifyLineIdToken` to reach `claim`.

- [ ] **Step 2: Run connection tests and verify RED**

Run: `npx vitest run src/lib/line/connection.test.ts src/app/api/line/connect/route.test.ts`
Expected: picture is absent from service/route input.

- [ ] **Step 3: Implement one-tap persistence**

Extend claim input, assign `line_picture_url: pictureUrl`, and pass `identity.pictureUrl` from route. Keep normalized empty-string default.

- [ ] **Step 4: Write failing refresh/disconnect tests**

Test `persistLineProfile` updates name and picture only for current linked user. Test successful profile without picture clears URL. Test failed profile fetch never invokes update. Test disconnect produces `line_picture_url: ""`.

Webhook tests must cover a linked user's ordinary text/follow event, not only legacy `LINK` commands.

- [ ] **Step 5: Run linking/webhook tests and verify RED**

Run: `npx vitest run src/lib/line/linking.test.ts src/app/api/line/webhook/route.test.ts`
Expected: profile method/event path does not exist and disconnect retains picture.

- [ ] **Step 6: Implement best-effort webhook refresh**

```ts
async persistLineProfile({ lineUserId, displayName, pictureUrl, now }) {
  const client = (await dependencies.listClients()).find(
    (item) => item.line_user_id === lineUserId && item.line_link_status === "LINKED",
  );
  if (!client) return false;
  return dependencies.updateLineLinkClient({
    client: { ...client, line_display_name: sheetSafeLineDisplayName(displayName), line_picture_url: pictureUrl, updated_at: nowIso(now) },
    expectedClient: client,
  });
}
```

Parse supported user `follow`/`message` events, call `getLineProfile`, then persist both fields. Catch profile/token failures without failing signed webhook batches. Avoid logging profile URLs.

- [ ] **Step 7: Run all Task 3 tests and verify GREEN**

Run: `npx vitest run src/lib/line/connection.test.ts src/app/api/line/connect/route.test.ts src/lib/line/linking.test.ts src/app/api/line/webhook/route.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit identity lifecycle**

```bash
git add src/lib/line/connection.ts src/lib/line/connection.test.ts src/lib/line/linking.ts src/lib/line/linking.test.ts src/app/api/line/connect src/app/api/line/webhook
git commit -m "feat: refresh LINE client avatars"
```

### Task 4: Render Client Avatars in Admin UI

**Files:**
- Create: `src/components/admin/client-avatar.tsx`
- Create: `src/components/admin/client-avatar.test.tsx`
- Modify: `src/components/admin/page-ui.tsx`
- Modify: `src/app/admin/(protected)/clients/page.tsx`
- Modify: `src/app/admin/(protected)/clients/clients-page.test.tsx`
- Modify: `src/app/admin/(protected)/clients/[clientId]/page.tsx`
- Modify: `src/app/admin/(protected)/clients/[clientId]/client-detail-page.test.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Produces: `ClientAvatar({ clientName, lineDisplayName, pictureUrl, size? })`
- Changes: `PageHeader.title` accepts `ReactNode` instead of only `string`

- [ ] **Step 1: Write failing avatar component tests**

Use jsdom. Assert valid picture renders alt text `LINE profile picture for Nisa`, missing picture renders initials `NL`/`N`, and image `error` event swaps to initials.

- [ ] **Step 2: Run component test and verify RED**

Run: `npx vitest run src/components/admin/client-avatar.test.tsx`
Expected: component does not exist.

- [ ] **Step 3: Implement focused client component**

Use `"use client"`, `next/image`, local failed state, circular crop, and deterministic initials. `size="sm"` renders compact directory size; `size="lg"` renders detail-header size.

- [ ] **Step 4: Allow LINE image CDN only**

```ts
images: {
  remotePatterns: [{ protocol: "https", hostname: "profile.line-scdn.net", pathname: "/**" }],
},
```

- [ ] **Step 5: Write failing page-render tests**

Supply a linked fixture with `line_picture_url: "https://profile.line-scdn.net/avatar"`. Expect both client directory and detail HTML to contain the LINE profile alt text and URL.

- [ ] **Step 6: Run page tests and verify RED**

Run: `npx vitest run src/app/admin/'(protected)'/clients/clients-page.test.tsx src/app/admin/'(protected)'/clients/'[clientId]'/client-detail-page.test.tsx`
Expected: avatar markup absent.

- [ ] **Step 7: Place avatar in both views**

Client directory: wrap small avatar, name link, and LINE label in one flex row. Client detail: pass a title React node containing large avatar and client name to `PageHeader`. Preserve existing description and actions.

- [ ] **Step 8: Run Task 4 tests and verify GREEN**

Run: `npx vitest run src/components/admin/client-avatar.test.tsx src/app/admin/'(protected)'/clients/clients-page.test.tsx src/app/admin/'(protected)'/clients/'[clientId]'/client-detail-page.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit dashboard avatars**

```bash
git add src/components/admin/client-avatar.tsx src/components/admin/client-avatar.test.tsx src/components/admin/page-ui.tsx src/app/admin/'(protected)'/clients next.config.ts
git commit -m "feat: show LINE avatars for clients"
```

### Task 5: Full Verification and Production Delivery

**Files:**
- Modify only files needed to fix failures directly caused by Tasks 1-4.

**Interfaces:**
- Produces: tested production commit on `origin/main` and a READY Vercel production deployment.

- [ ] **Step 1: Run focused avatar suite**

Run: `npx vitest run src/lib/line/profile.test.ts src/lib/line/liff-verification.test.ts src/lib/line/client.test.ts src/lib/sheets/records.test.ts src/lib/sheets/clients.test.ts src/lib/sheets/migration.test.ts src/lib/line/connection.test.ts src/app/api/line/connect/route.test.ts src/lib/line/linking.test.ts src/app/api/line/webhook/route.test.ts src/components/admin/client-avatar.test.tsx src/app/admin/'(protected)'/clients/clients-page.test.tsx src/app/admin/'(protected)'/clients/'[clientId]'/client-detail-page.test.tsx`
Expected: PASS.

- [ ] **Step 2: Run required repository checks**

Run sequentially:

```bash
npm run lint
npm test
npm run build
```

Expected: all exit 0.

- [ ] **Step 3: Review final diff and status**

Run: `git diff --check && git status --short && git log -6 --oneline --decorate`
Expected: no whitespace errors; only intentional changes.

- [ ] **Step 4: Push production branch**

Fetch `origin/main`, verify no unexpected remote divergence, then push current tested commits to `origin/main` without force.

- [ ] **Step 5: Confirm Vercel production deployment**

Use repository-linked Vercel project/deployment tooling to wait for READY state. Do not change LINE Console settings automatically.

- [ ] **Step 6: Validate dashboard in in-app browser**

Open production admin login. Authenticate only with available authorized credentials/session. Confirm client directory and client detail layout/fallback avatars. Do not use standalone Playwright.

- [ ] **Step 7: Report external validation gate**

Report exact LINE Developers Console step: enable `profile` scope for LIFF app. Report real mobile LINE link/webhook avatar acquisition as unverified unless directly observed.

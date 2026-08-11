# Issue #3 LINE Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trainer securely link a LINE OA user to exactly one Google Sheets client through a one-time code, while managing LINE credentials from the protected dashboard.

**Architecture:** Extend the existing Google Sheets client schema in place, and make the server-side Sheets repository the only client store. Isolate one-time-code, encrypted-secret, LINE HTTP, and linking-domain concerns into focused modules; the public webhook composes them only after authenticating the untouched raw request body. Existing server actions and the Apps Script remain the two authoritative trainer workflows.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, Node `crypto`, Google Sheets API, Google Apps Script, React 19.

## Global Constraints

- Use `^[A-F0-9]{10}$` codes, generated from cryptographically secure random bytes and valid for exactly seven days.
- Preserve the existing `Clients` columns; append the six LINE-link fields only.
- Google Sheets remains the only client store; no LINE Login, OAuth, passwords, or second database.
- Webhook verification must HMAC-SHA256 the untouched UTF-8 raw body, base64-encode it, timing-safely compare it, and parse JSON only after verification.
- Only direct user-message events with `^U[0-9a-f]{32}$` source IDs and `LINK <code>` commands may link a client.
- Existing different relationships are never overwritten; conflicts set `REVIEW`, save a safe reason, and audit the event.
- LINE credentials are encrypted with AES-256-GCM using a base64-decoded 32-byte `SETTINGS_ENCRYPTION_KEY`; secret name is AAD and plaintext never reaches Sheets, logs, React props, or responses.
- Resolve encrypted credentials before optional legacy environment fallbacks. All tests mock Sheets and LINE HTTP; no test contacts live services.

---

### Task 1: Extend Sheets schema and client repository

**Files:**
- Modify: `src/lib/sheets/records.ts`, `src/lib/sheets/clients.ts`, `src/lib/sheets/clients.test.ts`, `src/lib/sheets/records.test.ts`
- Create: `src/lib/sheets/migration.ts`, `src/lib/sheets/migration.test.ts`
- Modify: `apps-script/Code.gs`, `src/apps-script/Code.test.ts`

**Interfaces:**
- Produces `ClientRecord` fields `line_link_code`, `line_link_code_expires_at`, `line_link_status`, `line_linked_at`, `line_link_message`, and `line_link_error`.
- Produces `ensureClientSchema(): Promise<void>` that appends missing headers and never replaces existing client cell values.

- [ ] **Step 1: Write failing schema and migration tests**

Assert the exact existing `CLIENT_HEADERS` prefix remains unchanged, the six fields are appended in the issue order, `listClients`/`writeClient` use `Clients!A:W`, and a mocked migration only writes missing header cells.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/lib/sheets/records.test.ts src/lib/sheets/clients.test.ts src/lib/sheets/migration.test.ts src/apps-script/Code.test.ts`

Expected: failures identify missing fields, `A:Q` ranges, and missing migration behavior.

- [ ] **Step 3: Implement non-destructive schema support**

Append the fields to `CLIENT_HEADERS`, update the record type and ranges, and use Sheets metadata/header reads plus `values.update` only for blank missing headers. Call the migration before client repository operations. Add Apps Script `ensureClientSchema_()` and invoke it before dashboard/client menu mutations.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests pass.

- [ ] **Step 5: Commit**

`git add src/lib/sheets/records.ts src/lib/sheets/clients.ts src/lib/sheets/migration.ts src/lib/sheets/*.test.ts apps-script/Code.gs src/apps-script/Code.test.ts && git commit -m "feat: extend client LINE link schema"`

### Task 2: Build one-time code, command, and linking domain services

**Files:**
- Create: `src/lib/line/link-code.ts`, `src/lib/line/link-code.test.ts`, `src/lib/line/link-command.ts`, `src/lib/line/link-command.test.ts`, `src/lib/line/link-message.ts`, `src/lib/line/link-message.test.ts`, `src/lib/line/linking.ts`, `src/lib/line/linking.test.ts`

**Interfaces:**
- Produces `createLineLinkCode()`, `expiresAt(now)`, `renderLineLinkInstruction({ clientName, code })`, and `parseLineLinkCommand(text)`.
- Produces `createLineLinkService(dependencies)` whose `linkLineUser({ code, lineUserId, now, webhookEventId })` returns `LINKED`, `ALREADY_LINKED`, `INVALID_OR_EXPIRED`, `CLIENT_INACTIVE`, or `CONFLICT`.
- Produces trainer functions `generateMissingLineLinkCodes`, `renewLineLinkCode`, and `disconnectLineUser`.

- [ ] **Step 1: Write failing behavior tests**

Name each protected break: malformed/non-random code, collision reuse, wrong expiry, non-LINK parsing, invalid/expired/inactive paths, idempotent same-user retry, both conflict directions, consumed-code clearing, bulk skip behavior, renewal replacement, and disconnect clearing.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/lib/line`

Expected: failing imports or unmet expected link results before implementation.

- [ ] **Step 3: Implement minimal pure services with injected Sheets/audit dependencies**

Use `randomBytes(5).toString("hex").toUpperCase()`, normalize codes to uppercase, compare active code expiry against supplied `now`, and write only safe audit metadata (client ID, status, event ID, masked user suffix). Link success clears code/message/error; conflict marks the target `REVIEW`; no different user mapping is overwritten.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/lib/line`

Expected: all line-domain tests pass with no external HTTP or Sheets access.

- [ ] **Step 5: Commit**

`git add src/lib/line && git commit -m "feat: add LINE link domain services"`

### Task 3: Add encrypted integration-secret storage and credential resolution

**Files:**
- Create: `src/lib/secrets/types.ts`, `src/lib/secrets/crypto.ts`, `src/lib/secrets/repository.ts`, `src/lib/secrets/service.ts`
- Create: `src/lib/secrets/crypto.test.ts`, `src/lib/secrets/repository.test.ts`, `src/lib/secrets/service.test.ts`
- Modify: `src/lib/config.ts`, `src/lib/config.test.ts`, `.env.example`

**Interfaces:**
- Produces `encryptSecret({ keyName, plaintext })`, `decryptSecret({ keyName, record })`, `getSecret`, `setSecret`, and metadata-only secret reads.
- Produces `getLineCredentials(): Promise<{ channelAccessToken: string; channelSecret: string }>` and narrow access-token/secret resolvers.

- [ ] **Step 1: Write failing encryption and resolver tests**

Use a base64 32-byte test key. Test GCM round-trip, fresh IVs, AAD swap failure, corrupted auth-tag failure, malformed key error, ciphertext-only persistence, metadata without plaintext, partial replacement, encrypted-over-env precedence, and fallback when encrypted records are absent.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/lib/secrets src/lib/config.test.ts`

Expected: missing secret modules/config resolver failures.

- [ ] **Step 3: Implement the secret boundary**

Create/maintain `Integration Secrets!A:K` with `line_channel_access_token` and `line_channel_secret` rows. Decode exactly 32 key bytes, generate a fresh 12-byte IV per AES-256-GCM write, bind `keyName` as AAD, persist base64 ciphertext/IV/tag and safe metadata only, and audit only secret key names. Add optional server-only LINE configuration without adding it to payment-required configuration while linking is disabled.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass and no assertion exposes a plaintext secret.

- [ ] **Step 5: Commit**

`git add src/lib/secrets src/lib/config.ts src/lib/config.test.ts .env.example && git commit -m "feat: add encrypted LINE credential storage"`

### Task 4: Implement authenticated LINE webhook and HTTP adapter

**Files:**
- Create: `src/lib/line/signature.ts`, `src/lib/line/signature.test.ts`, `src/lib/line/client.ts`, `src/lib/line/client.test.ts`, `src/app/api/line/webhook/route.ts`, `src/app/api/line/webhook/route.test.ts`
- Modify: `src/lib/line/linking.ts`, `src/lib/line/linking.test.ts`

**Interfaces:**
- Produces `verifyLineSignature(rawBody, receivedSignature, channelSecret): boolean`.
- Produces LINE profile/reply calls that accept injected `fetch`, authenticate with the resolved access token, and return sanitized failures.

- [ ] **Step 1: Write failing route and adapter tests**

Cover valid/invalid/missing signatures, parse-after-verification ordering, valid empty events, multiple independent events, ignored non-link/group/room/malformed-user events, response messages, correct reply request shape, successful profile display-name persistence, profile failure persistence, and reply failure auditing without rollback.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/lib/line/signature.test.ts src/lib/line/client.test.ts src/app/api/line/webhook/route.test.ts`

Expected: route/modules do not exist or behavior assertions fail.

- [ ] **Step 3: Implement raw-body webhook composition**

Set `runtime = "nodejs"`. Resolve the channel secret server-side, read `request.text()`, reject missing/invalid signatures with `401` before `JSON.parse`, then process every valid event independently. Only direct text `LINK` commands invoke the domain service. Resolve access credentials only when a reply/profile operation is needed; catch reply failure, audit `LINE_LINK_REPLY_FAILED`, and still return `200` for a valid request.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all route and client tests pass with mocked HTTP.

- [ ] **Step 5: Commit**

`git add src/lib/line src/app/api/line && git commit -m "feat: add signed LINE linking webhook"`

### Task 5: Wire trainer workflows through server actions and Apps Script

**Files:**
- Modify: `src/app/admin/(protected)/actions.ts`, `src/app/admin/(protected)/actions.test.ts` (create if absent)
- Modify: `apps-script/Code.gs`, `src/apps-script/Code.test.ts`

**Interfaces:**
- Produces protected `generateMissingLineLinkCodesAction`, `renewLineLinkCodeAction`, and `disconnectLineAction`.
- Apps Script exposes menu callbacks `generateMissingLineLinkCodes`, `renewLineCodeForSelectedClient`, and `disconnectSelectedClientLine`.

- [ ] **Step 1: Write failing protected-action and Apps Script tests**

Assert creation generates a `CODE_ACTIVE` code and rendered message with blank user ID, bulk reports created/already-active/already-linked/failed, selected row guards reject headers/non-Clients rows, renewal replaces a code, and disconnect clears mapping fields while emitting audit events.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/app/admin/'(protected)'/actions.test.ts src/apps-script/Code.test.ts`

Expected: actions/menu callbacks are absent or return old manual-ID behavior.

- [ ] **Step 3: Implement matching creation, bulk, renewal, and disconnect behavior**

Remove LINE user-ID/display-name inputs from normal create paths. Both paths generate the same status, expiry, instruction, and blank-link fields. Add menu items and explicit spreadsheet alerts/status messages; selected-client operations must never silently replace an existing different ID.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all trainer-path tests pass.

- [ ] **Step 5: Commit**

`git add src/app/admin/'(protected)'/actions.ts src/app/admin/'(protected)'/actions.test.ts apps-script/Code.gs src/apps-script/Code.test.ts && git commit -m "feat: add trainer LINE linking actions"`

### Task 6: Add protected admin UI for linking and credentials

**Files:**
- Modify: `src/components/admin/client-form.tsx`, `src/components/admin/client-form.test.ts`, `src/app/admin/(protected)/clients/page.tsx`, `src/app/admin/(protected)/clients/[clientId]/page.tsx`, `src/app/admin/(protected)/settings/page.tsx`
- Create: `src/components/admin/line-link-actions.tsx`, `src/components/admin/line-link-actions.test.ts`, `src/components/admin/line-integration-form.tsx`, `src/components/admin/line-integration-form.test.ts`

**Interfaces:**
- `LineLinkActions` renders status-specific controls and copies the complete pre-rendered instruction with `navigator.clipboard.writeText`.
- `LineIntegrationForm` accepts only new password-type values, renders secret metadata/last four, and never receives decrypted credentials.

- [ ] **Step 1: Write failing component tests**

Verify normal creation has no manual LINE-ID fields; active/link/review/expired states show required controls; copy writes the exact instruction; secret fields are password inputs, blank by default, and no rendered text contains a provided raw secret; metadata state and action outcomes render safely.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/components/admin/client-form.test.ts src/components/admin/line-link-actions.test.ts src/components/admin/line-integration-form.test.ts`

Expected: missing components and old form fields cause test failures.

- [ ] **Step 3: Implement focused UI components and compose existing pages**

Use existing cards/buttons/forms. Put link state/actions on the existing client list/detail pages, including trainer-only copy/renew/disconnect controls. Add a Settings LINE card with metadata-only connection status, fresh password inputs, and Save & Test action; do not create a second admin app or expose tokens/secrets.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all UI tests pass under jsdom.

- [ ] **Step 5: Commit**

`git add src/components/admin src/app/admin/'(protected)' && git commit -m "feat: add LINE linking admin controls"`

### Task 7: Document rollout and run complete validation

**Files:**
- Modify: `README.md`, `.env.example`
- Modify/create: targeted tests where integration findings expose uncovered behavior

- [ ] **Step 1: Write any final failing regression test required by integration gaps**

Name the concrete break first, reproduce it in the narrowest existing suite, and confirm it fails for the expected behavior gap.

- [ ] **Step 2: Implement only the minimal integration fix and run the focused test**

Keep the implementation within Issue #3 scope and retain all secret and webhook invariants.

- [ ] **Step 3: Document exact deployment and recovery steps**

Document `SETTINGS_ENCRYPTION_KEY` generation/recovery, dashboard-first credential entry, optional legacy env fallback, production webhook URL setup, LINE Verify/Use webhook sequence, test-client validation, and roster bulk-code rollout.

- [ ] **Step 4: Run full verification**

Run: `npm test && npm run lint && npm run build`

Expected: all suites, lint, and production build complete successfully.

- [ ] **Step 5: Commit**

`git add README.md .env.example src && git commit -m "docs: document LINE linking rollout"`

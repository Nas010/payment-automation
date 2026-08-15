# Local Development Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every dashboard flow with synthetic local data and no path to production services or data.

**Architecture:** Start Next from a clean generated project copy, because Next automatically loads a root `.env.local`. In that copy, a server-only `LOCAL_DASHBOARD_MODE` selects filesystem-backed Google Sheets/Drive/LINE/OCR emulators. Existing pages and business rules remain the UI and behavior surface.

**Tech Stack:** Next.js 15, TypeScript, Vitest, Node filesystem, existing workbook record contracts.

## Global Constraints

- Never read, copy, print, or forward `.env.local`.
- Never copy production rows, credentials, OAuth tokens, Drive files, or customer data.
- Keep local state below copied app's `.local-dev/` directory.
- Reject Vercel markers, production origins, and configured Google/LINE credentials before provider initialization.
- Preserve production behavior when `LOCAL_DASHBOARD_MODE` is absent.

---

### Task 1: Isolated launcher and guardrails

**Files:**
- Create: `scripts/dev-local.ts`, `scripts/dev-local.test.ts`, `.env.local-dashboard`
- Modify: `package.json`, `.gitignore`, `src/lib/config.ts`, `src/lib/config.test.ts`

**Interfaces:**

```ts
export function assertLocalDashboardEnvironment(environment: Record<string, string | undefined>): void;
export const LOCAL_APP_DIRECTORY = ".local-dev/app";
```

- [ ] **Step 1: Write failing tests**

```ts
it("rejects provider config and Vercel markers in local mode", () => {
  expect(() => assertLocalDashboardEnvironment({ LOCAL_DASHBOARD_MODE: "1", VERCEL: "1" }))
    .toThrow("Local dashboard mode cannot run in a Vercel environment");
  expect(() => assertLocalDashboardEnvironment({ LOCAL_DASHBOARD_MODE: "1", GOOGLE_SERVICE_ACCOUNT_JSON: "configured" }))
    .toThrow("Local dashboard mode cannot use external provider credentials");
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/lib/config.test.ts`

Expected: FAIL because guard absent.

- [ ] **Step 3: Implement launcher**

Add `dev:local` and `local:reset`. Launcher copies source/config into `.local-dev/app`, excluding `.env*`, `.git`, `node_modules`, `.next*`, and `.local-dev`; starts `next dev` there with only `.env.local-dashboard` values. Validate all reset/delete targets before removal. Ignore `.local-dev/`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run scripts/dev-local.test.ts src/lib/config.test.ts`

Expected: PASS; copy test proves no `.env.local` appears or is forwarded.

```bash
git add package.json .gitignore .env.local-dashboard scripts/dev-local.ts scripts/dev-local.test.ts src/lib/config.ts src/lib/config.test.ts
git commit -m "feat: add isolated local dashboard launcher"
```

### Task 2: Local context, identity, visual boundary, fixtures

**Files:**
- Create: `src/lib/local-dashboard/environment.ts`, `src/lib/local-dashboard/environment.test.ts`, `src/lib/local-dashboard/fixtures.ts`
- Create: `src/components/admin/local-dashboard-banner.tsx`, `src/components/admin/local-dashboard-banner.test.tsx`
- Modify: `src/lib/admin-auth.ts`, `src/lib/admin-auth.test.ts`, `src/app/admin/(protected)/layout.tsx`

**Interfaces:**

```ts
export const LOCAL_OWNER = { sub: "local-dashboard-owner", email: "local-owner@example.test" };
export function isLocalDashboardMode(environment?: Record<string, string | undefined>): boolean;
export function localStateRoot(): string;
```

- [ ] **Step 1: Write failing tests**

```tsx
it("uses only fixed synthetic owner in local mode", async () => {
  await expect(requireAdmin()).resolves.toMatchObject(LOCAL_OWNER);
});
it("marks protected pages as local-only", () => {
  expect(render(<LocalDashboardBanner />).getByText(/local dashboard/i)).toBeVisible();
});
```

- [ ] **Step 2: Run red tests**

Run: `npx vitest run src/lib/admin-auth.test.ts src/components/admin/local-dashboard-banner.test.tsx`

Expected: FAIL because local identity/banner absent.

- [ ] **Step 3: Implement**

Use `server-only`; resolve/validate local root; make `requireAdmin` return `LOCAL_OWNER` only after guard succeeds. Render a persistent non-dismissible banner. Seed only fake clients covering active, overdue, review, confirmed, recurring, LINE-linked, and unlinked states.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/local-dashboard/environment.test.ts src/lib/admin-auth.test.ts src/components/admin/local-dashboard-banner.test.tsx`

Expected: PASS, including normal-mode auth tests.

### Task 3: Filesystem workbook and Sheets-v4 emulator

**Files:**
- Create: `src/lib/local-dashboard/store.ts`, `src/lib/local-dashboard/store.test.ts`, `src/lib/local-dashboard/sheets.ts`, `src/lib/local-dashboard/sheets.test.ts`
- Modify: `src/lib/sheets/client.ts`, `src/lib/sheets/bootstrap-client.ts`

**Interfaces:**

```ts
export type LocalWorkbook = { version: 1; workbooks: Record<string, { title: string; sheets: LocalSheet[] }> };
export async function readLocalWorkbook(): Promise<LocalWorkbook>;
export async function mutateLocalWorkbook<T>(change: (workbook: LocalWorkbook) => T): Promise<T>;
export function createLocalSheets(): sheets_v4.Sheets;
```

- [ ] **Step 1: Write failing emulator contract**

```ts
it("round-trips operational headers and rows through values APIs", async () => {
  const sheets = createLocalSheets();
  await sheets.spreadsheets.values.update({ spreadsheetId: LOCAL_OPERATIONAL_WORKBOOK_ID, range: "Clients!A2:B2", valueInputOption: "RAW", requestBody: { values: [["client_1", "TRUE"]] } });
  await expect(sheets.spreadsheets.values.get({ spreadsheetId: LOCAL_OPERATIONAL_WORKBOOK_ID, range: "Clients!A1:B2" }))
    .resolves.toMatchObject({ data: { values: [[...CLIENT_HEADERS.slice(0, 2)], ["client_1", "TRUE"]] } });
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/lib/local-dashboard/store.test.ts src/lib/local-dashboard/sheets.test.ts`

Expected: FAIL because emulator absent.

- [ ] **Step 3: Implement exact used API surface**

Seed installation/secrets plus operational tabs from `CLIENT_HEADERS`, `SCHEDULE_HEADERS`, `PAYMENT_HEADERS`, and `AUDIT_HEADERS`. Implement only current calls: `spreadsheets.get/create/batchUpdate` and `values.get/update/append/batchGet/batchUpdate`, including named ranges and appended columns. Parse current A1 ranges and atomically persist temp-file then rename.

- [ ] **Step 4: Wire existing entry points and verify**

Use local sheets from `getGoogleSheets`, `getPendingGoogleSheets`, and `getBootstrapSheets` only in local mode.

Run: `npx vitest run src/lib/local-dashboard/store.test.ts src/lib/local-dashboard/sheets.test.ts src/lib/sheets/clients.test.ts src/lib/sheets/payments.test.ts src/lib/sheets/schedules.test.ts src/lib/sheets/settings.test.ts src/lib/installation/repository.test.ts src/lib/secrets/repository.test.ts`

Expected: PASS.

### Task 4: Local Drive, setup, and Google OAuth simulator

**Files:**
- Create: `src/lib/local-dashboard/drive.ts`, `src/lib/local-dashboard/drive.test.ts`
- Modify: `src/lib/storage/drive-client.ts`, `src/lib/storage/google-drive-auth.ts`, `src/app/admin/google-drive/connect/route.ts`, `src/app/admin/google-drive/callback/route.ts`, `src/app/admin/google-drive/picker-token/route.ts`

- [ ] **Step 1: Write failing test**

```ts
it("stores a slip locally without constructing Google OAuth", async () => {
  await createDriveSlipFile({ folderId: LOCAL_FOLDER_ID, paymentId: "payment_1", bytes: new Uint8Array([1]), mimeType: "image/png", imageHash: "hash" });
  expect(createGoogleDriveOAuthClient).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/lib/local-dashboard/drive.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement and verify**

Implement `files.create/get/delete` with local UUID metadata and bytes. Local connect/callback/picker stages synthetic owner authorization/folder selection without external redirect. Production code path remains untouched.

Run: `npx vitest run src/lib/local-dashboard/drive.test.ts src/lib/workspace/workbook.test.ts src/lib/workspace/setup.test.ts src/app/admin/google-drive/actions.test.ts src/app/api/admin/slips/'[paymentId]'/route.test.ts`

Expected: PASS.

### Task 5: Local LINE, LIFF, and OCR adapters

**Files:**
- Create: `src/lib/local-dashboard/line.ts`, `src/lib/local-dashboard/line.test.ts`, `src/lib/local-dashboard/ocr.ts`
- Modify: `src/lib/line/client.ts`, `src/lib/line/liff-verification.ts`, `src/lib/slip/analyze.ts`, `src/app/admin/(protected)/settings/line-actions.ts`

- [ ] **Step 1: Write failing no-network test**

```ts
it("records accepted simulated LINE send without fetch", async () => {
  await expect(sendLinePushMessage(localPushInput)).resolves.toMatchObject({ accepted: true, requestId: expect.stringMatching(/^local-line-/) });
  expect(fetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/lib/local-dashboard/line.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement and verify**

Return deterministic profile, LIFF identity, message, OCR, and slip results. Every integration simulation appends explicit `LOCAL_SIMULATION` audit metadata. Preserve normal-mode HTTP behavior.

Run: `npx vitest run src/lib/local-dashboard/line.test.ts src/lib/line/client.test.ts src/lib/line/liff-verification.test.ts src/app/api/line/webhook/route.test.ts src/app/api/payment/'[token]'/submit/route.test.ts src/app/admin/'(protected)'/settings/line-actions.test.ts`

Expected: PASS.

### Task 6: Full local flow, docs, and verification

**Files:**
- Create: `src/lib/local-dashboard/full-flow.test.ts`
- Modify: `README.md`, `.env.example`

- [ ] **Step 1: Write failing complete-flow test**

```ts
it("creates client, generates payment, submits simulated slip, saves settings, and persists local audit", async () => {
  await resetLocalDashboard();
  // Invoke existing actions/routes through local provider boundaries.
  expect((await listAuditRecords()).some((entry) => entry.source === "LOCAL_SIMULATION")).toBe(true);
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run src/lib/local-dashboard/full-flow.test.ts`

Expected: FAIL until all boundaries are wired.

- [ ] **Step 3: Document and prove behavior**

Document `npm run dev:local`, reset, fixtures, URL, and that simulated results never prove provider delivery. State `npm run dev` may load `.env.local` and is not isolated.

Run: `npm run lint && npm test && npm run build`

Expected: exit 0.

- [ ] **Step 4: Manual local check and commit**

Run: `npm run dev:local`

Open `/admin/dashboard`; confirm synthetic owner, banner, populated data, client/payment/settings writes, local file upload, and no `.env.local` in spawned copy.

```bash
git add README.md .env.example src/lib/local-dashboard src/lib src/app src/components scripts package.json .gitignore
git commit -m "feat: add isolated local dashboard"
```

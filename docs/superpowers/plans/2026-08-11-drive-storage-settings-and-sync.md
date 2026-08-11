# Drive Storage Settings and Repository Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore PR #6 LINE chat-slip intake to the combined application, add trainer-controlled Google Drive folder switching in protected Settings, synchronize local/GitHub main, and deploy the verified main commit.

**Architecture:** Build on `codex/drive-settings-sync`, which starts from the branch already combining PR #6 and existing-client billing. Add a pure folder parser/resolver, a narrow Drive metadata adapter, and a protected Settings action/component; workbook operational setting wins over legacy environment fallback. Preserve detached-checkout admin cleanup in its own commit, then publish, merge, synchronize, and deploy one verified integration branch.

**Tech Stack:** Next.js 15 App Router, strict TypeScript, React 19, Vitest, Google Sheets API, Google Drive API through `googleapis`, Vercel, GitHub.

## Global Constraints

- Google Sheets remains the system of record.
- Google service-account JSON remains environment-only and never reaches React props, HTML, logs, audit metadata, or operational settings.
- No Google OAuth, refresh tokens, Drive picker, marker-file upload, or existing-slip migration.
- Workbook `slip_storage_folder_id` overrides legacy `SLIP_STORAGE_FOLDER_ID`; environment remains recovery fallback.
- Failed Drive validation never replaces the active folder.
- Existing slip URLs remain unchanged; only new retained slips use the new folder.
- PR #6 LINE intake and website upload must remain behaviorally intact.
- Preserve every current detached-checkout file; no reset, checkout overwrite, or destructive cleanup.
- Tests mock Google/LINE/storage boundaries; no unit test contacts live services.
- Do not submit a real payment/slip during deployment verification without separate explicit authorization.

---

## File Structure

- Create `src/lib/storage/drive-folder.ts`: folder input parsing, service-account identity, source precedence, asynchronous setting/environment resolver.
- Create `src/lib/storage/drive-folder.test.ts`: pure parser/precedence and mocked Settings-read behaviors.
- Create `src/lib/storage/drive-client.ts`: sanitized Google Drive folder validation and shared authenticated client construction.
- Create `src/lib/storage/drive-client.test.ts`: writable/missing/non-folder/trashed/read-only/malformed-config behaviors.
- Modify `src/lib/storage/slip.ts` and test: resolve active folder at upload time.
- Modify `src/lib/config.ts` and test: folder stops being environment-only bootstrap configuration.
- Modify `src/app/api/health/route.ts` and create/update test: readiness accepts workbook or environment folder.
- Modify `src/lib/sheets/settings.ts` and test: atomic multi-setting upsert.
- Create `src/app/admin/(protected)/settings/drive-actions.ts` and test: protected Save & Test workflow.
- Create `src/components/admin/drive-storage-form.tsx` and test: trainer connection/switching UI.
- Modify `src/app/admin/(protected)/settings/page.tsx`: compose Drive card and hide reserved keys.
- Preserve current detached admin cleanup and plan files in a separate commit after conflict-safe inspection.
- Modify `README.md` and `.env.example`: dashboard-first Drive setup, fallback, rollout, and recovery.

---

### Task 1: Add folder parsing, resolution, and readiness

**Files:**
- Create: `src/lib/storage/drive-folder.ts`
- Create: `src/lib/storage/drive-folder.test.ts`
- Modify: `src/lib/config.ts`
- Modify: `src/lib/config.test.ts`
- Modify: `src/app/api/health/route.ts`
- Create: `src/app/api/health/route.test.ts`

**Interfaces:**
- Produces `SLIP_STORAGE_FOLDER_SETTING = "slip_storage_folder_id"` and `SLIP_STORAGE_VALIDATION_SETTING = "slip_storage_validation"`.
- Produces `parseDriveFolderId(value: string): string`.
- Produces `serviceAccountEmail(serviceAccountJson: string): string`.
- Produces `selectSlipStorageFolderId(settings, environment): { folderId: string; source: "workbook" | "environment" } | null`.
- Produces `getSlipStorageFolder(dependencies?): Promise<{ folderId: string; source: "workbook" | "environment" }>`.

- [ ] **Step 1: Write parser and precedence tests**

Add literal cases:

```ts
expect(parseDriveFolderId("11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD")).toBe("11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD");
expect(parseDriveFolderId("https://drive.google.com/drive/folders/11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD?usp=sharing")).toBe("11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD");
expect(() => parseDriveFolderId("https://example.com/drive/folders/abc1234567")).toThrow("Invalid Google Drive folder URL or ID.");
expect(() => parseDriveFolderId("https://drive.google.com/file/d/11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD/view")).toThrow("Invalid Google Drive folder URL or ID.");
expect(selectSlipStorageFolderId([{ key: "slip_storage_folder_id", value: "workbook-folder" }], { SLIP_STORAGE_FOLDER_ID: "environment-folder" })).toEqual({ folderId: "workbook-folder", source: "workbook" });
expect(selectSlipStorageFolderId([], { SLIP_STORAGE_FOLDER_ID: "environment-folder" })).toEqual({ folderId: "environment-folder", source: "environment" });
```

Mock only `listOperationalSettings` for asynchronous resolver tests. Prove a Settings-read failure falls back to valid environment value and neither source throws `Slip storage folder is not configured.`

- [ ] **Step 2: Run RED tests**

Run:

```bash
npm test -- src/lib/storage/drive-folder.test.ts src/lib/config.test.ts src/app/api/health/route.test.ts
```

Expected: missing module/exports and old environment-only readiness assertions fail.

- [ ] **Step 3: Implement minimal folder domain**

Use Drive ID pattern `/^[A-Za-z0-9_-]{10,}$/`. For URLs require protocol `https:`, hostname `drive.google.com`, and exact path shape `/drive/folders/<id>`. Parse service account JSON and require a syntactically valid nonblank `client_email`.

Change bootstrap configuration to:

```ts
const required = ["SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON", "PROMPTPAY_IDENTIFIER", "RECIPIENT_NAME_EN"];
```

Keep legacy environment folder available through the asynchronous resolver. Update health to append `SLIP_STORAGE_FOLDER_ID` only when bootstrap config passes but folder resolution fails.

- [ ] **Step 4: Run GREEN tests**

Run Step 2 command. Expected: all focused tests pass with no network calls.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/drive-folder.ts src/lib/storage/drive-folder.test.ts src/lib/config.ts src/lib/config.test.ts src/app/api/health/route.ts src/app/api/health/route.test.ts
git commit -m "feat: resolve Drive slip folder settings"
```

---

### Task 2: Validate Drive folders and use active folder for retained slips

**Files:**
- Create: `src/lib/storage/drive-client.ts`
- Create: `src/lib/storage/drive-client.test.ts`
- Modify: `src/lib/storage/slip.ts`
- Modify: `src/lib/storage/slip.test.ts`

**Interfaces:**
- Produces `validateDriveFolder(folderId, dependencies?): Promise<{ folderId: string; folderName: string; validatedAt: string }>`.
- Produces internal authenticated Drive construction from `GOOGLE_SERVICE_ACCOUNT_JSON` with `drive.file` scope.
- `storeExceptionSlip(input, dependencies?)` consumes asynchronous folder resolution and uploads to that exact parent.

- [ ] **Step 1: Write Drive validation RED tests**

Use injected metadata lookup returning full relevant shape:

```ts
{
  id: "folder-12345",
  name: "Private payment slips",
  mimeType: "application/vnd.google-apps.folder",
  trashed: false,
  capabilities: { canAddChildren: true },
}
```

Assert writable success plus exact stable errors for not-found/unshared, non-folder, trashed, read-only, malformed service-account config, and sanitized unknown Google failure. Assert metadata request includes `supportsAllDrives: true` and fields `id,name,mimeType,trashed,capabilities(canAddChildren)`.

- [ ] **Step 2: Write storage-resolution RED tests**

Inject folder resolution and Drive file creation. Assert request parent equals resolved workbook folder and returned URL uses created file ID. Assert no folder ID from `serverConfig()` is read.

- [ ] **Step 3: Run RED tests**

Run:

```bash
npm test -- src/lib/storage/drive-client.test.ts src/lib/storage/slip.test.ts
```

Expected: Drive adapter missing and current storage uses environment-only `serverConfig()`.

- [ ] **Step 4: Implement adapter and storage refactor**

Map errors without copying Google bodies. Keep `shouldRetainSlip` unchanged. Make upload dependencies explicit enough for tests while default path uses the real Google client and `getSlipStorageFolder()`.

- [ ] **Step 5: Run GREEN tests**

Run Step 3 command plus:

```bash
npm test -- src/lib/slip/process.test.ts src/app/api/payment/'[token]'/submit/route.test.ts src/lib/line/slip-payments.test.ts
```

Expected: storage tests and both transport regressions pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage
git commit -m "feat: validate Drive slip storage"
```

---

### Task 3: Add atomic Settings action and trainer Drive card

**Files:**
- Modify: `src/lib/sheets/settings.ts`
- Create or modify: `src/lib/sheets/settings.test.ts`
- Create: `src/app/admin/(protected)/settings/drive-actions.ts`
- Create: `src/app/admin/(protected)/settings/drive-actions.test.ts`
- Create: `src/components/admin/drive-storage-form.tsx`
- Create: `src/components/admin/drive-storage-form.test.ts`
- Modify: `src/app/admin/(protected)/settings/page.tsx`

**Interfaces:**
- Produces `upsertOperationalSettings(entries: Array<{ key: string; value: string }>): Promise<void>` using one Sheets batch update after one read.
- Produces `DriveStorageActionResult = { ok: boolean; status: "VALID" | "FAILED"; message: string; folderName?: string; validatedAt: string }`.
- Produces protected `saveAndTestDriveFolderAction(formData): Promise<DriveStorageActionResult>`.
- Produces `DriveStorageForm` with service-account email, active source/metadata, copy control, folder input, and Save & Test.

- [ ] **Step 1: Write atomic repository RED test**

Given one existing setting and one new setting, assert one `values.batchUpdate` request writes exact A:B row ranges and preserves unrelated rows. Make existing `upsertOperationalSetting` delegate to the multi-entry API.

- [ ] **Step 2: Write protected action RED tests**

Mock admin auth and external Drive validation only. Success must batch-write:

```ts
[
  { key: "slip_storage_folder_id", value: "folder-12345" },
  { key: "slip_storage_validation", value: JSON.stringify({ status: "VALID", folderName: "Private payment slips", validatedAt: "2026-08-11T12:00:00.000Z" }) },
]
```

Assert audit action `DRIVE_STORAGE_UPDATED` contains setting key/source/timestamp but no folder ID/URL. Failure must return stable text and never call settings upsert. Unauthenticated call must fail before Drive lookup.

- [ ] **Step 3: Write Drive component RED tests**

Use jsdom. Assert service-account email is rendered and copied with `navigator.clipboard.writeText`, folder input starts blank, source and active name render, Save & Test returns success/failure feedback, form resets only on success, and no private-key fixture appears in rendered HTML.

- [ ] **Step 4: Run RED tests**

Run:

```bash
npm test -- src/lib/sheets/settings.test.ts src/app/admin/'(protected)'/settings/drive-actions.test.ts src/components/admin/drive-storage-form.test.ts
```

Expected: missing APIs/components/actions fail.

- [ ] **Step 5: Implement minimal repository, action, and UI**

Keep Drive action in `drive-actions.ts`, separate from LINE actions. Use reserved setting keys from `drive-folder.ts`. `SettingsPage` derives active source from already-loaded settings/environment, parses stored validation metadata safely, renders `DriveStorageForm`, and hides reserved Drive keys from generic table.

- [ ] **Step 6: Run GREEN tests**

Run Step 4 command plus:

```bash
npm test -- src/app/admin/'(protected)'/settings src/components/admin/line-integration-form.test.ts src/components/admin/line-due-template-form.test.ts
```

Expected: Drive and existing Settings behavior pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sheets/settings.ts src/lib/sheets/settings.test.ts src/app/admin/'(protected)'/settings src/components/admin/drive-storage-form.tsx src/components/admin/drive-storage-form.test.ts
git commit -m "feat: connect Drive storage from settings"
```

---

### Task 4: Preserve detached admin work and document rollout

**Files:**
- Preserve from detached checkout: `src/app/admin/(protected)/clients/page.tsx`, `src/app/admin/(protected)/dashboard/page.tsx`, `src/components/admin/admin-shell.test.ts`, `src/components/admin/admin-shell.tsx`, `src/components/admin/page-ui.tsx`, `src/components/ui/sidebar.tsx`, `src/lib/admin/client-display.ts`, `src/lib/admin/client-display.test.ts`.
- Preserve plan docs: `docs/superpowers/plans/2026-08-11-admin-annotation-cleanup.md`, `docs/superpowers/plans/2026-08-11-existing-client-billing.md`.
- Modify: `README.md`, `.env.example`.

**Interfaces:**
- No new production API beyond already-tested admin display helpers.
- Documentation explains dashboard folder switching, Editor sharing, environment fallback, and recovery.

- [ ] **Step 1: Inspect detached work before preservation**

Run its focused tests and diff. Confirm every uncommitted file belongs to admin annotation cleanup or plan documentation. If unrelated content appears, preserve it in a separate commit rather than dropping it.

- [ ] **Step 2: Commit detached work without rewriting it**

Stage only inspected files in the detached checkout and commit `fix: simplify admin page annotations`. Stage plan-only files separately if needed and commit `docs: preserve implementation plans`.

- [ ] **Step 3: Cherry-pick preservation commit(s) into integration branch**

Resolve conflicts by retaining both PR #6/billing behavior and admin cleanup. Never use `git checkout --`, `git reset`, or bulk overwrite.

- [ ] **Step 4: Run focused merged tests**

```bash
npm test -- src/components/admin/admin-shell.test.ts src/lib/admin/client-display.test.ts src/app/admin/'(protected)'/payments src/app/api/line/webhook/route.test.ts
```

Expected: admin cleanup and PR #6 LINE intake both pass.

- [ ] **Step 5: Update rollout docs**

Document service-account email sharing, Settings Save & Test, successful switching semantics, failed-switch preservation, environment fallback, and production verification. Remove wording that says folder changes require Vercel environment edits.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md .env.example
git commit -m "docs: document Drive settings rollout"
```

---

### Task 5: Verify, publish, merge, synchronize, and deploy

**Files:**
- No planned source additions. Fix only concrete failures exposed by verification, with a failing regression test first for behavior changes.

- [ ] **Step 1: Verify worktree and diff hygiene**

Run `git status --short`, `git diff --check`, and inspect `git diff origin/main...HEAD --stat`. Confirm no secrets, environment files, generated artifacts, or unrelated deletions.

- [ ] **Step 2: Run full local verification**

Run in order:

```bash
npm run lint
npm test
npm run build
```

Expected: zero lint errors, all Vitest tests pass, production build exits 0.

- [ ] **Step 3: Push and open ready PR**

Push `codex/drive-settings-sync`, create a ready PR against `main`, and summarize PR #6 restoration, billing/admin preservation, Drive Settings behavior, tests, and config impact.

- [ ] **Step 4: Confirm CI and merge**

Wait for required GitHub checks. If any fail, inspect exact logs, reproduce locally, add a regression test when behavior changes, fix minimally, repush, and wait again. Merge only after checks pass.

- [ ] **Step 5: Synchronize local and GitHub main**

Fetch origin. In the dedicated local-main worktree, fast-forward `main` to `origin/main`. Confirm:

```bash
git rev-parse main
git rev-parse origin/main
```

Expected: identical commit hashes. Preserve the original detached checkout until all its changes are confirmed in merged main.

- [ ] **Step 6: Deploy exact merged commit**

Determine repository deployment mechanism from local Vercel project metadata and GitHub deployment/check state. If main auto-deploys, wait for production deployment of merged SHA. Otherwise deploy that SHA using the configured project CLI. Do not expose environment values in output.

- [ ] **Step 7: Verify production safely**

Confirm production health reports ready and deployed revision matches merged main when revision metadata is available. Use protected/read-only Drive validation; do not upload a real slip or alter a payment. Confirm PR #6 LINE chat intake code is present in deployed artifact/config, while live chat payment execution remains governed by existing feature flags.

- [ ] **Step 8: Final state audit**

Report merged PR, deployed commit, local/GitHub hash equality, tests/build counts, Drive connection status, remaining trainer action (sharing/selecting a folder if not yet done), and any feature flags still intentionally disabled.

# Drive Storage Settings and Repository Sync Design

## Goal

Restore already-merged LINE payment-slip intake to active development and production, preserve all current billing/admin work, and let a trainer switch the private Google Drive exception-slip folder from protected Settings without editing deployment environment variables.

## Current State

- GitHub PR #6 (`2491fb8`, Issue #4) already implements LINE due-payment delivery and chat-slip intake.
- Current detached checkout forked before PR #6 and therefore ignores LINE image messages.
- `agent/existing-client-billing` already combines PR #6 with existing-client billing.
- Current detached checkout also has uncommitted admin-annotation cleanup. Those files belong to the user and must be preserved.
- Slip storage currently reads `SLIP_STORAGE_FOLDER_ID` only from deployment environment. Current configured folder is unreachable to the service account.

## Scope

### Included

- Build on the combined PR #6 + billing branch.
- Preserve and publish current admin-annotation cleanup as a separate logical change.
- Add a protected Drive storage card to `/admin/settings`.
- Display the configured Google service-account email so the trainer knows which account needs Editor access.
- Accept either a Google Drive folder URL or raw folder ID.
- Validate folder access before activating a new folder.
- Store the active folder ID as a non-secret workbook operational setting.
- Prefer the workbook setting at runtime and retain `SLIP_STORAGE_FOLDER_ID` as a legacy/environment fallback.
- Make readiness checks accept either a validated workbook folder setting or environment fallback.
- Push, review, merge, deploy, and verify the merged commit in production.

### Excluded

- Google OAuth, consent screens, refresh tokens, or a Drive picker.
- Editing `GOOGLE_SERVICE_ACCOUNT_JSON` from the dashboard.
- Moving or deleting slips stored in an older folder.
- Changing QR/OCR evaluation rules or claiming bank verification.
- Sending a real payment request or mutating a real payment during deployment verification without separate explicit authorization.

## Repository Synchronization

`codex/drive-settings-sync` starts from `agent/existing-client-billing`, which contains both GitHub PR #6 and billing work. Current detached-checkout changes are inspected, preserved, and applied as their own commit rather than overwriting either version.

After implementation:

1. Run focused tests for Drive settings, storage, health, and Settings UI.
2. Run `npm run lint`, `npm test`, and `npm run build` from the integration branch.
3. Push the branch and open a ready pull request against `main`.
4. Confirm CI, merge the pull request, then fetch and fast-forward local `main` to `origin/main`.
5. Confirm the local main commit equals GitHub main.
6. Deploy that exact main commit to production, or confirm the repository's automatic production deployment selected it.
7. Verify deployed health and read-only Drive connection status. Do not submit a real slip during rollout verification without separate authorization.

No uncommitted file is discarded, reset, or silently folded into an unrelated commit.

## Drive Connection Model

The existing Google service account remains the only Google identity. Trainer workflow:

1. Open protected Settings.
2. Copy the displayed service-account email.
3. Share the desired Drive folder with that email as Editor.
4. Paste the folder URL or raw ID.
5. Click **Save & Test**.

The server parses the folder ID, authenticates with the existing service-account JSON, and requests folder metadata using Drive API scope `drive.file` with shared-drive support enabled. Validation succeeds only when:

- the object exists and is visible to the service account;
- MIME type is `application/vnd.google-apps.folder`;
- the folder is not trashed; and
- `capabilities.canAddChildren` is `true`.

The test does not upload or delete a marker file. Drive capability metadata provides the write-permission check without creating external artifacts.

## Settings and Runtime Data

Two workbook operational settings are reserved:

- `slip_storage_folder_id`: active validated folder ID.
- `slip_storage_validation`: JSON metadata for the active folder containing `status: "VALID"`, `folderName`, and `validatedAt`.

Folder ID is operational configuration, not a secret. It may be stored in the protected workbook. Service-account private-key material remains environment-only and never reaches React props, HTML, logs, audit metadata, or operational settings.

Folder resolution uses this precedence:

1. nonblank workbook `slip_storage_folder_id`;
2. nonblank, non-`CONFIG_REQUIRED` environment `SLIP_STORAGE_FOLDER_ID`;
3. configuration error.

If the Settings sheet cannot be read, runtime may fall back to the configured environment folder. A successful workbook setting therefore supports easy switching while the environment value remains a recovery path.

`requiredConfiguration()` stops treating an environment-only folder ID as a bootstrap requirement. The health route remains asynchronous and reports storage ready when either source resolves. Missing storage is reported as `SLIP_STORAGE_FOLDER_ID` for compatibility with existing operational checks.

`storeExceptionSlip()` resolves the folder at call time. New REVIEW/FLAGGED slips use the newly active folder immediately. Existing `slip_url` values remain unchanged and continue pointing at their original Drive files.

## Server Components

### Folder parsing

Create a pure parser that accepts:

- a raw Drive ID containing letters, digits, `_`, or `-`;
- `https://drive.google.com/drive/folders/<id>`; or
- the same folder URL with query parameters.

Reject empty values, non-Drive URLs, file URLs, traversal-like content, and IDs shorter than ten characters.

### Drive adapter

Create a focused server-only module that:

- extracts the service-account email safely;
- creates the Drive client from existing credentials;
- validates folder metadata;
- returns sanitized `{ folderId, folderName, validatedAt }` results; and
- throws stable local error messages without returning Google response bodies.

Google API construction remains behind an injectable boundary so unit tests never contact live services.

### Storage configuration resolver

Create an asynchronous resolver shared by health checks, Settings metadata, and `storeExceptionSlip()`. The resolver reads operational settings first, then environment fallback. It does not mutate Sheets.

### Protected server action

Add `saveAndTestDriveFolderAction(formData)` beside existing protected Settings actions. It must:

1. require an authenticated admin;
2. parse and validate the submitted folder;
3. call the Drive adapter;
4. write `slip_storage_folder_id` and `slip_storage_validation` only after validation succeeds;
5. append `DRIVE_STORAGE_UPDATED` audit metadata containing only setting key, source, and validation timestamp;
6. revalidate `/admin/settings`; and
7. return a sanitized success/failure result.

A failed attempt does not change either active setting. It may append `DRIVE_STORAGE_TEST_FAILED` with no folder ID, URL, Google body, or credential data.

## Admin UI

Add a focused `DriveStorageForm` card near LINE integration:

- title: **Google Drive slip storage**;
- service-account email with copy control;
- short instruction to share the folder as Editor;
- folder URL/ID input, blank by default;
- **Save & Test** button;
- source label: Workbook, Environment fallback, or Not configured;
- active folder name and last validated timestamp when available; and
- explicit success/failure feedback.

Blank submission is rejected; it never means “keep current value.” Switching requires a new explicit valid folder. The generic operational-settings table hides the two reserved Drive keys to avoid duplicate editing paths.

## Error Handling

- Invalid input: return `Invalid Google Drive folder URL or ID.`
- Folder absent/unshared: return `Folder not found. Share it with the service-account email and try again.`
- Non-folder object: return `Selected Drive item is not a folder.`
- Trashed folder: return `Selected Drive folder is in trash.`
- Read-only folder: return `Service account needs Editor access to this folder.`
- Malformed service-account config: return `Google service account is not configured correctly.`
- Other Google/network failure: return `Could not validate Google Drive folder. Try again.`

Raw Google errors, folder IDs, service-account JSON, and private slip data never enter client-facing errors or audits.

## Testing

Tests follow red-green-refactor and mock all Google boundaries.

- Parser tests: raw ID, folder URL, query parameters, invalid host, file URL, malformed ID.
- Drive adapter tests: valid writable folder, missing folder, non-folder, trashed, read-only, malformed credentials, sanitized remote failure.
- Resolver tests: workbook precedence, environment fallback, missing configuration, Settings-read failure fallback.
- Storage tests: resolved folder used for upload; environment fallback retained; existing retention behavior unchanged.
- Action tests: admin required, success writes both settings and safe audit, failure preserves current settings, no sensitive metadata.
- UI tests: email displayed, copy works, password/private-key data absent, source/status rendered, submit outcomes clear.
- Health tests: workbook setting or environment fallback satisfies readiness; neither reports missing storage.
- Regression tests: PR #6 LINE image intake remains enabled by code when feature flags are configured, and existing website upload behavior remains intact.
- Final verification: lint, full Vitest suite, production build, GitHub CI, deployed health, and read-only Drive folder validation.

## Acceptance Criteria

- LINE image handling from PR #6 exists in merged production code.
- Local `main`, `origin/main`, and deployed production identify the same merged commit.
- No current local change is lost.
- Trainer can switch to a writable shared Drive folder from protected Settings without changing Vercel environment variables.
- Invalid/unshared/read-only folder cannot replace working configuration.
- New retained exception slips use the active workbook folder.
- Existing stored slips remain accessible at existing URLs.
- Dashboard and audits expose no private key, raw Google error, folder URL, or folder ID.

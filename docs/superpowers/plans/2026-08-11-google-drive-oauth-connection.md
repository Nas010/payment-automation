# Google Drive OAuth Connection Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace service-account folder setup with a trainer-friendly Google OAuth + Picker flow that safely activates personal My Drive folders and uses the connected user for payment-slip storage.

**Architecture:** Keep one encrypted installation-wide Google Drive connection in the existing Integration Secrets repository. OAuth routes create a PKCE-protected candidate authorization; a protected Picker flow validates the selected folder with an OAuth Drive client, creates and removes a probe file, then atomically activates the candidate. Runtime slip storage and private-slip retrieval prefer the active OAuth client and retain the service-account path for configured Shared Drive fallback.

**Tech Stack:** Next.js 15 App Router route handlers and server actions, React 19 client component, strict TypeScript, Vitest, googleapis OAuth2/Drive clients, Google Picker, encrypted Google Sheets-backed secrets.

## Global Constraints

- One global Drive connection; any authenticated administrator may replace account or folder.
- OAuth scope is https://www.googleapis.com/auth/drive.file plus openid and email for account identity.
- OAuth state and PKCE cookies are short-lived, HttpOnly, Secure in production, SameSite=Lax, and scoped to the Drive flow.
- Refresh tokens and candidate authorizations remain server-only and encrypted with SETTINGS_ENCRYPTION_KEY.
- Active connection replacement is staged; old connection stays active until folder validation, probe creation, probe cleanup, and encrypted persistence all succeed.
- Browser receives only a short-lived access token for Google Picker; OAuth client secret and refresh token never reach browser code.
- Uploads use active OAuth connection first, service-account configuration second, and no storage configuration third.
- Storage failures preserve payment evidence and route the result to review; no payment is marked successfully stored when Drive fails.
- Personal My Drive folders must work; service-account fallback remains available for deliberate Workspace Shared Drive deployments.
- Raw Google responses, tokens, service-account JSON, folder IDs/URLs, and private slip content never enter logs, audit metadata, or user-facing errors.
- Google API boundaries are injectable in unit tests; tests never contact live Google services.
- Existing standard and account-specific Drive URL parsing remains covered for retained fallback settings.
- No real payment or slip is submitted during local or deployment verification without separately authorized production test.

---

## File Structure

- Create src/lib/storage/google-drive-auth.ts: OAuth configuration, scopes, redirect URI, PKCE/state helpers, OAuth client construction, and encrypted candidate-cookie codec.
- Create src/lib/storage/google-drive-auth.test.ts: pure config, PKCE, state comparison, redirect, and candidate-cookie tests.
- Create src/lib/storage/google-drive-connection.ts: typed active connection record, encrypted secret read/write, safe status projection, and connection validation.
- Create src/lib/storage/google-drive-connection.test.ts: absent/malformed/encrypted connection behavior and payload redaction.
- Modify src/lib/secrets/types.ts, crypto.ts, repository.ts, and service.ts: add non-user-managed Drive connection key and encryption support without exposing token suffix metadata.
- Modify src/lib/secrets tests: cover Drive key parsing and no-token-metadata encryption while retaining LINE behavior.
- Modify src/lib/config.ts and config.test.ts: add optional OAuth/Picker configuration and deterministic redirect URI resolution.
- Modify src/lib/storage/drive-client.ts and test: add OAuth client construction, folder validation actor labels, probe create/delete, and active-client selection.
- Modify src/lib/storage/drive-folder.ts and test: add OAuth as highest-priority storage source while retaining workbook/environment fallback.
- Modify src/lib/storage/slip.ts and test: use active OAuth target/client for retained exception slips.
- Modify src/app/api/admin/slips/[paymentId]/route.ts and create its test: retrieve private files through same active-client resolver.
- Create src/app/admin/google-drive/connect/route.ts and test: start admin-authenticated OAuth with state and PKCE.
- Create src/app/admin/google-drive/callback/route.ts and test: validate callback, exchange code, identify account, encrypt candidate cookie, redirect safely.
- Create src/app/admin/google-drive/picker-token/route.ts and test: return short-lived Picker bootstrap data from candidate or active authorization.
- Create src/app/admin/google-drive/actions.ts and test: protected folder selection, OAuth validation/probe, atomic activation, safe audit, candidate cleanup.
- Create src/components/admin/google-drive-connection-card.tsx and test: Connect/Reconnect/Change folder controls, Picker integration, status/error display, activation refresh.
- Modify src/app/admin/(protected)/settings/page.tsx: load safe OAuth status, pass query-state messages, render card, retain legacy fallback only as explicit recovery section.
- Modify src/app/api/health/route.ts and test: report storage ready when OAuth connection or legacy resolver is available.
- Modify README.md and .env.example: document Google Cloud setup, OAuth flow, account/folder switching, legacy fallback, and production checks.

---

### Task 1: Add encrypted Drive connection domain and OAuth primitives

**Files:**
- Modify: src/lib/secrets/types.ts
- Modify: src/lib/secrets/crypto.ts
- Modify: src/lib/secrets/repository.ts
- Modify: src/lib/secrets/service.ts
- Modify: src/lib/secrets/crypto.test.ts, repository.test.ts, and service.test.ts
- Modify: src/lib/config.ts and src/lib/config.test.ts
- Create: src/lib/storage/google-drive-auth.ts and google-drive-auth.test.ts
- Create: src/lib/storage/google-drive-connection.ts and google-drive-connection.test.ts

**Interfaces:**
- SecretKeyName includes google_drive_connection; only the two existing LINE names remain accepted by user-managed setSecret.
- GoogleDriveConnection = { refreshToken: string; accountEmail: string; folderId: string; folderName: string; validatedAt: string }.
- googleDriveConfig(environment?): GoogleDriveConfig | null returns clientId, clientSecret, pickerApiKey, projectNumber only when all four values are present and not CONFIG_REQUIRED.
- googleDriveRedirectUri(origin, environment?): string uses PRODUCTION_BASE_URL when configured, otherwise supplied request origin, and appends /admin/google-drive/callback.
- createGoogleDriveOAuthClient(input): OAuth2Client constructs google.auth.OAuth2 with configured client ID/secret/redirect URI.
- createOAuthState(), createPkceVerifier(), createPkceChallenge(verifier) use cryptographically random bytes and SHA-256 base64url encoding.
- GoogleDriveCandidate = { refreshToken: string; accountEmail: string }.
- encodeDriveCandidate(candidate): string and decodeDriveCandidate(value): GoogleDriveCandidate use AES-GCM encrypted payloads with no token suffix metadata.
- getGoogleDriveConnection(): Promise<GoogleDriveConnection | null> decrypts active record and validates exact string fields.
- saveGoogleDriveConnection(connection): Promise<void> encrypts and upserts one active record.
- googleDriveStatus(connection) returns only connected, account email, folder name, and validation time.

- [ ] Step 1: Write failing secret-key and encryption tests.

Extend secret tests to assert repository parsing accepts google_drive_connection, setSecret still rejects it as a user-managed LINE credential API, and encryptSecret with exposeLastFour false stores an empty lastFour while decrypting the original payload. Assert metadata never returns plaintext or token suffix for the Drive record.

~~~ts
const payload = JSON.stringify({
  refreshToken: "refresh-secret",
  accountEmail: "coach@example.com",
  folderId: "folder-12345",
  folderName: "Private slips",
  validatedAt: "2026-08-11T12:00:00.000Z",
});
const encrypted = encryptSecret({ keyName: "google_drive_connection", plaintext: payload, exposeLastFour: false });
expect(encrypted.lastFour).toBe("");
expect(decryptSecret({ keyName: "google_drive_connection", record: encrypted })).toBe(payload);
~~~

- [ ] Step 2: Write failing config and OAuth primitive tests.

Use deterministic inputs. Assert missing or CONFIG_REQUIRED OAuth values return null, complete values return exact config, redirect URI uses production base URL, fallback origin works for local requests, state/verifier have sufficient length, the PKCE challenge equals a literal SHA-256 base64url fixture, and state comparison rejects unequal values without throwing.

~~~ts
expect(googleDriveConfig({ GOOGLE_DRIVE_OAUTH_CLIENT_ID: "CONFIG_REQUIRED" })).toBeNull();
expect(googleDriveRedirectUri("http://localhost:3000", { PRODUCTION_BASE_URL: "https://coaching-payments-automated.vercel.app" })).toBe("https://coaching-payments-automated.vercel.app/admin/google-drive/callback");
expect(createPkceChallenge("verifier")).toBe("iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ");
~~~

The test must contain the computed challenge literal, not an implementation call on both sides.

- [ ] Step 3: Write failing active-connection repository tests.

Mock getSecretRecord and upsertSecretRecord. Assert absent returns null, valid encrypted record returns the exact typed connection, malformed JSON/fields throws Google Drive connection is invalid., and save encrypts complete JSON with exposeLastFour false. Assert status projection contains account email/folder name/time only and JSON output never contains refreshToken or folderId.

- [ ] Step 4: Run focused RED tests.

~~~sh
npm test -- src/lib/secrets/crypto.test.ts src/lib/secrets/repository.test.ts src/lib/secrets/service.test.ts src/lib/config.test.ts src/lib/storage/google-drive-auth.test.ts src/lib/storage/google-drive-connection.test.ts
~~~

Expected: new exports and Drive key support fail before implementation.

- [ ] Step 5: Implement minimal secret and OAuth domain.

Add Drive key to repository allowlist, keep setSecret typed to LINE keys, add optional exposeLastFour encryption flag with default true, and implement typed Drive config/connection helpers. Use constant-time state comparison after equal-length check. Candidate codec must reject malformed/decrypted payloads and never return partial connection.

- [ ] Step 6: Run focused GREEN tests.

Run Step 4 command. Expected: all secret/config/OAuth/connection tests pass with no network calls.

- [ ] Step 7: Commit domain layer.

~~~sh
git add src/lib/secrets src/lib/config.ts src/lib/config.test.ts src/lib/storage/google-drive-auth.ts src/lib/storage/google-drive-auth.test.ts src/lib/storage/google-drive-connection.ts src/lib/storage/google-drive-connection.test.ts
git commit -m "feat: add encrypted Google Drive connection domain"
~~~

---

### Task 2: Add OAuth Drive client and runtime storage selection

**Files:**
- Modify: src/lib/storage/drive-client.ts and drive-client.test.ts
- Modify: src/lib/storage/drive-folder.ts and drive-folder.test.ts
- Modify: src/lib/storage/slip.ts and slip.test.ts
- Modify: src/app/api/admin/slips/[paymentId]/route.ts
- Create: src/app/api/admin/slips/[paymentId]/route.test.ts
- Modify: src/app/api/health/route.ts and route.test.ts

**Interfaces:**
- DriveClientLike.files.delete is available for probe cleanup; existing service-account file creation remains compatible.
- createOAuthDriveClient(connection, config?): DriveClientLike creates a Drive client using OAuth2 refresh credentials.
- getConfiguredDriveClient(): Promise<DriveClientLike> returns OAuth client when active connection exists, otherwise service-account client.
- validateDriveFolder(folderId, options?): Promise<...> keeps service-account permission message by default and accepts OAuth-specific message.
- testDriveFolderWrite(folderId, drive, now?): Promise<void> creates a zero-content uniquely named probe and deletes it before returning.
- SlipStorageFolder.source expands to oauth | workbook | environment.
- getSlipStorageFolder() returns active OAuth folder first, then workbook setting, then environment fallback.
- createDriveSlipFile() resolves configured client when no injected client is supplied.

- [ ] Step 1: Write failing OAuth client and probe tests.

Extend Drive test doubles with delete. Mock google.auth.OAuth2, google.drive, active-connection/config loaders. Assert OAuth client receives exact refresh token and drive.file scope, metadata request uses supportsAllDrives true, probe creates one empty text file under selected folder, deletes returned ID, and rejects when deletion fails. Unknown Google errors become Could not validate Google Drive folder. Try again.

- [ ] Step 2: Write failing runtime precedence tests.

Mock getGoogleDriveConnection, listOperationalSettings, and environment. Assert OAuth target wins over workbook/environment, workbook wins without OAuth, environment remains available when Settings read fails. Inject Drive client into storeExceptionSlip and assert parent equals selected OAuth folder. Assert status metadata contains no refresh token or folder ID.

- [ ] Step 3: Write failing private-slip retrieval tests.

Mock requireAdmin, getPaymentById, getConfiguredDriveClient, and file-ID parsing. Assert GET calls active-client resolver with stored file ID and returns private bytes/content type. Missing slip URL returns 404; resolver failures never expose Google response text.

- [ ] Step 4: Run focused RED tests.

~~~sh
npm test -- src/lib/storage/drive-client.test.ts src/lib/storage/drive-folder.test.ts src/lib/storage/slip.test.ts src/app/api/admin/slips/'[paymentId]'/route.test.ts src/app/api/health/route.test.ts
~~~

Expected: OAuth client, source precedence, probe, and route behavior fail before implementation.

- [ ] Step 5: Implement OAuth client and resolver.

Keep service-account createDriveClient unchanged for fallback. Add OAuth2 construction with drive.file, supportsAllDrives true on all file calls, safe status mapping, and a bounded probe name such as probe-<random>. Resolve active connection before workbook settings. Make createDriveSlipFile asynchronously choose configured client only when no test client is injected.

- [ ] Step 6: Update private-slip route and health.

Replace route-local service-account construction with getConfiguredDriveClient. Keep admin protection and private/no-store headers. Health calls unified storage resolver and reports SLIP_STORAGE_FOLDER_ID only when neither OAuth nor fallback resolves.

- [ ] Step 7: Run GREEN and regression tests.

Run Step 4 command plus:

~~~sh
npm test -- src/lib/slip/process.test.ts src/app/api/payment/'[token]'/submit/route.test.ts src/lib/line/slip-payments.test.ts
~~~

Expected: OAuth/fallback storage tests and existing website/LINE slip processing tests pass.

- [ ] Step 8: Commit runtime layer.

~~~sh
git add src/lib/storage src/app/api/admin/slips src/app/api/health
git commit -m "feat: use connected Google Drive for slip storage"
~~~

---

### Task 3: Add OAuth start, callback, and Picker-token routes

**Files:**
- Create: src/app/admin/google-drive/connect/route.ts and route.test.ts
- Create: src/app/admin/google-drive/callback/route.ts and route.test.ts
- Create: src/app/admin/google-drive/picker-token/route.ts and route.test.ts

**Interfaces:**
- GET /admin/google-drive/connect returns Google redirect or /admin/settings?drive_error=oauth_not_configured.
- GET /admin/google-drive/callback accepts code, state, and provider errors; redirects only to same-origin /admin/settings with fixed error codes.
- GET /admin/google-drive/picker-token returns accessToken, appId, apiKey, optional folderId/folderName with Cache-Control: no-store.
- Cookies google_drive_oauth_state and google_drive_oauth_pkce use path /admin/google-drive, max age 600; google_drive_candidate uses path /admin, max age 600. All are HttpOnly, Secure in production, SameSite Lax.

- [ ] Step 1: Write failing connect-route tests.

Mock requireAdmin, OAuth config/client, random state/verifier, and response. Assert admin is required, missing config redirects to safe Settings error, configured access sets both cookies and URL includes exact Drive scope, openid, email, access_type=offline, prompt=consent, state, and PKCE challenge. Assert client secret never appears in redirect URL.

- [ ] Step 2: Write failing callback-route tests.

Mock cookies, OAuth token exchange, userinfo, encryption, and redirect response. Cover provider denial, missing code/state, mismatched state, exchange failure, missing refresh token, userinfo failure, and success. Success deletes state/verifier cookies, sets only encrypted candidate cookie, and redirects to /admin/settings?drive=select. Errors contain fixed codes only and clear temporary cookies.

- [ ] Step 3: Write failing Picker-token tests.

Mock admin auth, candidate decode, active connection, OAuth access-token exchange, and config. Assert candidate authorization wins over active, active works for Change folder, response includes project number as appId, API key, short-lived access token, and no token details in errors.

- [ ] Step 4: Run RED route tests.

~~~sh
npm test -- src/app/admin/google-drive/connect/route.test.ts src/app/admin/google-drive/callback/route.test.ts src/app/admin/google-drive/picker-token/route.test.ts
~~~

Expected: route modules and cookie flow fail before implementation.

- [ ] Step 5: Implement connect route.

Call requireAdmin before generating state. Use request.nextUrl.origin for local redirect derivation while googleDriveRedirectUri prefers configured production base URL. Set fixed cookie names/options. OAuth URL includes include_granted_scopes=true, access_type=offline, prompt=consent, and exact configured scopes.

- [ ] Step 6: Implement callback route.

Handle provider errors with fixed code mapping. Compare state in constant time after equal-length check, consume state/verifier cookies, exchange code with same redirect URI, require refresh token, fetch account email through userinfo, encrypt candidate payload, and redirect to Settings. Never serialize raw Google token response.

- [ ] Step 7: Implement Picker-token route.

Require admin, decode candidate or load active, validate config, create OAuth client, call getAccessToken, require nonblank token, and return only Picker bootstrap fields with no-store response.

- [ ] Step 8: Run GREEN route tests.

Run Step 4 command. Expected: all route tests pass with safe redirects and no live requests.

- [ ] Step 9: Commit OAuth routes.

~~~sh
git add src/app/admin/google-drive
git commit -m "feat: add Google Drive OAuth routes"
~~~

---

### Task 4: Add protected folder activation and Picker dashboard UI

**Files:**
- Create: src/app/admin/google-drive/actions.ts and actions.test.ts
- Create: src/components/admin/google-drive-connection-card.tsx and test.tsx
- Modify: src/app/admin/(protected)/settings/page.tsx
- Modify legacy settings drive-actions files only if recovery UI requires changed safe messages

**Interfaces:**
- GoogleDriveConnectionActionResult = { ok: boolean; status: CONNECTED | FAILED; message: string; accountEmail?: string; folderName?: string; validatedAt?: string }.
- activateGoogleDriveFolderAction(formData) requires admin, accepts folder_id/folder_name, validates folder and probe with candidate/active OAuth auth, saves after complete success, audits safe metadata, revalidates /admin/settings, and clears candidate after success.
- GoogleDriveConnectionCard receives safe status, config availability, autoOpenPicker, fixed initial error, and activateAction; it receives no secret/token fields.

- [ ] Step 1: Write failing activation-action tests.

Mock admin auth, candidate/active loaders, OAuth Drive client, folder validation, probe test, save connection, audit, cookies, config, and revalidatePath. Cover candidate success, active-folder change, invalid folder, validation failure, probe-create/delete failure, candidate preservation on failure, candidate deletion on success, safe audit metadata, and missing fields/auth before Drive calls.

~~~ts
expect(saveGoogleDriveConnection).toHaveBeenCalledWith({
  refreshToken: "refresh-secret",
  accountEmail: "coach@example.com",
  folderId: "folder-12345",
  folderName: "Private slips",
  validatedAt: "2026-08-11T12:00:00.000Z",
});
expect(JSON.stringify(appendAudit.mock.calls)).not.toContain("folder-12345");
~~~

- [ ] Step 2: Write failing Picker-card tests.

Use jsdom with typed window.google/window.gapi fixtures. Assert not-connected copy and Connect control, connected email/folder/time and Change folder/Reconnect controls, Picker token fetch and folder-only selection, drive=select auto-open once, cancel unchanged, success router.refresh, safe failure copy, and missing-config setup message. Assert no service-account sharing instructions are the primary flow.

- [ ] Step 3: Run RED action/UI tests.

~~~sh
npm test -- src/app/admin/google-drive/actions.test.ts src/components/admin/google-drive-connection-card.test.tsx
~~~

Expected: new action/component exports fail before implementation.

- [ ] Step 4: Implement activation action.

Require admin first. Parse nonblank folder ID/name. Select candidate cookie when present; otherwise active connection. Use OAuth Drive client, validate with message Connected Google account needs Editor access to this folder., run create/delete probe, then save one complete connection. Catch failures into fixed messages, append safe failure audit, and leave old connection untouched. Revalidate only after save succeeds.

- [ ] Step 5: Implement Picker card.

Load https://apis.google.com/js/api.js once. Fetch Picker bootstrap from server route, call gapi.load("picker"), build PickerBuilder with OAuth token, developer key, project app ID, and DocsView(ViewId.FOLDERS) with folder selection enabled. Callback submits only selected folder ID/name. Keep access token in component memory; never use DOM attributes, URL query, local storage, or server props.

- [ ] Step 6: Integrate Settings page and explicit legacy fallback.

Load active OAuth connection/status and existing settings in parallel. Pass only safe status. Use searchParams.drive=select for callback auto-open and fixed drive_error copy. Keep existing service-account Save & Test form below Legacy service-account fallback only when no OAuth connection is active. Hide reserved keys from generic table.

- [ ] Step 7: Run GREEN action/UI/Settings tests.

~~~sh
npm test -- src/app/admin/google-drive/actions.test.ts src/components/admin/google-drive-connection-card.test.tsx src/app/admin/'(protected)'/settings/drive-actions.test.ts src/components/admin/drive-storage-form.test.ts src/components/admin/line-integration-form.test.ts src/components/admin/line-due-template-form.test.ts
~~~

Expected: OAuth card, legacy fallback, and existing Settings cards all pass.

- [ ] Step 8: Commit activation and UI.

~~~sh
git add src/app/admin/google-drive src/components/admin/google-drive-connection-card.tsx src/components/admin/google-drive-connection-card.test.tsx src/app/admin/'(protected)'/settings
git commit -m "feat: add Google Drive folder picker"
~~~

---

### Task 5: Update deployment documentation and configuration examples

**Files:**
- Modify: .env.example
- Modify: README.md
- Modify: src/lib/config.test.ts only if config assertions need coverage

**Interfaces:** Add optional server-only variables:

~~~text
GOOGLE_DRIVE_OAUTH_CLIENT_ID=
GOOGLE_DRIVE_OAUTH_CLIENT_SECRET=
GOOGLE_DRIVE_PICKER_API_KEY=
GOOGLE_DRIVE_PROJECT_NUMBER=
~~~

Keep SLIP_STORAGE_FOLDER_ID documented as legacy Shared Drive/recovery fallback.

- [ ] Step 1: Update env example.

Add empty entries only; never add client secret, API key, refresh token, folder ID, or account email. Explain server-only versus browser-restricted key use.

- [ ] Step 2: Update README rollout.

Document Google Cloud project coaching-payments-automation, Drive API and Picker API enablement, OAuth consent/client redirect URI, browser-key restrictions, four variable roles, personal My Drive account ownership, Connect → account → folder → write-test flow, failed-switch preservation, revoked-token reconnect, service-account fallback, and a production test requiring separate payment authorization. State that storage failures remain reviewable and do not silently resolve as paid.

- [ ] Step 3: Run documentation checks.

~~~sh
git diff --check
rg -n "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET|refreshToken|private_key|folderId" README.md .env.example
~~~

Expected: variable names and safe operational wording appear; no real secret or token value appears.

- [ ] Step 4: Commit documentation.

~~~sh
git add README.md .env.example
git commit -m "docs: document Google Drive OAuth setup"
~~~

---

### Task 6: Verify complete implementation and hand off deployment setup

**Files:** No planned source additions. Fix only concrete verification failures, adding a regression test before behavior changes.

- [ ] Step 1: Inspect branch hygiene.

Run git status --short, git diff --check, and git log --oneline --decorate -8. Confirm parser WIP is included in final runtime commit or explicitly staged for this feature, no env/secret/generated file is tracked, and design/plan commits remain present.

- [ ] Step 2: Run focused feature regression suite.

~~~sh
npm test -- src/lib/secrets src/lib/storage src/app/admin/google-drive src/components/admin/google-drive-connection-card.test.tsx src/app/api/admin/slips/'[paymentId]'/route.test.ts src/app/api/health/route.test.ts
~~~

Expected: all new OAuth, storage, UI, health, and private-slip tests pass.

- [ ] Step 3: Run full verification.

~~~sh
npm run lint
npm test
npm run build
~~~

Expected: zero lint errors, all Vitest tests pass, production build exits 0.

- [ ] Step 4: Inspect final diff for security.

Run git diff origin/main...HEAD --stat and search changed files for raw Google response interpolation, token names in client props, service-account JSON in JSX, unbounded error messages, and missing Cache-Control: no-store on Picker-token responses. Fix concrete findings with tests.

- [ ] Step 5: Prepare production configuration handoff.

Report code readiness, four required OAuth/Picker variables, and exact Google Cloud redirect URI without printing values. State that production connection cannot complete until credentials are created/configured. After configuration: open Settings, connect account, select supplied personal folder, confirm probe disappears, send separately authorized slip, and verify reconnect/change-folder safety.

- [ ] Step 6: Commit verification-only fixes.

Stage only exact files fixed by verification and commit with a concrete message; do not stage unrelated worktree changes.

# Google Drive OAuth Connection Design

**Date:** 2026-08-11

**Status:** Approved in conversation; awaiting written-spec review

**Scope:** Replace the fragile service-account folder setup with a simple Google account connection and folder picker for payment-slip storage.

## Problem

The current dashboard asks an administrator to paste a Google Drive folder URL and share that folder with a service account. This is difficult to configure and does not work reliably with personal My Drive folders. Google service accounts have no personal Drive storage quota, so even a folder shared with the service account can reject uploads with `storageQuotaExceeded`.

The supplied folder is a personal My Drive folder. It is accessible to the trainer but cannot be used as an upload destination by the existing service-account flow. Account-specific folder URLs such as `/drive/u/1/folders/...` also expose a separate parsing defect, but fixing that parser alone cannot solve the upload limitation.

## Goals

- Let a trainer connect Google Drive from the dashboard with a familiar Google authorization flow.
- Let the trainer select a folder with Google's official Picker UI.
- Support personal My Drive folders by uploading as the connected Google user.
- Let any authenticated administrator replace the active account or folder safely.
- Preserve the current working connection until a replacement passes a real write test.
- Ensure a Drive failure never silently discards payment-slip evidence.
- Keep OAuth credentials, refresh tokens, and folder permissions out of logs and audit details.

## Non-goals

- Per-trainer or per-client Drive connections.
- Browsing Drive with a custom folder browser.
- Synchronizing files already stored in a previous folder.
- Managing Google Workspace users, Shared Drives, or folder permissions from this application.
- Requiring Google Workspace. Personal Google accounts must work.

## Chosen Approach

Use Google OAuth 2.0 with the narrow `drive.file` scope and Google Picker.

The alternatives are:

1. **OAuth plus Google Picker — selected.** The connected user owns uploaded files, personal My Drive works, and `drive.file` limits access to files and folders the user explicitly selects or the app creates.
2. **OAuth plus pasted folder URL.** Simpler UI code, but validating arbitrary existing folders requires broader Drive metadata access and keeps the error-prone copy/paste experience.
3. **Service account plus Shared Drive.** Technically viable for Google Workspace Shared Drives, but incompatible with the current personal Drive folder and not suitable for every trainer.

The existing service-account path may remain as a legacy fallback for deployments that deliberately use a Workspace Shared Drive. An active OAuth connection takes precedence.

## User Experience

The Drive section in Admin Settings has these states:

- **Not connected:** Show `Connect Google Drive` and a short explanation that the selected Google account will own uploaded payment slips.
- **Connecting:** Redirect to Google's consent screen, return to Settings, then open Google Picker.
- **Connected:** Show the Google account email, selected folder name, and last successful validation time. Show `Change folder` and `Reconnect account` actions.
- **Needs attention:** Keep the saved folder information visible, explain that authorization or write access failed, and show `Reconnect Google Drive`.

The normal flow is:

1. An authenticated administrator selects `Connect Google Drive` or `Reconnect account`.
2. Google asks the administrator to choose an account and grant the app's Drive permission.
3. The browser returns to Admin Settings and opens Google Picker.
4. The administrator selects one folder.
5. The server creates and removes a small probe file in that folder.
6. Only after the probe succeeds, the dashboard displays `Connected` and the new connection becomes active.

`Change folder` reuses the active Google authorization and opens Picker directly. Canceling consent, canceling Picker, selecting a non-folder, or failing the write test leaves the previous active connection unchanged.

## Architecture

### Routes and actions

OAuth routes live below `/admin/google-drive` so they remain part of the admin surface:

- `GET /admin/google-drive/connect` verifies an admin session, creates OAuth state and PKCE values, sets temporary secure cookies, and redirects to Google.
- `GET /admin/google-drive/callback` validates the returned state and PKCE verifier, exchanges the authorization code, and stores the candidate authorization in a short-lived encrypted cookie. It then redirects to the Drive section of Admin Settings.
- A protected server endpoint provides Picker bootstrap data: a short-lived access token, Google Cloud project number, Picker API key, and the currently selected folder ID when present.
- A protected server action accepts the folder ID and name returned by Picker, verifies the folder with the candidate or active user authorization, performs the write test, and atomically activates the new connection.

The callback does not activate a connection. This separation ensures that successful consent without a valid folder cannot replace a working configuration.

### OAuth state and cookies

The connect route generates:

- A cryptographically random OAuth state value.
- A PKCE verifier and SHA-256 challenge.

State and verifier cookies are encrypted or authenticated, `HttpOnly`, `Secure` in production, short-lived, and scoped to `/admin/google-drive`. They use `SameSite=Lax` because Google's top-level redirect must return them to the callback. The existing admin session remains `SameSite=Strict`; the connect route verifies it before leaving the application, while the callback relies on validated one-time state and PKCE. Activating the selected folder again requires a valid admin session.

The OAuth request uses offline access so Google can return a refresh token. The callback's candidate refresh token is stored only in a short-lived encrypted, HTTP-only cookie until folder validation succeeds. OAuth tokens are never exposed to browser JavaScript.

The browser receives only a short-lived access token for Google Picker. The token is returned from an authenticated endpoint and is held in memory only. Picker uses it to display folders the user can select under the `drive.file` permission model.

### Active connection record

There is one active Drive connection for the installation. It is stored as one encrypted payload so account and folder changes cannot be partially applied:

```ts
type GoogleDriveConnection = {
  refreshToken: string;
  accountEmail: string;
  folderId: string;
  folderName: string;
  validatedAt: string;
};
```

The existing settings encryption key encrypts the payload with authenticated encryption. Only server code decrypts it. User-facing status reads expose only the email, folder name, and validation time.

The application must not place refresh tokens, access tokens, client secrets, raw OAuth responses, or folder permission metadata in audit records, error messages, or logs.

### Safe replacement

Connecting a new account or selecting a new folder is a staged operation:

1. Store the candidate authorization temporarily.
2. Validate that the Picker result is a folder available to that authorization.
3. Create a uniquely named, zero-content probe file in the folder.
4. Trash or delete the probe file.
5. Persist the complete encrypted connection payload in one repository operation.
6. Clear candidate cookies.

If steps 2–4 fail, the candidate is discarded and the existing active connection remains unchanged. If cleanup of a successfully created probe fails, activation also fails and the error identifies the leftover probe without revealing credentials.

### Runtime slip storage

Slip storage resolves its Drive client in this order:

1. Active OAuth connection.
2. Existing service-account configuration, only as a legacy fallback.
3. No Drive storage configured.

For OAuth, the server refreshes an access token when needed and uploads the slip to the saved folder as the connected Google user. The normal slip-classification and payment workflow remain unchanged.

When Drive upload fails, the payment/slip pipeline records a reviewable failure and keeps the original LINE message or payment-page evidence available for retry or manual review. Storage failure must not falsely mark the slip as successfully processed, and logs must contain a safe error category rather than tokens or private slip content.

## Errors and Recovery

- **Consent denied or callback error:** Return to Settings with a concise message; keep the old connection.
- **State or PKCE validation failure:** Reject the callback, clear temporary cookies, and require a new connection attempt.
- **No refresh token returned:** Keep the old connection and ask the trainer to reconnect; request consent explicitly on reconnect.
- **Picker canceled:** Clear the pending candidate after its timeout; keep the old connection.
- **Folder access or write test fails:** Explain that the selected account needs write access; keep the old connection.
- **Refresh token revoked later:** Mark the connection `Needs attention`, preserve its metadata, route slip storage failures to review, and prompt for reconnection.
- **Folder moved, deleted, or permission removed:** Mark the connection `Needs attention`, preserve the previous record for diagnosis, and allow `Change folder` or reconnect.
- **Concurrent replacements:** The last fully validated activation wins; partial candidates never overwrite the active record.

## Google Cloud and Deployment Configuration

The `coaching-payments-automation` Google Cloud project needs:

- Google Drive API enabled.
- Google Picker API enabled.
- An OAuth consent screen configured for the intended trainer accounts.
- A Web application OAuth client with this production redirect URI:
  `https://coaching-payments-automated.vercel.app/admin/google-drive/callback`
- A browser API key restricted to the production web origin and Google Picker API.

Production needs server-side environment variables for:

- Google OAuth client ID.
- Google OAuth client secret.
- Google Picker API key.
- Google Cloud project number.

Variable names will follow the repository's existing configuration naming pattern and be specified in the implementation plan. Client secret and refresh tokens remain server-only. The Picker key is allowed in browser bootstrap data but must be protected by HTTP-referrer and API restrictions in Google Cloud.

If external credentials are absent, the dashboard reports that Google Drive connection setup is unavailable; existing payment handling continues without attempting an incomplete OAuth flow.

## Testing

Automated tests cover:

- OAuth state generation, one-time validation, expiry, and mismatch handling.
- PKCE challenge creation and verifier validation.
- Encryption/decryption and redaction of the active connection payload.
- Callback success, denial, missing refresh token, and exchange failure.
- Picker bootstrap authorization and activation only after a folder is selected.
- Safe cutover: every candidate failure preserves the old connection.
- Probe-file creation and cleanup behavior.
- Token refresh and revoked-token handling.
- Runtime OAuth upload selection and legacy fallback ordering.
- Slip-pipeline behavior when Drive upload fails.
- Dashboard states and account/folder replacement controls.
- Both standard `/drive/folders/...` and account-specific `/drive/u/1/folders/...` URL parsing for the retained legacy flow.

Before release, run `npm run lint`, `npm test`, and `npm run build`.

Production verification consists of:

1. Connect the intended Google account.
2. Select the supplied personal My Drive folder in Picker.
3. Confirm the server write test succeeds and the probe is removed.
4. Send a real payment slip through LINE.
5. Confirm the slip is processed, stored in the selected folder when required, and the payment leaves `Awaiting` according to classification rules.
6. Reconnect or switch folders once and verify the previous connection remains active until the replacement succeeds.

## Acceptance Criteria

- A trainer can connect a personal Google account and select a Drive folder without copying an ID or sharing it with a service account.
- The supplied personal My Drive folder passes the real server-side write test after its owner connects.
- Any administrator can safely reconnect the account or change the folder.
- A canceled or failed replacement never breaks the previous working connection.
- Runtime slip uploads use the active OAuth user and handle revoked access visibly.
- Payment evidence is retained and sent to review when storage fails.
- No OAuth credential or private slip content appears in logs or audit records.
- Lint, tests, and production build pass before deployment.

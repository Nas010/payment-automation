# Coaching Payments Automation

A single-owner payment dashboard built with Next.js, Google Sheets, Google Drive, PromptPay, optional LINE messaging, and Vercel Cron.

## Ownership model

- The developer owns the Vercel deployment and infrastructure secrets.
- The workbook in `SPREADSHEET_ID` is a private bootstrap/key-safe workbook. The service account uses only this workbook.
- The first verified Google account to sign in becomes the permanent installation owner.
- The owner creates one operational workbook and chooses one private slip folder from `/admin/setup`.
- Business, recipient, PromptPay, retention, OCR, LINE app identifiers, feature flags, and LINE credentials are managed in the dashboard. They are not deployment variables.
- The operational workbook is fixed after setup. Settings can test/reconnect Google and replace the slip folder without switching databases.

## Developer deployment configuration

Copy `.env.example` and configure:

- `SPREADSHEET_ID` — private developer-owned key-safe workbook, not the target workbook.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service account with access only to the key safe.
- `ADMIN_SECRET` — signs 30-day owner sessions.
- `CRON_SECRET` — authenticates Vercel Cron.
- `SETTINGS_ENCRYPTION_KEY` — base64-encoded 32-byte key for Google and LINE secrets.
- `GOOGLE_DRIVE_OAUTH_CLIENT_ID` and `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`.
- `GOOGLE_DRIVE_PICKER_API_KEY` and `GOOGLE_DRIVE_PROJECT_NUMBER`.

Use this OAuth callback for each deployed origin:

```text
https://YOUR_DEPLOYMENT/admin/google-drive/callback
```

Enable Google Sheets API and Google Drive API. The app requests `openid`, `email`, and `drive.file`; it can create and use files the owner creates or selects through the app without broad Drive access.

Publish the OAuth consent app as **Production** before handoff. External apps left in Testing can receive refresh tokens that expire after seven days.

Existing deployments may temporarily keep `LINE_LIFF_ID` and `LINE_LOGIN_CHANNEL_ID` as server-side migration fallbacks. A saved dashboard value takes precedence. Fresh installations do not need either variable.

## LINE one-tap linking setup

1. In LINE Developers, create or use a LINE Login channel in the same provider as the Official Account's Messaging API channel.
2. Add a LIFF app with endpoint `https://YOUR_DEPLOYMENT/line/connect`, compact view, and `openid` scope.
3. In protected **Settings**, enter the resulting **LIFF ID** and its numeric **LINE Login channel ID**. Saving takes effect immediately without a redeployment.
4. In the same page, save and test the Messaging API channel access token and channel secret. Enable LINE linking only after the identifiers and credentials are configured.
5. Edit, preview, and save the global **LINE welcome message**. Every unlinked client renders the current template with its own secure seven-day connection URL.
6. Create a test client, copy the welcome message into that client's existing Official Account chat, and tap it on a real mobile LINE installation. Confirm the LIFF view links the verified account, closes back to chat, and the dashboard shows the correct LINE identity.
7. Repeat the same link with the same account to confirm the idempotent success path, then use a separately authorized different account to confirm conflict/review handling.

The app verifies raw LIFF ID tokens with LINE on the server. It never trusts a browser-decoded profile, and connection tokens or ID tokens must not be logged. Existing unexpired `LINK` commands remain consumable during transition, but the dashboard no longer creates or displays short codes.

## Owner setup

1. Open `/admin/login` and continue with Google.
2. The first verified Google identity claims the installation.
3. Create `Coaching Payments - Automated` from the setup wizard.
4. Create `Coaching Payment Slips` or choose an existing Drive folder.
5. Enter business, recipient, PromptPay, public URL, retention, OCR, LINE app identifiers, and LINE feature settings.
6. Confirm the PromptPay QR preview and finish setup.
7. The app validates the workbook schema, tests folder write/delete, stores settings, activates the staged connection, and opens the dashboard.

Setup is resumable. A canceled picker or failed probe never replaces a working active connection.

## Workbook layout

The owner workbook contains exactly:

- `Clients`
- `Installment Schedule`
- `Payments`
- `Settings`
- `Audit Log`

Encrypted Google and LINE secrets remain in the private key-safe workbook. There is no Apps Script deployment.

## Local development and verification

```bash
npm run dev
npm run lint
npm test
npm run build
```

Vercel Cron calls `/api/cron/generate` daily and `/api/cron/dashboard-metrics` monthly. Authenticated cron requests return `503` without writes until setup is complete. Disabled or incomplete LINE setup returns `404` before webhook bodies are read.

The health endpoint exposes only safe categories: bootstrap, owner, workspace, workbook, folder, and business configuration.

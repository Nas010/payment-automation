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
6. Create a test client, copy the welcome message into that client's existing Official Account chat, and tap it on a real mobile LINE installation. Confirm the LIFF view links the verified account, closes back to chat, and the dashboard shows the correct LINE identity and profile picture.
7. Repeat the same link with the same account to confirm the idempotent success path, then use a separately authorized different account to confirm conflict/review handling.

The app verifies raw LIFF ID tokens with LINE on the server. It never trusts a browser-decoded profile, and connection tokens or ID tokens must not be logged. Existing unexpired `LINK` commands remain consumable during transition, but the dashboard no longer creates or displays short codes.

## LINE due-payment message profiles

Protected **Settings** has independent message profiles for one-time payments and installments. The coach can insert allowed placeholders at the current caret, edit the main message, and add, rename, edit, or remove up to twenty reusable custom placeholders per profile.

`amount`, `due_date`, and `payment_url` are protected required values. Custom placeholders may combine client-facing system values but cannot reference other custom placeholders. Installment profiles also provide number, ordinal, and word forms, so a custom `payment_label` can render `second payment out of three`.

Saved profiles take effect for future sends. A payment's rendered message is frozen before its LINE request so retries retain the original client-facing content. Existing deployments continue using the legacy due-message template for a payment type until its corresponding profile is saved.

In **Settings**, upload one JPEG or PNG T&S image (maximum 1 MiB). The app stores immutable versions in the already connected Google Drive folder; no new environment variables or Drive setup are needed. Every new plan's first payment request, including an extension, sends payment text, PromptPay QR, and the active T&S image. Later installments send text and QR only. Replacements affect future first attempts; retries keep their frozen version. Missing or unavailable T&S media never blocks payment delivery. Tokenized T&S images are client-facing; private payment slips remain admin-only.

## Owner setup

1. Open `/admin/login` and continue with Google.
2. The first verified Google identity claims the installation.
3. Create `Coaching Payments - Automated` from the setup wizard.
4. Create `Coaching Payment Slips` or choose an existing Drive folder.
5. Enter business, recipient, PromptPay, public URL, retention, OCR, LINE app identifiers, feature flags, credentials, and message profiles.
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

### Installment reminder recovery

The daily job generates invoices, reconciles payment state, processes installment reminders, then processes due-payment requests. A failed stage no longer suppresses the remaining stages. Failed stages return HTTP 503 with safe `failed_stages` names; `PAYMENT_CRON_STAGE` logs record stage duration without customer data or credentials.

Reminder preparation failures and missing recipients are recorded in the payment's `line_reminder_delivery_log` and Audit Log. Retryable preparation failures can resume on a later job. A stale payment state token is retried once only after re-reading an identical pending invoice; paid, voided, edited, or already-claimed invoices are never revived. A malformed row or unavailable audit log does not stop the following clients.

Frozen messages retain their LINE retry keys. Ambiguous requests older than LINE's 24-hour deduplication window move to REVIEW instead of risking duplicate delivery. Before retrying those requests, verify delivery with the coach. Existing slots with no durable retry state are not automatically backfilled, and enabling a reminder after its scheduled date does not send old messages.

For rollout, inspect the production `/api/cron/generate` logs and deployment revision, deploy to a preview environment with isolated test data, and validate an enabled reminder, a preparation failure/recovery, and a repeated invocation. Do not use the production cron endpoint as a read-only diagnostic: it can create invoices and send real LINE messages. Review existing missed reminders against their current payment and delivery status before any manual follow-up.

An independent `/api/cron/reminders` recovery job runs daily at 04:05 UTC (11:05 Bangkok, subject to the hosting plan's scheduling precision), two hours after the primary job. It creates only missing later-installment invoices within the existing reminder window, then retries eligible reminders without entering the due-payment/T&S image workflow. Accepted slots are not sent again. Start/completion events are recorded in Audit Log; LINE push requests have a 10-second timeout so a stalled request can be retried with its existing key. Both cron routes require the existing `CRON_SECRET`; no new credentials are needed. The health response exposes only the public Git revision in addition to its existing safe status categories, allowing release verification without privileged logs.

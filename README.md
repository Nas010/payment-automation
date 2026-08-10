# Coaching Payments — Automated

PromptPay payment links and trusted-client slip recording for a single coach. The Google Spreadsheet is the only admin system of record; the client app never claims bank verification.

## Production setup

1. Add all values from `.env.example` to Vercel. Keep `GOOGLE_SERVICE_ACCOUNT_JSON` server-only. Share only [the new workbook](https://docs.google.com/spreadsheets/d/1I7N201rghJ77R2vEk6ZvqOD1kZB-dCZrDD5sD3aArjA/edit) and [private exception-slip folder](https://drive.google.com/drive/folders/11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD) with that service-account email as Editor, then set the folder ID as `SLIP_STORAGE_FOLDER_ID`.
2. Set your real PromptPay identifier and receiver aliases in Vercel and `Settings`; never commit them.
3. Set `PRODUCTION_BASE_URL` after deployment. The protected `POST /api/admin/generate` needs `x-admin-secret`; Vercel Cron calls `/api/cron/generate` with `Authorization: Bearer $CRON_SECRET`.

## LINE linking rollout

LINE credentials live primarily in the workbook's encrypted `Integration Secrets` sheet. The protected **Settings** dashboard is the normal place to enter or rotate them; it shows metadata only, never plaintext. The deployment needs one server-only master key before the dashboard can save credentials:

```sh
openssl rand -base64 32
```

Set that output as `SETTINGS_ENCRYPTION_KEY` in the production deployment. It must be one base64-encoded 32-byte value; store the exact value in the deployment secret manager and a separate approved recovery location. Never commit it or place it in the workbook.

There is no recovery for encrypted credentials if every copy of this key is lost. First restore the original key from the deployment secret history or secure backup. If that is impossible, set a newly generated key, then use protected **Settings** to enter both current LINE credentials again in the same Save & Test submission; this replaces the unusable encrypted records. Rotate the LINE credentials in LINE Developers afterward. Do not rotate or remove the old key until all encrypted records that need it have been recovered or replaced.

`LINE_CHANNEL_ACCESS_TOKEN` and `LINE_CHANNEL_SECRET` are optional server-only migration/development fallbacks, not the production source of truth. Encrypted dashboard values take precedence. If using fallback values for a migration, paste both values into protected **Settings**, click **Save & Test**, confirm validation, then remove both environment variables and redeploy. Never put real credentials in `.env.example`, source, Sheets cells outside `Integration Secrets`, or client-side configuration.

`LINE_LINKING_ENABLED` defaults to `false`. Only a trimmed, case-insensitive value of `true` enables the webhook. While disabled, `POST /api/line/webhook` returns `404` before it reads the request body, LINE credentials, or client data. Keep it `false` until credentials and rollout checks are ready; set it to `true` in the production deployment and redeploy to activate linking.

Production rollout:

1. In LINE Developers, enable Messaging API on the existing LINE Official Account. Obtain its channel access token and channel secret; keep both private.
2. In Vercel, set the normal production values from `.env.example`, a newly generated `SETTINGS_ENCRYPTION_KEY`, and `LINE_LINKING_ENABLED=false` for the initial deployment. Deploy the app.
3. Sign in to protected `/admin/settings`. Enter the channel access token and secret in **LINE integration**, then click **Save & Test**. It writes encrypted records to `Integration Secrets` and performs only the harmless authenticated `GET https://api.line.me/v2/bot/info` credential check. It does not replace webhook signature verification: every enabled webhook request still needs a valid `x-line-signature` HMAC made with the channel secret.
4. Remove any temporary `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_CHANNEL_SECRET` deployment fallbacks after successful dashboard entry. Set `LINE_LINKING_ENABLED=true`, then redeploy.
5. In the Messaging API channel's webhook settings, set the webhook URL to `https://<production-domain>/api/line/webhook`. Click **Verify**, then enable **Use webhook**. Do not use a preview URL.
6. Create one active test client, copy that client's complete LINE instruction, and have the test account add the Official Account and send its exact `LINK <code>` message. Confirm the LINE success reply and `LINKED` state/display name in the protected client view before rolling out further.
7. In the coach workbook, use **Coaching Payments** → **Generate missing LINE link codes** for the remaining active roster. Give each client only that client's complete generated instruction. Codes expire after seven days; renew an expired code from the protected client view or the workbook's selected-client menu.

## Safety model

- `AUTO_RECORDED` = strong local heuristic match, operationally paid only.
- `REVIEW` = uncertain/partial local signals; inspect privately.
- `FLAGGED` = duplicate or contradictory signals.
- `MANUAL_CONFIRMED` = coach verified independently in SCB.

Run `npm test` and `npm run build` before deployment.

After secure configuration, run `npm run smoke` to check production health. Set `SMOKE_PAYMENT_TOKEN` only for a dedicated test payment: it submits a tiny valid PNG and intentionally creates an auditable `REVIEW`/`FLAGGED` result.

## Coach workbook workflow

Use the `Dashboard` tab to enter a client, choose an active package from `Settings`, and submit via the **Coaching Payments** spreadsheet menu. Packages set defaults for one-time or installment plans; the coach may override price, installment count, and interval. The bound Apps Script creates a private `Installment Schedule` and generates a public payment link at 09:00 Asia/Bangkok on each due date. Future LINE OA automation can send the generated `payment_url` to the stored `line_user_id`.

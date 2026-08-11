# Coaching Payments — Automated

PromptPay payment links and trusted-client slip recording for a single coach. The Google Spreadsheet is the only admin system of record; the client app never claims bank verification.

## Production setup

1. Add the bootstrap values from `.env.example` to Vercel. Keep `GOOGLE_SERVICE_ACCOUNT_JSON` server-only and share only the application workbook with that service-account email.
2. Set your real PromptPay identifier and receiver aliases in Vercel and `Settings`; never commit them.
3. Set `PRODUCTION_BASE_URL` after deployment. The protected `POST /api/admin/generate` needs `x-admin-secret`; Vercel Cron calls `/api/cron/generate` with `Authorization: Bearer $CRON_SECRET`.

## Google Drive slip storage

Protected **Settings** is the normal place to connect or switch the private exception-slip folder:

1. Open `/admin/settings` and find **Google Drive slip storage**.
2. Copy the displayed service-account email.
3. In Google Drive, share the desired private folder with that email as **Editor**.
4. Paste the folder URL or raw folder ID into Settings, then click **Save & Test**.
5. Confirm the card reports a workbook connection and the expected folder name.

The app validates that the item is a live Drive folder and that the service account can add children before activating it. A failed test leaves the previous working folder unchanged. Switching affects only newly retained `REVIEW`/`FLAGGED` slips; existing slip links continue pointing to their original files.

`SLIP_STORAGE_FOLDER_ID` is an optional deployment fallback for migration or recovery. A validated workbook `slip_storage_folder_id` takes precedence. To recover from a broken workbook setting, repair it through protected Settings; if Settings is temporarily unavailable, the server may use the configured environment fallback. Service-account JSON and private keys never belong in workbook settings or browser fields.

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

## LINE payment automation rollout

Vercel runs `/api/cron/generate` daily at **02:05 UTC** (`5 2 * * *`). The job generates due payment links, reconciles manual confirmations, then sends eligible LINE due-payment requests in that order. It catches up any still-pending payment whose due date is on or before its Bangkok business date; it does not send another QR request for a terminal payment or a payment already accepted by LINE.

The `Payments` migration is append-only. On its first payment read or write, the app expands the sheet from the legacy 30 columns to 44 and fills only blank appended LINE header cells (`AE:AR`). It never replaces existing headers or payment values. Back up the workbook through your normal Google Sheets process before rollout, then let the application perform this non-destructive migration; do not paste a replacement header row.

The old Apps Script daily `generateDuePaymentLinks` trigger must be removed manually. In the workbook choose **Coaching Payments** → **Remove legacy daily payment scheduler**. That action deletes only triggers whose handler is `generateDuePaymentLinks`; it leaves other workbook automation alone. **Generate links due today** remains a manual menu item, but Apps Script no longer installs or owns a daily scheduler.

Keep both payment flags disabled for the first deployment:

- `LINE_MESSAGING_ENABLED=false` prevents automated LINE due-payment pushes.
- `LINE_CHAT_PAYMENTS_ENABLED=false` prevents LINE chat-slip payment intake.

Enable them separately, only after LINE linking is working. The protected Settings page stores the `line_due_message_template`: it starts from the documented default, supports a server-rendered preview and a validated custom template, and can reset to that default. Invalid saves keep the last valid template. No template value or LINE credential belongs in client-side configuration.

Default due-message template:

```text
Hi {{client_name}} 👋

Your {{payment_label}} payment is due.

Amount: {{amount}}
Due date: {{due_date}}

Please scan the PromptPay QR below. After paying, send the bank payment slip back in this chat.

If you have trouble with the QR, use your payment page:
{{payment_url}}
```

Safe staged rollout:

1. Deploy with LINE linking, messaging, and chat payments disabled; confirm workbook access and append-only migration with normal admin reads.
2. Configure encrypted LINE credentials in protected Settings, enable `LINE_LINKING_ENABLED`, and link one authorized test client.
3. `LINE_MESSAGING_ENABLED` is global; it cannot be enabled for one client only. Before setting it to `true`, verify there are no other linked, eligible pending due rows. Then use the protected single-payment **Send LINE payment request** action for the authorized test payment, and turn the global flag back off after reviewing the accepted result. The due request freezes its rendered text and retry key before sending, includes an exact-payment PromptPay QR, and records LINE acceptance—not delivery or payment.
4. Enable `LINE_CHAT_PAYMENTS_ENABLED` separately. Only a linked direct user with an awaiting payment can have an image downloaded or evaluated. Eligible chat slips and website uploads use the same local evaluator; normal coaching images are ignored.
5. Keep `/p/[token]` available throughout rollout as the website payment and slip-upload fallback. Any low-value production payment, message, or slip test requires explicit coach and participating-user authorization; use a dedicated low-value test payment and review its recorded outcome before wider enablement.

## Safety model

- `AUTO_RECORDED` = strong local heuristic match, operationally paid only.
- `REVIEW` = uncertain/partial local signals; inspect privately.
- `FLAGGED` = duplicate or contradictory signals.
- `MANUAL_CONFIRMED` = coach verified independently in SCB.

Run `npm run lint`, `npm test`, and `npm run build` before deployment.

After secure configuration, run `npm run smoke` to check production health. Set `SMOKE_PAYMENT_TOKEN` only for a dedicated test payment: it submits a tiny valid PNG and intentionally creates an auditable `REVIEW`/`FLAGGED` result.

## Coach workbook workflow

Use the `Dashboard` tab to enter a client, choose an active package from `Settings`, and submit via the **Coaching Payments** spreadsheet menu. Packages set defaults for one-time or installment plans; the coach may override price, installment count, and interval. The bound Apps Script creates a private `Installment Schedule`; Vercel now owns daily payment-link generation at 02:05 UTC. For linked, eligible clients, LINE can send the due request and exact-payment QR first, then accept a chat slip for local evaluation. Clients can always use their `/p/[token]` payment page instead.

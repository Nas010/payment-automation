# Coaching Payments — Automated

PromptPay payment links and trusted-client slip recording for a single coach. The Google Spreadsheet is the only admin system of record; the client app never claims bank verification.

## Production setup

1. Add all values from `.env.example` to Vercel. Keep `GOOGLE_SERVICE_ACCOUNT_JSON` server-only. Share only [the new workbook](https://docs.google.com/spreadsheets/d/1I7N201rghJ77R2vEk6ZvqOD1kZB-dCZrDD5sD3aArjA/edit) and [private exception-slip folder](https://drive.google.com/drive/folders/11Gf6vMFVD0xDJla_OflyL2zMzH7TTBgD) with that service-account email as Editor, then set the folder ID as `SLIP_STORAGE_FOLDER_ID`.
2. Set your real PromptPay identifier and receiver aliases in Vercel and `Settings`; never commit them.
3. Set `PRODUCTION_BASE_URL` after deployment. The protected `POST /api/admin/generate` needs `x-admin-secret`; Vercel Cron calls `/api/cron/generate` with `Authorization: Bearer $CRON_SECRET`.

## Safety model

- `AUTO_RECORDED` = strong local heuristic match, operationally paid only.
- `REVIEW` = uncertain/partial local signals; inspect privately.
- `FLAGGED` = duplicate or contradictory signals.
- `MANUAL_CONFIRMED` = coach verified independently in SCB.

Run `npm test` and `npm run build` before deployment.

After secure configuration, run `npm run smoke` to check production health. Set `SMOKE_PAYMENT_TOKEN` only for a dedicated test payment: it submits a tiny valid PNG and intentionally creates an auditable `REVIEW`/`FLAGGED` result.

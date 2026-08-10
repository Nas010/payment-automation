# Automated PromptPay Coaching Payment Tracker — MVP Design

## Scope

Small production MVP for ~40 recurring coaching clients. Spreadsheet is the primary admin dashboard; public Vercel app handles a tokenized payment page, amount-specific PromptPay QR, and local heuristic slip processing. No LINE API, paid verification service, bank scraping, payment gateway, client accounts, or separate database.

## Architecture

`Next.js server function -> Google Sheets API -> one private new workbook` is the only durable application data path. Google Drive stores private exception slip images only. Public `/p/[token]` pages do all data lookup server-side. Each request receives only that payment's minimal display fields.

Workbook name: `Coaching Payments - Automated`. It is freshly created for this project and is never selected, mutated, or migrated from an existing workbook. Its exact six tabs are `Dashboard`, `Clients`, `Payments`, `Review Queue`, `Settings`, and `Audit Log`; first-run records the resulting spreadsheet ID in Vercel environment configuration. Runtime never searches Drive for a workbook. The connected Sheets tooling will create/configure it; server-side Google API credentials will be granted to that one file only.

## Spreadsheet

- `Dashboard`: first tab; formula-based metrics, Due/Pending, Needs Review, and Recent views. Green = `AUTO_RECORDED`/`MANUAL_CONFIRMED`; orange = `REVIEW`; red = `FLAGGED`/overdue; currency/dates are THB/Bangkok formatted.
- `Clients`: stable ID, active flag, display/LINE names, default THB amount, MONTHLY/MANUAL frequency, next due date, notes and timestamps.
- `Payments`: immutable payment/client IDs, random public token/URL, expected amount/due date, status, immutable source-analysis fields, payment timestamps, copyable LINE message, notes.
- `Review Queue`: formula/filter view exposing only `REVIEW` and `FLAGGED` records, their reason, extracted signals, and private slip link.
- `Settings`: display name, PromptPay type/identifier, Thai/English receiver aliases, timezone, public base URL, retention, OCR and auto-record feature flags. Required values are visibly `CONFIG_REQUIRED` until set.
- `Audit Log`: append-only status/action changes. Manual spreadsheet override to `MANUAL_CONFIRMED` is detected and logged by the runtime action flow and dashboard formulas.

## Payment and Processing Flow

1. Monthly generation creates exactly one `PENDING` payment per active MONTHLY client/period. Idempotency key is `client_id + period`; manual rows remain supported.
2. Payment has a 256-bit random URL token. `p/[token]` shows configured business name, client first name, period, exact amount, configured receiver display name, and an EMVCo PromptPay QR generated from configured identifier plus amount. QR can be saved as PNG/SVG.
3. Client upload accepts decoded JPEG, PNG, WebP only; type, signature, maximum 10 MB byte size, 4,000-pixel dimensions, and pixel count are checked. Submission rate limits by token and IP.
4. Server calculates SHA-256, detects exact-image duplicates, decodes all QR candidates, chooses a structurally valid Thai slip mini-QR when present, validates CRC when format supports it, and stores only raw-QR hash plus bank/ref/validity fields.
5. Local `tesseract.js` (Thai + English) runs in an asynchronous best-effort path. Preprocess orientation/grayscale/contrast, normalize money, recipient text, transaction reference, and Bangkok dates including Buddhist Era.
6. `evaluatePayment(payment, analysis, history)` applies explicit gates, never an AI claim: clean unique valid QR/ref + exact amount + accepted receiver match + plausible date -> `AUTO_RECORDED`; missing/uncertain evidence -> `REVIEW`; duplicate image/ref, malformed submission, clear wrong amount or receiver -> `FLAGGED`. Same unique hash/ref on same payment is idempotent.
7. The client sees either “Payment slip received and recorded” or “received; it will be reviewed.” Never “bank verified.” Staff use the spreadsheet to set exceptions to `MANUAL_CONFIRMED` after checking SCB.

## Safety and Operations

- `PROMPTPAY_IDENTIFIER`, receiver aliases, `ADMIN_SECRET`, Sheets credentials, Vercel Blob credentials, and cron secret are server-only env values. No values are invented.
- Workbooks/slips are private. No public CSV, public editing, Base64 in Sheets, account details, QR payloads, slips, or private keys in logs.
- `AUTO_RECORDED` means operationally paid, not bank-verified. `MANUAL_CONFIRMED` means owner reviewed it; no other successful status exists.
- Auto-recorded slips use configurable short retention; `REVIEW`/`FLAGGED` slips are privately retained. Failure to store an exception slip moves payment to `REVIEW` rather than falsely accepting it.
- Vercel Cron calls a protected monthly generation endpoint. A protected manual route provides the same idempotent operation.

## Test and Acceptance Evidence

Unit tests must prove PromptPay/CRC vectors, amount integer-satang parsing, Thai dates, QR mini-payload parsing/CRC/multiple candidates, duplicate idempotency/cross-payment flags, receiver matching, deterministic decision outcomes, upload validation, repository rows/audit records, and secure token lookup. Production smoke test must create/read/write a test row, generate a payment, load its public page, submit a valid controlled image, and confirm dashboard/review formulas respond.

## Known Configuration Needed After Delivery

Owner must enter real PromptPay identifier, recipient Thai/English alias set, business display name, and Google service-account access. Until then health endpoint reports `needs_configuration`; it does not create QR payments or claim readiness.

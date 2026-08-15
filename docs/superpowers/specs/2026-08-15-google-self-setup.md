# Google self-setup architecture

The application has two separate Google data planes:

1. `getBootstrapSheets()` uses the developer service account and the private workbook configured by `SPREADSHEET_ID`. It stores the installation owner and encrypted integration records only.
2. `getGoogleSheets()` uses the permanent owner's encrypted OAuth refresh token and the active operational workbook ID. All clients, schedules, payments, settings, and audit operations use this client.

The first verified Google `sub` reserves the installation through the fixed `installation_owner_claim` named range. The same identity is idempotent; competing identities are rejected. Eight-hour admin cookies contain only the owner `sub`, normalized email, and expiry and are signed with `ADMIN_SECRET`.

OAuth uses the existing callback, state, PKCE, nonce, ID-token verification, and `openid email drive.file`. The target connection is written as `google_workspace_pending`. It becomes `google_workspace_connection` only after the operational workbook schema and Drive folder write/delete probe both pass.

The setup wizard creates one immutable `Coaching Payments - Automated` workbook with `Clients`, `Installment Schedule`, `Payments`, `Settings`, and `Audit Log`, then creates or selects a private slip folder. Business and feature configuration is validated and written to `Settings`; Google and LINE tokens remain encrypted in the bootstrap key safe.

Public payment, cron, slip, and LINE paths load validated runtime settings asynchronously. Incomplete cron setup returns `503` without writes. Incomplete or disabled LINE setup returns `404` before reading the request body. Health output contains safe category states only.

Google OAuth consent must be published as Production before handoff so external Testing refresh tokens do not expire after seven days.

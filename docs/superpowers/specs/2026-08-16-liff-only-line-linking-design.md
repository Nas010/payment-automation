# LIFF-Only LINE Linking

## Goal

Make LIFF the only supported LINE account-linking path. Remove the legacy chat-command linker, its connection replies, and its workbook fields. No active client data needs migration.

## Runtime Behavior

`POST /api/line/connect` remains the sole account-linking endpoint. It continues to verify the LIFF ID token server-side, consume the encrypted connection token, persist the LINE identity, and trigger due initial-payment delivery.

`POST /api/line/webhook` continues to verify LINE signatures, process payment-slip images, and refresh profiles for already-linked users. Text such as `LINK ABCDEF0123` receives no connection reply and performs no linking operation.

Reconnect, disconnect, test-recipient linking, LINE profile refresh, payment delivery, and payment-slip replies remain supported.

## Code Removal

Delete the legacy link-code generator, command parser, instruction renderer, direct-message linking service, and their tests. Remove the code-reservation branch from the Sheets client repository. Move still-current profile refresh and disconnect behavior into LIFF-oriented modules before deleting the legacy linking module.

Keep current LIFF token and LINE-user reservations. Existing LIFF audit names may continue using `LINE_LINK_*` because they describe current account-link state, not the removed chat-command mechanism.

## Workbook Schema

Remove these Clients columns from `CLIENT_HEADERS`, client record types, row writes, workbook setup, and tests:

- `line_link_code`
- `line_link_code_expires_at`
- `line_link_message`

Client schema setup detects those legacy headers and physically deletes their columns in descending index order before normal repository access. Values in those columns are intentionally discarded. It also deletes stale `line_link_code_*` named ranges. No row-data conversion or preservation path is required because there are no active clients. New workbooks start with the LIFF-only schema; existing workbooks converge to it automatically.

Keep LIFF-owned fields: link status, linked timestamp, link error, token hash, encrypted token, token expiry, LINE user identity, display name, and picture URL.

## Reply Settings

Change automatic reply config to payment-slip replies only. Remove all connection-reply fields, defaults, mapping logic, server actions, dashboard editors, descriptive copy, and tests.

Keep the existing automatic-reply setting key for custom slip-reply continuity. Parsing accepts only the new slip-only shape; no legacy connection-reply migration is required.

## Failure Handling

Webhook acknowledgement remains independent per event. Unsupported text events are ignored. Slip processing and profile refresh failures retain their current isolation and audit behavior. LIFF connection failures retain current safe status responses.

## Verification

Focused tests must prove:

- `LINK <code>` webhook messages do not link or reply;
- payment-slip webhook processing still works;
- linked-user profile refresh still works;
- LIFF connect, reconnect, disconnect, and test-recipient connection still work;
- reply config and dashboard contain only slip replies;
- Clients schema and atomic LINE updates use the reduced column layout.

Run lint, full Vitest suite, and production build after focused tests pass.

# Local Development Dashboard Design

## Goal

Run every dashboard workflow locally with representative data and writable state, while making it structurally impossible for the local process to use production credentials, Google workbooks, Google Drive, LINE, Vercel, or payment-side effects.

## Decision

The application does not have a production database to clone. Its system of record is an operational Google workbook plus a private Drive folder. Local development will emulate that workbook and folder rather than copy their data. The emulator will use the production record contracts and sheet-tab headers as its schema source, but seed only synthetic fixtures.

SQLite is not selected. It would introduce a second, independently maintained relational schema that can drift from the workbook-backed production system. A local JSON workbook store preserves the tab/row model the application actually uses, requires no networked database, and can be inspected or reset easily.

## Entry Point and Safety Boundary

`npm run dev:local` will start the Next.js application in an explicit local-preview mode. The command will load only a committed, non-secret local environment template and write all mutable state beneath an ignored `.local-dev/` directory.

The mode is opt-in through one dedicated environment flag. Startup must fail before serving requests when either of these conditions is true:

- a Vercel/production environment marker is present;
- a production base URL, production workbook ID, or any configured Google/LINE credential is supplied;
- the local state directory resolves outside the repository's `.local-dev/` directory.

`.env.local` is never read by `dev:local`; it remains available only for an intentionally configured developer integration environment. The local mode config includes unique inert secrets used only for signing test sessions and cron calls.

## Local Workbook and Fixture Data

The local store contains a JSON representation of the existing operational workbook tabs and immutable test records:

- installation and workspace-connection records;
- Clients, Installment Schedule, Payments, Settings, and Audit Log rows;
- integration-secret metadata, with synthetic values held only in local state;
- local file metadata and bytes for payment slips and T&S images.

Seed data will cover active, overdue, review, confirmed, recurring, LINE-linked, and unlinked client states so every existing admin screen has meaningful content. The store uses current record types and schema/migration helpers; its headers are derived from the same constants used for production workbook validation. A reset command deletes only the validated local state directory and recreates fixtures.

## Application Behavior

Local-preview mode replaces infrastructure boundaries, not dashboard pages or business rules:

- Admin authentication creates a fixed local owner session; no Google sign-in occurs.
- Workspace setup and Google Drive controls complete against the local workbook/file store and visibly identify the environment as local.
- Sheets repositories read and write local tab rows. Existing query, payment-generation, audit, scheduling, status-transition, and runtime-configuration logic continue to execute.
- Drive upload/download calls read and write local files only.
- LINE send, LIFF verification, webhook delivery, and OCR processing return deterministic simulated results and append local audit activity. They make no outbound requests.
- Public payment pages, PromptPay QR generation, slip submission, and cron routes execute against local data. Local cron authentication uses the inert local secret.

Every simulated integration returns clear local-only status/copy, so a UI review cannot be mistaken for a delivery or real verification.

## Isolation Architecture

Introduce a small runtime-environment selector with two implementations:

1. Production implementation: existing Google/Drive/LINE adapters, unchanged when local-preview mode is absent.
2. Local implementation: filesystem-backed workbook, storage, authentication, and integration simulators.

Routes and server actions access these through focused boundary functions. No route may branch on local mode to fabricate a production result. The browser receives normal existing page data plus a persistent local-preview banner. Server-only validation controls the mode; no client-provided flag can enable it.

## Errors and Reset

Invalid local configuration, corrupted state, or prohibited provider usage returns a safe developer-facing error before any external call. The error includes the local reset command where appropriate, never credential values. Atomic filesystem writes prevent partially written tab rows. The reset command validates its exact target and refuses to operate outside `.local-dev/`.

## Tests and Verification

Tests will prove:

- local mode rejects production markers and configured external credentials;
- local store round-trips every supported operational tab/record shape and resets only local data;
- local auth permits the synthetic owner while normal mode preserves current auth behavior;
- representative dashboard, client, payment, setup, settings, slip, LINE, and cron actions mutate local state and emit local audit records;
- simulated provider adapters never invoke network clients;
- normal production-mode unit tests retain existing adapter behavior.

End-to-end local verification starts `dev:local` from a clean repository state, opens the protected dashboard without OAuth, performs representative writes, checks persisted local state, and confirms no production environment file was loaded. Full lint, test, and production build remain required before completion.

## Non-Goals

- Copying production workbook rows, Drive files, secrets, OAuth tokens, or customer data.
- Calling Google, LINE, Vercel, payment, or OCR services from local-preview mode.
- Using local UI output as proof that an external delivery, payment, or OCR service works.

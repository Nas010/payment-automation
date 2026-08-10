# Sheets Admin MVP Design

## Goal

Build a protected Next.js admin for coaching payments while Google Sheets stays the operational system of record.

## Decisions

- Next.js is the normal writer for `Clients`, `Installment Schedule`, `Payments`, `Settings`, and `Audit Log`; the browser never accesses Google APIs directly.
- `Installment Schedule` is canonical for payment-link generation. Legacy monthly-client generation is removed from normal paths.
- Every Sheets read returns a physical row number. Updates target that number, never an index from filtered records.
- `Review Queue` is derived from payment status, never independently written.
- All payment-status mutations use one domain transition that updates payment, linked schedule, and audit log.
- Existing deployment configuration does not include OAuth credentials. The MVP protects `/admin` with an `ADMIN_SECRET`-verified, HttpOnly session cookie. This preserves the server boundary and can be replaced with OAuth later.

## Product Surface

`/admin/login`, `/admin/dashboard`, clients list/new/detail, payments list/detail, review queue, packages, settings, and audit log. Shared shell: responsive sidebar, header, status badges, tables, empty states, and confirmation dialog for manual confirmation.

## Data Flow

Admin pages are Server Components. Interactive forms call same-origin server actions or route handlers protected by the session. Domain services call Sheets repositories. Creation writes client + schedule + audit. Due-link generation writes payment + schedule + audit. Slip processing and manual review call the transition service.

## Safety and Error Handling

Forms validate with Zod. Financial amounts use integer satang while plans are split. Month-end schedule dates clamp to the last valid calendar day. An admin cannot create `AUTO_RECORDED`; manual confirmation requires a reason and acknowledgement. Missing deployment configuration renders an actionable error instead of exposing credentials.

## Verification

Unit tests cover schedule planning, row-number update behavior, schedule-driven generation, and status transition validation. Full test suite, lint, production build, and browser smoke checks cover the result.

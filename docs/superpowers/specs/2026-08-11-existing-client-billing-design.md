# Existing Client Billing Design

## Goal

Let an admin extend an existing client with another active package or add a custom one-time/recurring charge without creating a duplicate client.

## Product Decisions

- Add two prominent actions to each client detail page: `Assign package` and `Add manual payment`.
- Package assignment uses the selected active package's saved price and installment defaults. Admin chooses first due date and may add notes.
- Manual payment uses a custom description and amount. It can be one-time or a finite recurring series with a payment count and whole-month interval.
- “Recurring” means a finite schedule. Open-ended subscriptions are out of scope because the workbook's canonical model is a finite `Installment Schedule`.
- Both actions append schedule rows. Existing schedules, payments, and audit history remain unchanged.
- Assigning a package updates the client row's current package summary and next due date. Adding a manual payment does not replace that package summary.
- Newly scheduled rows receive payment links through the existing due-link generator at or after their due date. These actions do not trigger unrelated due rows or bypass the normal payment pipeline.

## Alternatives Considered

### Recommended: reuse `Installment Schedule`

Append rows using the existing schedule contract. Package extensions use the package name; custom charges use the admin's description. Existing cron/manual generation, PromptPay pages, slip checks, payment transitions, and audit behavior work unchanged. No workbook migration is required.

### Add package-assignment and recurring-payment sheets

This would model package history and indefinite recurrence more explicitly, but requires workbook migration, new repositories, generation logic, and dashboard joins. Cost and operational risk exceed this feature's needs.

### Create payment rows directly

This provides an immediate link but bypasses the canonical schedule, makes future recurring rows inconsistent, and duplicates generation/audit logic. Rejected.

## Architecture

Create a focused plan-assignment domain module that converts validated package/custom inputs into canonical schedule rows. Server actions authenticate, load the client and active package where needed, call the domain helper, persist rows, update the client summary only for package assignments, append one audit event, revalidate admin views, and redirect back to the client.

Keep client forms in a dedicated client component. It receives active package data and bound server actions from the Server Component page. Existing shadcn `Card`, `Field`, `Input`, `Select`, and `Button` components provide accessible responsive forms without new dependencies.

Extract client payment-summary calculation into a pure admin helper. Client detail totals come from every schedule row, not the latest package snapshot, so extensions and custom charges are represented correctly.

## Data Flow

### Assign package

1. Admin selects an active package, first due date, and optional notes.
2. Server validates the client ID, package state, amount, installment count, interval, and date.
3. Domain helper splits the package total into schedule rows with clamped monthly dates.
4. Server writes each schedule, updates the client row to the new package defaults/current next due date, and appends `PACKAGE_ASSIGNED` audit metadata.
5. Client detail reloads with updated totals and schedule history.

### Add manual payment

1. Admin enters description, amount, first due date, notes, and one-time or recurring terms.
2. Server validates positive integer-satang amount. One-time normalizes to one payment/zero interval; recurring requires at least two payments and an interval of at least one month.
3. Domain helper creates schedule rows whose package label is the custom description.
4. Server writes rows and appends `MANUAL_PAYMENT_SCHEDULED` audit metadata. Client package fields are untouched.
5. Existing due-link generation creates each payment link when due.

## UI

Place a `New billing` section after client summary metrics and before LINE details. Two side-by-side cards collapse vertically on small screens:

- `Assign package`: package selector, first due date, notes, concise selected-plan summary, submit button.
- `Add manual payment`: description, amount, first due date, frequency selector, conditional payment count/month interval, notes, submit button.

Update the schedule table with a `Plan or charge` column and chronological ordering. Empty schedule/payment/activity states remain readable instead of rendering blank regions.

## Validation and Errors

- Every action calls `requireAdmin` before reading or writing.
- Missing/inactive package or client fails before writes.
- Money uses `parseSatang`; zero, negative, malformed, or unsafe amounts fail.
- Dates and plan constraints are validated by Zod plus `buildInstallmentPlan`.
- Package assignment updates the client only after all schedule writes succeed. Existing Sheets writes are not transactional; failures surface through the protected route boundary and do not produce a success audit event.
- Submitted client IDs and package definitions are loaded from Sheets rather than trusted from browser fields.

## Testing

- Pure domain tests prove schedule construction, satang remainder handling through the existing planner, copied client/LINE fields, and package/custom labels.
- Server-action tests prove auth, active-package enforcement, schedule writes, package-summary update, manual-payment non-mutation, normalized one-time terms, recurring validation, audit metadata, revalidation, and redirect.
- Component tests prove both workflows are visible, default one-time terms submit correctly, and recurring controls are available.
- Summary-helper tests prove totals span multiple package/custom schedules, paid/outstanding amounts, and chronological next due date.
- Final verification runs focused tests, full `npm test`, `npm run lint`, `npm run build`, and desktop/mobile browser workflow checks.

## Out of Scope

- Infinite subscriptions, weekly/daily recurrence, partial package cancellation, editing/deleting schedule rows, package-assignment IDs, immediate link generation before due date, live vendor configuration, or spreadsheet schema changes.

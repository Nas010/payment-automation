# Editable Existing-Client Package Plans Design

**Status:** Approved
**Date:** 2026-08-16

## Goal

Let an admin assign another active package to an existing client while configuring the same payment-plan terms available during new-client creation.

## User Experience

The existing-client **Assign package** card will include the new-client payment-plan controls:

- Package
- Payment type: one-time payment or installments
- Total price (THB)
- First due date
- Installment count
- Interval months
- Notes

Selecting an active package preloads its saved price and plan defaults. All plan fields remain editable before submission. Changing payment type to one-time forces installment count to `1` and interval months to `0`, and marks those inputs read-only. Installments show the same labels and help text as the new-client form.

The package catalogue remains a template source. Editing an assignment does not modify its saved package row.

## Architecture

Keep package terms in the existing package catalogue and canonical schedules in `Installment Schedule`; no workbook migration or new service is required.

Extract a client-side `PaymentPlanFields` component for package selection, package-default loading, payment type, total price, due date, installment count, interval, and notes. Both `ClientForm` and the existing-client assignment form use it; their parent forms retain client-name handling, card layout, submit action, and submit copy. The shared component receives an ID prefix so labels remain unique on the detail page. This keeps visible configuration and defaulting behavior in parity without coupling client-name creation to assignment.

`assignPackageAction` accepts final submitted terms rather than reading price, payment type, count, and interval from the selected package after form submission. It still loads the selected package from Sheets and requires it to be active, so the browser cannot assign an inactive or nonexistent package.

## Data Flow

1. The page supplies active packages to the existing-client billing component.
2. Selecting a package applies its saved defaults to editable fields.
3. The form submits the selected package name plus final payment type, total price, installment count, interval, first due date, and notes.
4. The server authenticates, loads the existing client and active package, validates and normalizes submitted terms, then builds schedule rows from those final terms.
5. The server writes schedule rows, generates/sends only the initial due payment through the existing pipeline, updates the client's current plan summary, appends `PACKAGE_ASSIGNED` audit metadata with final terms, revalidates client pages, and redirects back to the client.

## Validation and Error Handling

- Package name must identify an active saved package.
- Total price uses `parseSatang`; malformed, zero, negative, and unsafe values fail before any schedule write.
- Payment type is exactly `ONE_TIME` or `INSTALLMENTS`.
- One-time assignments always normalize to one payment and zero interval, regardless of submitted count or interval.
- Installment assignments require an integer count of at least two and a whole-month interval of at least one.
- First due date keeps the existing ISO date validation; notes remain optional.
- The client summary and audit record use normalized final terms, not package defaults.
- Existing Sheets writes remain non-transactional. If a write fails, no success audit event or redirect occurs.

## Testing

- Component tests prove package selection preloads all terms, installments can be edited and submitted, and one-time selection submits normalized count/interval values.
- Server-action tests prove submitted overrides determine schedule rows and client summary, one-time terms normalize, inactive packages remain rejected, and invalid installment count/interval fails before writes.
- Existing package-assignment, new-client, schedule, and manual-payment tests remain green.
- Final verification runs `npm run lint`, `npm test`, and `npm run build`.

## Non-Goals

- Editing a saved package template from a client assignment.
- Changing manual-payment behavior.
- Altering prior schedules, payments, or audit history.
- Adding open-ended subscriptions, new Sheets columns, or live vendor configuration.

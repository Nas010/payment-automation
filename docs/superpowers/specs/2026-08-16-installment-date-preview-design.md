# Installment Date Preview Design

**Status:** Approved
**Date:** 2026-08-16

## Goal

Give admins an immediate, compact view of every scheduled installment while configuring a new client or assigning a package to an existing client.

## User Experience

Both payment-plan forms show a small **Schedule preview** below the payment-plan inputs. Each row displays the installment number, its exact due date, and its exact THB amount. The preview updates as the package, payment type, total price, first due date, installment count, or interval changes.

One-time plans show one row. Installment plans show every scheduled row, including the final row's remainder when the total cannot be divided evenly. Invalid or incomplete values show no dates, preventing misleading schedule information.

## Architecture

`PaymentPlanFields` remains the shared form surface used by new-client creation and existing-client package assignment. It renders a focused `InstallmentPreview` child with the currently watched form values.

The preview uses the existing `buildInstallmentPlan` calculation, plus existing date and THB formatters. Therefore dates use the identical month-end clamping and amounts use the identical final-remainder allocation as saved schedule rows. No server action, Sheets schema, or submission payload changes.

## Error Handling

The preview treats malformed dates, non-positive/non-integer installment values, invalid intervals, and invalid prices as unavailable. It catches the schedule builder's validation error and renders no rows until values become valid.

## Testing

Component tests cover both forms and assert rendered rows contain exact clamped dates and split amounts. Existing schedule tests remain the authority for schedule calculation. Final verification runs focused component tests, lint, full test suite, production build, then deployment.

## Non-Goals

- Editing schedule rows from the preview.
- Changing payment-plan validation or saved schedule behavior.
- Changing manual-payment forms.

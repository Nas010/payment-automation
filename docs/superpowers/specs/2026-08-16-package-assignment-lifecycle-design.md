# Package Assignment Lifecycle Design

## Goal

Let an admin change an already assigned client package, pause it, end it early, or delete it safely. The workflow must preserve paid-in-full (PIF) and installment history, never accept payment on a revoked link, and keep manual charges outside package lifecycle controls.

## Product Decisions

- A package assignment is a group of schedule rows with one `assignment_id`. New-client and existing-client package assignment both create that identity. Manual charges have an explicit `MANUAL` kind and are never lifecycle-managed as packages.
- Existing schedule rows remain supported without a workbook data rewrite. They are grouped by their existing client, package, payment terms, and creation timestamp. A legacy group is package-managed only when its label matches a saved package.
- Paid schedule rows and terminal payment records are immutable financial history. No lifecycle action changes their amount, due date, payment status, or payment link.
- Change package ends only outstanding rows on the old assignment, credits recorded payments toward the target package price, then schedules only the positive remainder under the selected target package terms. A PIF downgrade therefore creates no charge and no automatic refund; any excess is visible in audit metadata and must be handled separately by the coach. A PIF upgrade schedules only the price difference.
- Pause retains an assignment's unpaid balance but stops collection. It invalidates any unrecorded payment links and marks remaining schedule rows `PAUSED`. Resume returns those rows to `SCHEDULED` for normal generation.
- End early cancels all outstanding rows and invalidates their unrecorded payment links. It cannot be resumed.
- Delete is allowed only when the assignment has no paid rows. It marks all its rows `DELETED` and invalidates unrecorded payment links; it does not erase workbook or audit history.
- Submitted, reviewed, or flagged payments block package change/end/delete until a coach resolves them. A merely pending generated link can be safely voided.

## Alternatives Considered

### Recommended: assignment metadata on canonical schedule rows

Add `assignment_id` and `assignment_kind` to `Installment Schedule`. This preserves the single canonical schedule ledger while allowing reliable grouping of new assignments. A lightweight schema migration appends blank columns to existing workbooks, so there is no live data rewrite or extra sheet.

### Add an Assignment workbook tab

This would model package state independently but expands the fixed five-sheet operational workbook, adds a cross-ledger transaction problem, and requires more migration and reconciliation. Rejected.

### Infer every assignment forever from package labels and timestamps

This works for legacy visibility but fails if two matching packages are assigned at the same instant and cannot mark newly created assignments reliably. Rejected except as a read-only legacy fallback.

## Architecture

`src/lib/plans/assignment-lifecycle.ts` owns assignment grouping, legacy identity, status derivation, paid/outstanding sums, and safe schedule update plans. Sheet repositories extend the schedule schema to twenty columns and migrate missing headers before reads/writes. Payment generation continues to select only `SCHEDULED` rows, so paused, ended, and deleted rows are automatically excluded.

Protected server actions load the client, packages, schedules, and payments; validate assignment ownership/state; void only `PENDING` generated payments; update outstanding schedule rows; append one audit event; refresh client views; and redirect. A voided payment remains in Payments for traceability but is rejected by public payment, QR, and slip-submit paths. Each row that formerly carried its payment link is detached so a later resume can generate a fresh link.

The client detail page receives a derived assignment read model. A client component displays active, paused, ended, deleted, and completed package assignments with their paid and remaining values. It provides replacement, pause/resume, early-end, and delete controls. Existing `Assign package` continues to add an independent package; manual charges remain separate.

## Data Flow

### Change package

1. Admin chooses a target active package and an effective first due date on an active or paused assignment.
2. Server totals `PAID` schedule rows in that assignment and validates all non-paid generated payments are still `PENDING`.
3. Server voids/detaches unrecorded payment links and changes old outstanding schedule rows to `CANCELLED`.
4. It calculates `max(target package total - paid amount, 0)`. If positive, it creates a new `PACKAGE` assignment for that amount with the target package's payment type, count, and interval.
5. It updates the client package snapshot, records the change, paid credit, remaining amount, and excess credit in Audit Log, then starts normal initial-link generation for the new assignment.

### Pause, resume, end, delete

1. Pause validates no submitted/reviewed payment, voids/detaches unrecorded links, and marks unpaid rows `PAUSED`.
2. Resume marks paused rows `SCHEDULED`; normal due-link generation creates a fresh link when eligible.
3. End follows pause invalidation but marks rows `CANCELLED` permanently.
4. Delete follows end invalidation but requires zero paid rows and marks rows `DELETED` without erasing history.

## Error Handling and Security

- Every action requires the admin session and derives the assignment from current Sheets data, never browser-supplied price, row, or paid status.
- A lifecycle action rejects unknown, non-package, completed, ended, deleted, or foreign assignments.
- A generated payment must exist and be `PENDING` before it can be voided. `REVIEW` and `FLAGGED` payments are explicitly blocked because money may already have arrived.
- Public payment rendering, QR generation, and slip upload reject `VOID` payments. This prevents a stale payment URL from accepting an upload after package replacement, pause, end, or deletion.
- Partial Sheets writes cannot report success because the audit record and redirect occur only after all required updates complete. Any interrupted sequence leaves the payment void before a schedule link is detached, preferring collection safety.

## Testing

- Unit tests cover new/legacy grouping, package-vs-manual classification, assignment states, paid/outstanding totals, and lifecycle schedule updates.
- Repository and migration tests prove the appended schedule columns work for new and legacy workbooks, including payment snapshots and provisioning.
- Action tests cover installment/PIF upgrades and downgrades, pause/resume, early end, delete guards, voiding pending links, and review-payment blocking.
- UI tests cover assignment actions, monetary summaries, target selection, and manual-charge exclusion.
- Public page/API tests prove voided links do not render a QR or accept a slip.
- Final verification runs focused tests, `npm run lint`, `npm test`, and `npm run build`.

## Out of Scope

- Automatic refunds, credits applied to other assignments, partial payment allocation, editing historical paid rows, automatic migration of legacy row values, recurring open-ended subscriptions, and live payment-provider mutations.

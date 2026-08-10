# Dashboard metrics and date formatting design

## Goal

Make every user-facing date and time in the application readable and consistent. Add dependable month-over-month dashboard indicators without inventing historical client data.

## Scope

- Render date-only values as `10 Aug 2026`.
- Render timestamps as `10 Aug 2026, 15:20`.
- Use the business timezone, `Asia/Bangkok`, for every display and monthly boundary.
- Update all current admin surfaces that show due dates, payment timestamps, audit timestamps, client activity, or OCR transaction dates. Apply the same helpers to any remaining user-facing date fields found during implementation.
- Add month-over-month indicators only to **Active clients** and **Collected this month**.
- Make the collected-amount display configurable in Settings: absolute THB delta (default) or percent change.

Data storage formats, Sheets date columns, API payload formats, payment generation, and Thai slip parsing remain unchanged.

## Considered approaches

1. Derive active-client deltas from today's client records. Rejected: active state is mutable and has no historical deactivation record, so a past active count cannot be reconstructed accurately.
2. Write a baseline during dashboard reads. Rejected: it adds a write side effect to a read path and can capture a stale value if nobody views the dashboard near month end.
3. Store one active-client snapshot at each Bangkok month boundary through an authenticated scheduled job. Selected: it is idempotent, accurate for future months, and leaves the dashboard read path read-only.

## Shared display API

Extend `src/lib/date.ts` with presentation-only helpers alongside its existing Thai-slip parser:

- `APP_TIME_ZONE = "Asia/Bangkok"`
- `formatDate(value)` returns `10 Aug 2026` for an ISO date or timestamp.
- `formatDateTime(value)` returns `10 Aug 2026, 15:20` for a valid timestamp.
- Empty or invalid values return `—`.

Date-only values are parsed as Bangkok calendar dates, not UTC instants. This prevents a date stored as `2026-08-10` from rendering as the previous day in a negative-offset runtime. Formatting stays server-safe and deterministic by explicitly setting locale and timezone.

Every page imports these helpers rather than rendering raw Sheets values or calling `Intl.DateTimeFormat` inline.

## Dashboard comparison data

### Collected this month

The dashboard read model already identifies recorded or manually confirmed payments in the current Bangkok month. It will also sum finalized payments in the immediately previous Bangkok month. The result exposes a comparison only when a previous-month payment dataset exists.

The comparison is current minus previous:

- positive: increase
- negative: decrease
- zero: unchanged

Percent change is undefined when the previous total is zero. In that case the tooltip uses the absolute delta even if the display preference is percentage.

### Active clients

`Settings!A:B` stores one idempotent snapshot per completed month with key `dashboard_active_clients_YYYY-MM` and an integer count. An authenticated cron route runs at 00:05 Bangkok on the first day of each month, records the count for the month just ended, and safely overwrites the same key if retried.

The Vercel cron schedule invokes only during the final four UTC days of a month; the route checks that the Bangkok calendar date is the first before writing. This supports every month length while avoiding an unreliable local-time cron expression.

The dashboard compares today's active count with the previous month snapshot. No active-client indicator appears until that snapshot exists. The dashboard never writes snapshots itself.

The new cron route follows the existing `CRON_SECRET` bearer-token authorization pattern. Unauthorized requests return 401; valid off-schedule requests complete without changing Sheets.

## Interface

`MetricCard` gains an optional trend slot rendered with shadcn `CardAction`, putting it in the top-right without custom positioning.

Each available trend is an icon-only affordance:

- up arrow: semantic positive green
- down arrow: `destructive` red
- flat delta: muted neutral icon
- unavailable data: no icon

The icon has a screen-reader label and uses the installed shadcn tooltip primitives. The tooltip names current and prior values and shows the selected absolute or percentage delta. This keeps cards clean while preserving the requested comparison detail.

The Settings page receives a dedicated Dashboard display card using its installed shadcn `Select`. It persists a validated `dashboard_collected_delta_display` value of `absolute` or `percentage`; absence or invalid values resolve to `absolute`.

Add a semantic positive color token in the existing global theme. Do not introduce raw Tailwind palette colors or bespoke card markup.

## Error handling

- Invalid display dates render `—`; rendering does not throw.
- Missing or malformed snapshot settings are treated as unavailable comparison data.
- Snapshot writes rely on the existing Settings upsert behavior and are safe to retry.
- Settings submission validates the supported display values before writing.
- Cron authorization and its normal Sheets failures follow the established generate-cron route behavior.

## Verification

Tests will cover:

- Date-only, ISO timestamp, invalid, and empty formatting behavior in Bangkok.
- Current/previous month collection totals, zero prior-month totals, and unavailable active snapshot behavior.
- Snapshot key creation, prior-month targeting, first-of-month guard, authorization, and retry idempotency.
- Dashboard settings parsing and server-action validation.

Run targeted Vitest tests while implementing, then `npm run lint`, `npm test`, and `npm run build`. Manually inspect the dashboard at desktop and mobile widths: icon placement, tooltip text, missing-data state, and uniform date rendering.

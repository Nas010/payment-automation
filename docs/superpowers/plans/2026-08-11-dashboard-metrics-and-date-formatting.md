# Dashboard Metrics and Date Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render dates consistently across the platform and add reliable, accessible month-over-month indicators for Active clients and Collected this month.

**Architecture:** Presentation helpers in `src/lib/date.ts` own the Bangkok date/time formats. `src/lib/admin/dashboard-metrics.ts` owns month arithmetic, settings parsing, metric comparison, and snapshot-key creation; queries and cron routes use it instead of duplicating rules. Dashboard UI composes installed shadcn Card and Tooltip primitives, while Settings persists only the selected collection-delta format.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, Google Sheets API, Vercel Cron, shadcn/ui with Base UI primitives, Tailwind CSS v4, Lucide.

## Global Constraints

- Use `Asia/Bangkok` for display and monthly-boundary rules.
- Date format: `10 Aug 2026`; timestamp format: `10 Aug 2026, 15:20`.
- Invalid or empty display values render `—`; Sheets storage formats remain unchanged.
- Add no dependencies.
- Use existing shadcn `CardAction`, `Select`, and `Tooltip`; `SelectItem` remains inside `SelectGroup` and Base UI triggers use `render` where required.
- Top-right metric trends are icon-only; unavailable comparison data renders no trend.
- Positive color comes from a semantic global theme token; decreases use `text-destructive`.
- Keep dashboard reads side-effect free. Only authenticated cron writes active-client snapshots.
- Tests do not call live Google Sheets or Vercel.

---

### Task 1: Add deterministic date presentation helpers

**Files:**
- Modify: `src/lib/date.ts`
- Modify: `src/lib/date.test.ts`

**Interfaces:**
- Produces: `APP_TIME_ZONE`, `formatDate(value: DateDisplayValue): string`, `formatDateTime(value: DateDisplayValue): string`, and `bangkokDateKey(value?: Date): string`.
- Consumes: no new dependencies; existing `parseThaiSlipDate` remains exported and behaviorally unchanged.

- [ ] **Step 1: Write failing formatter tests**

Add these cases to `src/lib/date.test.ts` before changing production code:

```ts
import { formatDate, formatDateTime } from "./date";

it("formats Bangkok calendar dates without UTC day drift", () => {
  expect(formatDate("2026-08-10")).toBe("10 Aug 2026");
  expect(formatDate("2026-08-10T00:30:00.000Z")).toBe("10 Aug 2026");
});

it("formats timestamps in Bangkok time", () => {
  expect(formatDateTime("2026-08-10T08:20:45.439Z")).toBe("10 Aug 2026, 15:20");
});

it("renders unavailable display dates as an em dash", () => {
  expect(formatDate("")).toBe("—");
  expect(formatDateTime("not-a-date")).toBe("—");
});
```

- [ ] **Step 2: Run formatter test and verify red**

Run: `npm test -- src/lib/date.test.ts`

Expected: FAIL because `formatDate` and `formatDateTime` do not exist.

- [ ] **Step 3: Implement date-only-safe formatting**

In `src/lib/date.ts`, add a narrow input type and these rules:

```ts
export const APP_TIME_ZONE = "Asia/Bangkok";
export type DateDisplayValue = string | Date | null | undefined;

function toDisplayDate(value: DateDisplayValue): Date | null {
  if (!value) return null;
  const normalized = typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value)
    ? `${value}T12:00:00+07:00`
    : value;
  const date = normalized instanceof Date ? normalized : new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: DateDisplayValue): string {
  const date = toDisplayDate(value);
  return date ? new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(date) : "—";
}

export function formatDateTime(value: DateDisplayValue): string {
  const date = toDisplayDate(value);
  return date ? new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(",", ",") : "—";
}

export function bangkokDateKey(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
```

Treat `/^\\d{4}-\\d{2}-\\d{2}$/` values as `T12:00:00+07:00` before formatting. Use explicit `en-GB` and `APP_TIME_ZONE` options in every formatter. Return `—` if parsing produces `NaN`.

- [ ] **Step 4: Run formatter tests and verify green**

Run: `npm test -- src/lib/date.test.ts`

Expected: PASS, including both pre-existing Thai-slip parser cases.

- [ ] **Step 5: Commit date helper contract**

```bash
git add src/lib/date.ts src/lib/date.test.ts
git commit -m "feat: standardize date display formatting"
```

### Task 2: Build pure dashboard comparison and settings domain

**Files:**
- Create: `src/lib/admin/dashboard-metrics.ts`
- Create: `src/lib/admin/dashboard-metrics.test.ts`
- Modify: `src/lib/admin/queries.ts`
- Modify: `src/lib/admin/queries.test.ts`

**Interfaces:**
- Produces: `DashboardComparison`, `DashboardCollectedDeltaDisplay`, `DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY`, `activeClientSnapshotKey(month: string)`, `previousMonth(month: string)`, `parseActiveClientSnapshot(settings, month)`, `parseDashboardCollectedDeltaDisplay(settings)`, and `buildDashboardReadModel(input)`.
- Consumes: `parseSatang`, record subsets from `clients`, `payments`, and `schedules`, plus `OperationalSetting` shape `{ key: string; value: string }`.
- Changes: `getAdminDashboard()` reads operational settings in parallel and passes only a parsed previous-month snapshot into the pure read model.

- [ ] **Step 1: Write failing month and comparison tests**

Create `src/lib/admin/dashboard-metrics.test.ts` with these assertions:

```ts
expect(previousMonth("2026-01")).toBe("2025-12");
expect(activeClientSnapshotKey("2026-08")).toBe("dashboard_active_clients_2026-08");
expect(parseActiveClientSnapshot([{ key: "dashboard_active_clients_2026-07", value: "3" }], "2026-07")).toBe(3);
expect(parseActiveClientSnapshot([{ key: "dashboard_active_clients_2026-07", value: "3.5" }], "2026-07")).toBeNull();

expect(parseDashboardCollectedDeltaDisplay([])).toBe("absolute");
expect(parseDashboardCollectedDeltaDisplay([{ key: "dashboard_collected_delta_display", value: "percentage" }])).toBe("percentage");
```

Move the existing `buildDashboardReadModel` fixture from `queries.test.ts` into this new test file. Extend it with one finalized July payment and one finalized August payment, then assert:

```ts
expect(result.collectedComparison).toEqual({ current: 10_000, previous: 7_500, delta: 2_500 });
expect(result.activeClientsComparison).toEqual({ current: 2, previous: 1, delta: 1 });
```

Add one fixture with no prior-month finalized payment and no client snapshot; assert both comparisons are `null`. Add one fixture with a prior zero-value finalized payment; assert `{ current: 1_000, previous: 0, delta: 1_000 }` rather than a missing collection comparison.

- [ ] **Step 2: Run metrics test and verify red**

Run: `npm test -- src/lib/admin/dashboard-metrics.test.ts`

Expected: FAIL because the module and comparison fields do not exist.

- [ ] **Step 3: Implement pure metric functions and wire query reads**

Create `src/lib/admin/dashboard-metrics.ts` with no Sheets network calls. Its exact public shapes are:

```ts
export type DashboardComparison = { current: number; previous: number; delta: number };
export type DashboardCollectedDeltaDisplay = "absolute" | "percentage";

export function buildDashboardReadModel(input: {
  today: string;
  clients: MetricClient[];
  payments: MetricPayment[];
  schedules: MetricSchedule[];
  activeClientsLastMonth: number | null;
}): DashboardReadModel;
```

Use the finalization date `(recorded_at || manual_confirmed_at || created_at)` and its `YYYY-MM` prefix. Mark a previous collection period present only when at least one finalized previous-month payment exists. Parse snapshots only when their string is a non-negative safe integer. Update `src/lib/admin/queries.ts` to call `listOperationalSettings()` with the three existing reads, calculate `previousMonth(today.slice(0, 7))`, and supply `activeClientsLastMonth` to the new pure builder. Keep `bangkokToday()` as a compatibility export but implement it through `bangkokDateKey()`.

- [ ] **Step 4: Run metrics and query tests and verify green**

Run: `npm test -- src/lib/admin/dashboard-metrics.test.ts src/lib/admin/queries.test.ts`

Expected: PASS; existing outstanding, due-today, and review metrics retain their current values.

- [ ] **Step 5: Commit dashboard domain**

```bash
git add src/lib/admin/dashboard-metrics.ts src/lib/admin/dashboard-metrics.test.ts src/lib/admin/queries.ts src/lib/admin/queries.test.ts
git commit -m "feat: calculate dashboard month comparisons"
```

### Task 3: Persist active-client history with a secured scheduled snapshot

**Files:**
- Create: `src/app/api/cron/dashboard-metrics/route.ts`
- Create: `src/app/api/cron/dashboard-metrics/route.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `serverConfig().cronSecret`, `listClients()`, `upsertOperationalSetting()`, `bangkokDateKey()`, `previousMonth()`, and `activeClientSnapshotKey()`.
- Produces: `GET /api/cron/dashboard-metrics`, returning `{ skipped: true }` outside the Bangkok first-day window or `{ month: string; activeClients: number }` after an authorized write.

- [ ] **Step 1: Write failing cron route tests**

Create `route.test.ts` using `vi.mock` for config, clients, settings, and date helpers. Cover these behaviors:

```ts
expect((await GET(new NextRequest("https://app.test/api/cron/dashboard-metrics"))).status).toBe(401);

mockBangkokDateKey.mockReturnValue("2026-08-15");
expect(await response.json()).toEqual({ skipped: true });
expect(upsertOperationalSetting).not.toHaveBeenCalled();

mockBangkokDateKey.mockReturnValue("2026-08-01");
listClients.mockResolvedValue([{ active: "TRUE" }, { active: "FALSE" }, { active: "true" }]);
expect(await response.json()).toEqual({ month: "2026-07", activeClients: 2 });
expect(upsertOperationalSetting).toHaveBeenCalledWith("dashboard_active_clients_2026-07", "2");
```

Supply the valid `Authorization: Bearer cron-secret` header for the latter two requests. Make the mock config return `{ cronSecret: "cron-secret" }` plus only fields accessed by this route.

- [ ] **Step 2: Run cron tests and verify red**

Run: `npm test -- src/app/api/cron/dashboard-metrics/route.test.ts`

Expected: FAIL because route module does not exist.

- [ ] **Step 3: Implement authenticated, idempotent snapshot route**

Implement:

```ts
export async function GET(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.cronSecret || request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = bangkokDateKey();
  if (!today.endsWith("-01")) return Response.json({ skipped: true });
  const clients = await listClients();
  const activeClients = clients.filter((client) => client.active.toUpperCase() === "TRUE").length;
  const month = previousMonth(today.slice(0, 7));
  await upsertOperationalSetting(activeClientSnapshotKey(month), String(activeClients));
  return Response.json({ month, activeClients });
}
```

Match the authorization response shape used by `src/app/api/cron/generate/route.ts`. Do not read or write Sheets for a valid off-window request.

Update `vercel.json` to retain the existing generate cron and add:

```json
{ "path": "/api/cron/dashboard-metrics", "schedule": "5 17 28-31 * *" }
```

At 17:05 UTC, the route's Bangkok-date guard selects only the execution that is 00:05 on the next local calendar day.

- [ ] **Step 4: Run cron route test and verify green**

Run: `npm test -- src/app/api/cron/dashboard-metrics/route.test.ts`

Expected: PASS for unauthorized, off-window, first-day write, and retry-safe upsert behavior.

- [ ] **Step 5: Commit active-client snapshot job**

```bash
git add src/app/api/cron/dashboard-metrics/route.ts src/app/api/cron/dashboard-metrics/route.test.ts vercel.json
git commit -m "feat: snapshot monthly active clients"
```

### Task 4: Add validated dashboard display settings

**Files:**
- Modify: `src/app/admin/(protected)/actions.ts`
- Modify: `src/app/admin/(protected)/settings/page.tsx`
- Modify: `src/lib/admin/dashboard-metrics.test.ts`

**Interfaces:**
- Consumes: `DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY`, `DashboardCollectedDeltaDisplay`, and `parseDashboardCollectedDeltaDisplay()` from `dashboard-metrics.ts`.
- Produces: `saveDashboardDisplaySettingsAction(formData: FormData): Promise<void>` and a Settings form field named `collected_delta_display`.

- [ ] **Step 1: Add a failing validation test**

In `dashboard-metrics.test.ts`, add a test for the exported schema:

```ts
expect(dashboardCollectedDeltaDisplaySchema.parse("absolute")).toBe("absolute");
expect(dashboardCollectedDeltaDisplaySchema.parse("percentage")).toBe("percentage");
expect(() => dashboardCollectedDeltaDisplaySchema.parse("currency")).toThrow();
```

- [ ] **Step 2: Run domain test and verify red**

Run: `npm test -- src/lib/admin/dashboard-metrics.test.ts`

Expected: FAIL because `dashboardCollectedDeltaDisplaySchema` is not exported.

- [ ] **Step 3: Add schema, action, and shadcn Settings card**

Export this exact schema from `dashboard-metrics.ts`:

```ts
export const dashboardCollectedDeltaDisplaySchema = z.enum(["absolute", "percentage"]);
```

In `actions.ts`, parse `values(formData).collected_delta_display`, call `requireAdmin()`, upsert `DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY`, and revalidate both `/admin/settings` and `/admin/dashboard`.

In Settings, load the parsed preference from `listOperationalSettings()`. Add a dedicated `Card` before generic operational configuration with a `<form action={saveDashboardDisplaySettingsAction}>`, `FieldGroup`, `Field`, `FieldLabel`, `Select`, `SelectTrigger`, `SelectContent`, `SelectGroup`, two `SelectItem` values (`absolute`, `percentage`), and `Button`. The select's default value is the parsed preference. Keep the generic key/value form unchanged.

- [ ] **Step 4: Run validation test and verify green**

Run: `npm test -- src/lib/admin/dashboard-metrics.test.ts`

Expected: PASS, including invalid display setting rejection and default fallback behavior.

- [ ] **Step 5: Commit dashboard setting**

```bash
git add src/lib/admin/dashboard-metrics.ts src/lib/admin/dashboard-metrics.test.ts src/app/admin/'(protected)'/actions.ts src/app/admin/'(protected)'/settings/page.tsx
git commit -m "feat: configure collected metric display"
```

### Task 5: Render trends and route all date displays through one API

**Files:**
- Create: `src/components/admin/metric-trend.tsx`
- Modify: `src/components/admin/page-ui.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/admin/(protected)/dashboard/page.tsx`
- Modify: `src/app/admin/(protected)/audit/page.tsx`
- Modify: `src/app/admin/(protected)/clients/page.tsx`
- Modify: `src/app/admin/(protected)/clients/[clientId]/page.tsx`
- Modify: `src/app/admin/(protected)/payments/page.tsx`
- Modify: `src/app/admin/(protected)/payments/[paymentId]/page.tsx`
- Modify: `src/app/admin/(protected)/review/page.tsx`
- Modify: `src/components/admin/client-form.tsx`

**Interfaces:**
- Consumes: `DashboardComparison`, `DashboardCollectedDeltaDisplay`, `formatDate`, `formatDateTime`, `formatThb`, installed `CardAction`, `Tooltip`, `TooltipTrigger`, `TooltipContent`, and Lucide trend icons.
- Produces: `MetricTrend({ comparison, label, current, previous, delta }: MetricTrendProps)` and `MetricCard({ label, value, description?, trend? })`.

- [ ] **Step 1: Write a failing trend-display test**

Create `src/components/admin/metric-trend.test.tsx` with jsdom environment. Render a positive comparison and assert the trigger has the accessible label `"Active clients increased by 2 from last month"`. Render `comparison={null}` and assert no trigger exists. Render a negative comparison and assert its trigger label contains `"decreased"`.

```tsx
/** @vitest-environment jsdom */
render(<MetricTrend comparison={{ current: 5, previous: 3, delta: 2 }} label="Active clients" current="5 clients" previous="3 clients" delta="2 clients" />);
expect(screen.getByLabelText("Active clients increased by 2 from last month")).toBeInTheDocument();
```

- [ ] **Step 2: Run trend test and verify red**

Run: `npm test -- src/components/admin/metric-trend.test.tsx`

Expected: FAIL because `MetricTrend` does not exist.

- [ ] **Step 3: Compose shadcn trend UI and apply date helpers**

Create `MetricTrend` as a server component that passes static children to the installed client Tooltip primitives. Accept already-formatted `current`, `previous`, and `delta` strings; do not pass callbacks to a client boundary. Render no node for `null`; otherwise render a Base UI `TooltipTrigger` with `render={<span />}`, `aria-label`, and exactly one Lucide up/down/minus icon. Use `text-positive`, `text-destructive`, or `text-muted-foreground` based on `delta`.

Extend `MetricCard` with `trend?: ReactNode` and render it in `<CardAction>{trend}</CardAction>` inside its existing `CardHeader`.

Add `--positive` in both root and dark CSS variable groups, and expose it as `--color-positive` in the existing `@theme inline` block. Do not use raw green Tailwind classes.

In the dashboard page, construct trends only for Active clients and Collected this month. Format amounts with `formatThb`; percentage display uses `Math.abs(delta / previous * 100)` rounded to one decimal, while previous zero uses absolute THB. Supply readable tooltip text with current and prior values. Keep all other metric cards unchanged.

Replace raw display dates on all listed pages with `formatDate` for due/transaction dates and `formatDateTime` for created, updated, submitted, and audit timestamps. Replace the dashboard's inline today `Intl.DateTimeFormat` use with `bangkokToday()`. Do not change date strings used as query, storage, comparison, or payment-generation values.

- [ ] **Step 4: Run focused UI and domain tests and verify green**

Run: `npm test -- src/components/admin/metric-trend.test.tsx src/lib/date.test.ts src/lib/admin/dashboard-metrics.test.ts src/lib/admin/queries.test.ts`

Expected: PASS. The no-data trend test confirms no empty top-right indicator is rendered.

- [ ] **Step 5: Commit presentation update**

```bash
git add src/components/admin/metric-trend.tsx src/components/admin/metric-trend.test.tsx src/components/admin/page-ui.tsx src/app/globals.css src/app/admin/'(protected)'/dashboard/page.tsx src/app/admin/'(protected)'/audit/page.tsx src/app/admin/'(protected)'/clients/page.tsx src/app/admin/'(protected)'/clients/'[clientId]'/page.tsx src/app/admin/'(protected)'/payments/page.tsx src/app/admin/'(protected)'/payments/'[paymentId]'/page.tsx src/app/admin/'(protected)'/review/page.tsx src/components/admin/client-form.tsx
git commit -m "feat: show dashboard metric trends"
```

### Task 6: Run complete verification and inspect the dashboard

**Files:**
- Modify only if verification exposes a defect in Tasks 1–5.

**Interfaces:**
- Consumes: all code produced by Tasks 1–5.
- Produces: passing lint, test, and production build evidence.

- [ ] **Step 1: Run static checks**

Run: `npm run lint`

Expected: PASS with no ESLint or TypeScript errors.

- [ ] **Step 2: Run entire test suite**

Run: `npm test`

Expected: PASS; no live Sheets, cron, or Vercel requests occur.

- [ ] **Step 3: Build production app**

Run: `npm run build`

Expected: PASS and produce a production Next.js build.

- [ ] **Step 4: Manually inspect dashboard and date-heavy screens**

Run: `npm run dev`

Verify `/admin/dashboard`, `/admin/clients`, `/admin/payments`, `/admin/review`, and `/admin/audit` at desktop and mobile widths:

- every due date reads `10 Aug 2026`;
- every timestamp reads `10 Aug 2026, 15:20`;
- current cards have only top-right trend icons when a comparison exists;
- icon color/direction matches positive, negative, and zero cases;
- tooltip supplies current, previous, and selected display delta;
- Settings persists absolute and percentage selection;
- unavailable snapshot data leaves Active clients without a trend icon.

- [ ] **Step 5: Commit verification fixes only if needed**

```bash
git status --short
git diff --check
```

If verification requires a correction, amend the affected task's commit instead of creating a broad verification commit.

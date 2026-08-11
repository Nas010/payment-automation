# Admin Annotation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply supplied browser annotations to the admin dashboard and Clients page while keeping payment data behavior unchanged.

**Architecture:** Keep presentation changes at their existing route/component boundaries. Dashboard schedule data remains installment-aware internally, but rendered package cells show only `package_name`; Clients page gets small pure display helpers for directory count and payment wording. The sidebar uses the existing shadcn trigger and collapses to an icon rail so its toggle remains available after collapsing.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest, Testing Library, Tailwind CSS v4, shadcn/ui, Lucide.

## Global Constraints

- Apply all supplied annotations without another approval gate.
- Do not change Sheets schemas, payment scheduling, installment calculations, or payment status semantics.
- Preserve existing design tokens and installed UI primitives.
- Dashboard tables show package names only; installment fields remain available to payment logic and detail views.
- Upcoming schedule remains capped at 12 rendered rows and becomes vertically scrollable when content exceeds its viewport.
- Collapsed sidebar footer keeps sign-out action inside the rail as an icon-only control with an accessible label.

---

### Task 1: Add pure client-directory display helpers and tests

**Files:**
- Create: `src/lib/admin/client-display.ts`
- Create: `src/lib/admin/client-display.test.ts`

**Interfaces:**
- Produces: `formatClientDirectoryCount(count: number): string` and `formatPaymentProgress(paid: number, total: number): string`.
- Consumes: non-negative client/payment counts from the Clients route.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { formatClientDirectoryCount, formatPaymentProgress } from "./client-display";

describe("client display helpers", () => {
  it("formats directory count as a compact heading suffix", () => {
    expect(formatClientDirectoryCount(3)).toBe("(3)");
    expect(formatClientDirectoryCount(0)).toBe("(0)");
  });

  it("formats payment progress in plain language", () => {
    expect(formatPaymentProgress(0, 1)).toBe("0 of 1 paid");
    expect(formatPaymentProgress(2, 3)).toBe("2 of 3 paid");
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- src/lib/admin/client-display.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement helpers**

```ts
export function formatClientDirectoryCount(count: number): string {
  return `(${count})`;
}

export function formatPaymentProgress(paid: number, total: number): string {
  return `${paid} of ${total} paid`;
}
```

- [ ] **Step 4: Run tests and verify green**

Run: `npm test -- src/lib/admin/client-display.test.ts`

Expected: PASS.

### Task 2: Apply Clients page annotations

**Files:**
- Modify: `src/app/admin/(protected)/clients/page.tsx`

**Interfaces:**
- Consumes: `formatClientDirectoryCount` and `formatPaymentProgress` from Task 1.
- Produces: Client directory heading with count suffix, no standalone matching-count description, and a `Payments` column with readable `N of M paid` values.

- [ ] **Step 1: Update directory heading and remove duplicate count copy**

Change the CardHeader content to:

```tsx
<CardTitle>Client directory <span className="font-normal text-muted-foreground">{formatClientDirectoryCount(rows.length)}</span></CardTitle>
```

Remove the `CardDescription` that renders `matching client` text.

- [ ] **Step 2: Rename and reword payment progress column**

Change `<TableHead>Progress</TableHead>` to `<TableHead>Payments</TableHead>` and render `{formatPaymentProgress(paid, plan.length)}`.

- [ ] **Step 3: Run focused tests**

Run: `npm test -- src/lib/admin/client-display.test.ts src/components/admin/admin-shell.test.ts`

Expected: PASS.

### Task 3: Apply dashboard annotations and sidebar layout

**Files:**
- Modify: `src/app/admin/(protected)/dashboard/page.tsx`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.ts`

**Interfaces:**
- Consumes: existing dashboard schedule rows, `SidebarTrigger`, and existing page UI components.
- Produces: Dashboard without subtitle, package-only cells, bounded upcoming schedule table, persistent icon-collapse sidebar with one header toggle.

- [ ] **Step 1: Remove dashboard subtitle and installment suffixes**

Render `PageHeader` with `title="Dashboard"` and no `description`; make the shared description prop optional if needed. In `ScheduleTable`, render `{item.package_name}` only.

- [ ] **Step 2: Add bounded upcoming schedule overflow**

Add an optional `scrollable` prop to `ScheduleTable`. Wrap the table with `div className={scrollable ? "max-h-[28rem] overflow-auto" : undefined}` and call it as `scrollable` for Upcoming schedule only. Keep `dashboard.upcoming.slice(0, 12)`.

- [ ] **Step 3: Move sidebar toggle beside logo**

Change `collapsible="offcanvas"` to `collapsible="icon"`. Place `SidebarTrigger` in `SidebarHeader` beside the brand link. Hide only brand text at collapsed state, keep trigger accessible, and remove the duplicate top header containing the old trigger.

- [ ] **Step 4: Keep collapsed sign-out bound to the rail**

Render the existing logout action with a logout icon and visually collapse only its text at `group-data-[collapsible=icon]`, preserving the accessible `Sign out` label and server action.

- [ ] **Step 5: Update shell regression test**

Assert exactly one `Toggle Sidebar` button is rendered and `Page content` plus `Sign out` remain present.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- src/lib/admin/client-display.test.ts src/components/admin/admin-shell.test.ts`

Expected: PASS.

### Task 4: Full verification and rendered QA

**Files:**
- No additional source files unless verification exposes a regression.

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: exit 0 with no ESLint errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: exit 0 with zero failed tests.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 4: Validate rendered dashboard and Clients page**

Use the connected localhost browser at `/admin/dashboard` and `/admin/clients`; verify page identity, meaningful DOM, no framework overlay, no relevant console errors, package-only cells, directory count suffix, `Payments` values, sidebar toggle location, and a 10-row upcoming schedule state if available. Check desktop plus a mobile-sized viewport.

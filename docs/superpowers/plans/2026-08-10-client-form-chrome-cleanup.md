# Client Form Chrome Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove non-functional chrome from the new-client UI and render payment-type selections in natural language without changing form submission behavior.

**Architecture:** Keep form state and submitted enum values unchanged. Change only the rendered labels and static UI chrome in the existing client-form and admin-shell components; component tests assert user-visible copy and the unchanged one-time submission payload.

**Tech Stack:** Next.js 15, React 19, TypeScript, React Hook Form, Base UI Select, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Preserve `ONE_TIME` and `INSTALLMENTS` as internal payment-type values sent in `FormData`.
- Retain all fields, validation, package-prefill effects, scheduling behavior, summary calculations, navigation, form card, and plan-summary card.
- Render `ONE_TIME` as `One-time payment` and `INSTALLMENTS` as `Installments`.
- Remove only the marked non-functional text: client-plan title/description, client-details legend, Admin workspace header text, Google Sheets connection text, and Admin session text.

---

## File Structure

- Modify: `src/components/admin/client-form.tsx` — remove client-form chrome and map selected payment enum to display label.
- Modify: `src/components/admin/client-form.test.ts` — cover friendly selected payment label, removed client-form chrome, and existing one-time submission payload.
- Modify: `src/components/admin/admin-shell.tsx` — remove header and sidebar status text while retaining controls.
- Create: `src/components/admin/admin-shell.test.ts` — cover removal of static chrome and continued Sign out access.

### Task 1: Simplify client form and admin shell

**Files:**
- Modify: `src/components/admin/client-form.tsx:1-77`
- Modify: `src/components/admin/client-form.test.ts:1-31`
- Modify: `src/components/admin/admin-shell.tsx:1-43`
- Create: `src/components/admin/admin-shell.test.ts`

**Interfaces:**
- Consumes: `payment_type` values `ONE_TIME | INSTALLMENTS` from React Hook Form and existing Base UI `Select` components.
- Produces: Same `FormData` names and enum values on submission; human-readable selected-payment trigger text.

- [x] **Step 1: Write failing component tests for visible copy**

In `src/components/admin/client-form.test.ts`, import `screen` and add this test beneath the submission test:

```tsx
it("renders the selected payment type in natural language without client-form chrome", () => {
  render(createElement(ClientForm, {
    action: vi.fn(),
    packages: [{ package_name: "Starter", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0" }],
  }));

  expect(screen.getByRole("button", { name: "One-time payment" })).toBeTruthy();
  expect(screen.queryByText("Client plan")).toBeNull();
  expect(screen.queryByText("Identity, package, and billing terms. Package selection fills the default plan.")).toBeNull();
  expect(screen.queryByText("Client details")).toBeNull();
});
```

Create `src/components/admin/admin-shell.test.ts`; mock `next/link`, `next/navigation`, and `@/app/admin/login/actions` before importing `AdminShell`. Render the component with a child and assert:

```tsx
expect(screen.queryByText("Admin workspace")).toBeNull();
expect(screen.queryByText("Google Sheets · Connected")).toBeNull();
expect(screen.queryByText("Admin session · Active")).toBeNull();
expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
```

- [x] **Step 2: Run focused tests to verify expected failures**

Run: `npm test -- src/components/admin/client-form.test.ts src/components/admin/admin-shell.test.ts`

Expected: FAIL because the current selected trigger exposes `ONE_TIME`, and the marked chrome strings are still rendered.

- [x] **Step 3: Make minimal UI-only implementation changes**

In `src/components/admin/client-form.tsx`:

```tsx
const paymentTypeLabel = paymentType === "ONE_TIME" ? "One-time payment" : "Installments";
```

Render it inside the existing payment-type `SelectValue`:

```tsx
<SelectValue>{paymentTypeLabel}</SelectValue>
```

Remove the `CardHeader` containing `Client plan` and its description. Remove the `FieldLegend` containing `Client details`; retain the surrounding `FieldSet`, `FieldGroup`, inputs, `Payment plan` fieldset, submit button, and summary card.

In `src/components/admin/admin-shell.tsx`, remove the status-copy `<div>` from `SidebarFooter`, remove the `Admin workspace` span from the header, and remove imports that become unused. Retain `SidebarTrigger`, separators required for visible layout, navigation, and Sign out.

- [x] **Step 4: Run focused tests to verify green**

Run: `npm test -- src/components/admin/client-form.test.ts src/components/admin/admin-shell.test.ts`

Expected: PASS. The existing one-time submission test confirms `installment_count=1` and `interval_months=0`; new tests confirm friendly labels and absent chrome.

- [x] **Step 5: Run complete validation**

Run: `npm test && npm run lint && npm run build`

Expected: all Vitest tests pass, ESLint reports no errors, and Next.js production build exits 0.

- [x] **Step 6: Inspect the rendered new-client page**

Run: `npm run dev`

Open: `http://localhost:3000/admin/clients/new`

Check: no client-plan heading/description or client-details legend; selected payment type reads `One-time payment`; header has only the sidebar controls; sidebar footer has only Sign out; inputs and plan summary remain usable.

- [ ] **Step 7: Commit implementation**

```bash
git add src/components/admin/client-form.tsx src/components/admin/client-form.test.ts src/components/admin/admin-shell.tsx src/components/admin/admin-shell.test.ts
git commit -m "fix: simplify new client page chrome"
```

# Editable Existing-Client Package Plans Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Let admins configure payment type, price, installment count, interval, and first due date when assigning an active package to an existing client.

**Architecture:** Extract shared client-side payment-plan fields so new-client creation and existing-client package assignment expose identical terms and package-default behavior. Extend assignPackageAction to validate and schedule submitted terms while treating selected active package as authorization/template source only.

**Tech Stack:** Next.js server actions, React 19, React Hook Form, Zod, Vitest, Testing Library.

## Global Constraints

- Preserve saved package templates; assignment overrides must never update package rows.
- Use parseSatang and existing buildAssignedScheduleRows.
- One-time plans normalize to one installment and zero interval.
- Installments require count >= 2 and interval months >= 1.
- No live service calls in unit tests.
- Do not change manual payments, worksheet columns, prior schedules, or payment history.

---

### Task 1: Establish editable assignment regression tests

**Files:**

- Modify: src/components/admin/client-billing-actions.test.ts
- Modify: src/app/admin/(protected)/actions.test.ts

**Interfaces:**

- Consumes: current ClientBillingActions package prop and bound assignPackageAction.
- Produces: tests requiring editable assignment FormData and server use of final submitted terms.

- [ ] **Step 1: Write failing component test**

Replace current package-submission test with this case:

    it("preloads package terms and submits edited package-plan terms", async () => {
      const assignPackageAction = vi.fn();
      render(createElement(ClientBillingActions, { packages, assignPackageAction, createManualPaymentAction: vi.fn() }));

      expect(screen.getByRole("combobox", { name: "Payment type" })).toHaveTextContent("Installments");
      expect(screen.getByLabelText("Total price (THB)")).toHaveValue(1200);
      expect(screen.getByLabelText("Installments")).toHaveValue(2);
      expect(screen.getByLabelText("Interval months")).toHaveValue(1);
      fireEvent.change(screen.getByLabelText("Total price (THB)"), { target: { value: "1800" } });
      fireEvent.change(screen.getByLabelText("Installments"), { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Interval months"), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText("First due date"), { target: { value: "2026-08-31" } });
      fireEvent.click(screen.getByRole("button", { name: "Assign package" }));

      await waitFor(() => expect(assignPackageAction).toHaveBeenCalledTimes(1));
      const submitted = assignPackageAction.mock.calls[0][0] as FormData;
      expect(Object.fromEntries(submitted)).toMatchObject({
        package_name: "Extended coaching", payment_type: "INSTALLMENTS", total_price_thb: "1800",
        installment_count: "3", interval_months: "2", first_due_date: "2026-08-31",
      });
    });

- [ ] **Step 2: Write failing action tests**

In active-package action test, submit:

    formData.set("payment_type", "INSTALLMENTS");
    formData.set("total_price_thb", "1800");
    formData.set("installment_count", "3");
    formData.set("interval_months", "2");

Require three 600-THB schedule rows due 2026-08-31, 2026-10-31, and 2026-12-31. Require client summary and audit metadata to contain 1800, 3, and 2. Add a test submitting ONE_TIME, count 9, interval 9; require one schedule row and audit metadata:

    JSON.stringify({ packageName: "Extended coaching", installmentCount: 1, intervalMonths: 0 })

- [ ] **Step 3: Verify RED**

Run:

    npx vitest run src/components/admin/client-billing-actions.test.ts 'src/app/admin/(protected)/actions.test.ts'

Expected: form test fails because assignment lacks plan inputs; action test fails because saved package terms still win.

- [ ] **Step 4: Commit tests**

    git add src/components/admin/client-billing-actions.test.ts 'src/app/admin/(protected)/actions.test.ts'
    git commit -m "test: cover editable package assignment terms"

### Task 2: Share payment-plan controls

**Files:**

- Create: src/components/admin/payment-plan-fields.tsx
- Modify: src/components/admin/client-form.tsx
- Modify: src/components/admin/client-billing-actions.tsx
- Modify: src/components/admin/client-form.test.ts
- Test: src/components/admin/client-billing-actions.test.ts

**Interfaces:**

- Consumes: package fields package_name, total_price_thb, payment_type, installment_count, interval_months.
- Produces: registered names package_name, payment_type, total_price_thb, installment_count, interval_months, first_due_date, and notes.

- [ ] **Step 1: Write failing new-client parity assertions**

Add to ClientForm natural-language rendering test:

    expect(screen.getByLabelText("Total price (THB)")).toBeInTheDocument();
    expect(screen.getByLabelText("First due date")).toBeInTheDocument();
    expect(screen.getByLabelText("Installments")).toBeInTheDocument();
    expect(screen.getByLabelText("Interval months")).toBeInTheDocument();

- [ ] **Step 2: Implement PaymentPlanFields**

Create a client component for package selection, package-default application, payment type, total price, due date, installment count, interval, and notes. Both parent forms pass React Hook Form bindings and distinct prefixes (client and assigned-package). Component applies package defaults on selection and one-time normalization on payment-type change.

Render same registered controls in both flows:

    <Select name="payment_type" value={paymentType} onValueChange={onPaymentTypeChange}>
      <SelectTrigger id={idPrefix + "-payment-type"} className="w-full"><SelectValue>{paymentType === "ONE_TIME" ? "One-time payment" : "Installments"}</SelectValue></SelectTrigger>
      <SelectContent><SelectGroup><SelectItem value="ONE_TIME">One-time payment</SelectItem><SelectItem value="INSTALLMENTS">Installments</SelectItem></SelectGroup></SelectContent>
    </Select>
    <Input id={idPrefix + "-total-price"} type="number" min="0.01" step="0.01" inputMode="decimal" {...register("total_price_thb")} />
    <Input id={idPrefix + "-first-due-date"} type="date" {...register("first_due_date")} />
    <Input id={idPrefix + "-installment-count"} type="number" min="1" readOnly={paymentType === "ONE_TIME"} {...register("installment_count")} />
    <Input id={idPrefix + "-interval-months"} type="number" min="0" readOnly={paymentType === "ONE_TIME"} {...register("interval_months")} />

- [ ] **Step 3: Refactor parent forms**

Move only shared fields into PaymentPlanFields. Keep client name and plan summary in ClientForm; keep existing card and submit copy in AssignPackageForm. Give assignment schema fields matching new-client semantics:

    payment_type: z.enum(["ONE_TIME", "INSTALLMENTS"]),
    total_price_thb: z.coerce.number().positive("Price must be positive"),
    installment_count: z.coerce.number().int().min(1),
    interval_months: z.coerce.number().int().min(0),
    first_due_date: z.string().min(1, "First due date is required"),
    notes: z.string(),

- [ ] **Step 4: Verify GREEN**

Run:

    npx vitest run src/components/admin/client-form.test.ts src/components/admin/client-billing-actions.test.ts

Expected: both forms pass tests; assignment submits edited terms; one-time values remain locked and normalized.

- [ ] **Step 5: Commit UI**

    git add src/components/admin/payment-plan-fields.tsx src/components/admin/client-form.tsx src/components/admin/client-billing-actions.tsx src/components/admin/client-form.test.ts src/components/admin/client-billing-actions.test.ts
    git commit -m "feat: share editable package plan controls"

### Task 3: Persist normalized submitted assignment terms

**Files:**

- Modify: src/app/admin/(protected)/actions.ts
- Test: src/app/admin/(protected)/actions.test.ts

**Interfaces:**

- Consumes: Task 2 FormData and active package lookup.
- Produces: schedule rows, client summary, and audit metadata from normalized submitted terms.

- [ ] **Step 1: Expand assignment schema**

Replace assignPackageSchema with:

    const assignPackageSchema = z.object({
      package_name: z.string().trim().min(1),
      payment_type: z.enum(["ONE_TIME", "INSTALLMENTS"]),
      total_price_thb: z.string(),
      installment_count: z.coerce.number().int().min(1),
      interval_months: z.coerce.number().int().min(0),
      first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().trim(),
    });

- [ ] **Step 2: Implement final-term validation**

After active-package lookup, replace saved-term reads with:

    const totalSatang = parseSatang(data.total_price_thb);
    if (!totalSatang || totalSatang <= 0 || !Number.isSafeInteger(totalSatang)) {
      throw new Error("Total price must be a positive THB amount");
    }
    const paymentCount = data.payment_type === "ONE_TIME" ? 1 : data.installment_count;
    const intervalMonths = data.payment_type === "ONE_TIME" ? 0 : data.interval_months;
    if (data.payment_type === "INSTALLMENTS" && (paymentCount < 2 || intervalMonths < 1)) {
      throw new Error("Installment plans need at least two payments and a one-month interval");
    }

Pass data.payment_type, totalSatang, paymentCount, and intervalMonths to buildAssignedScheduleRows; reuse them in updateClient and PACKAGE_ASSIGNED audit metadata.

- [ ] **Step 3: Add invalid-installment test and verify red/green**

Submit active package with INSTALLMENTS, count 1, interval 0; expect rejection:

    await expect(assignPackageAction("client_1", formData))
      .rejects.toThrow("Installment plans need at least two payments and a one-month interval");
    expect(mocks.writeSchedule).not.toHaveBeenCalled();
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();

Run once before Step 2, then after it:

    npx vitest run 'src/app/admin/(protected)/actions.test.ts'

- [ ] **Step 4: Commit server behavior**

    git add 'src/app/admin/(protected)/actions.ts' 'src/app/admin/(protected)/actions.test.ts'
    git commit -m "feat: save edited package assignment terms"

### Task 4: Verify integrated behavior

**Files:**

- Verify only: files from Tasks 1-3.

**Interfaces:**

- Consumes: shared form controls and assignment action.
- Produces: fresh UI, server, lint, test, and build evidence.

- [ ] **Step 1: Inspect diff**

    git diff main...HEAD --check
    git status --short

Expected: no whitespace errors; only planned source, test, and docs files differ.

- [ ] **Step 2: Run focused regression suite**

    npx vitest run src/components/admin/client-form.test.ts src/components/admin/client-billing-actions.test.ts 'src/app/admin/(protected)/actions.test.ts' src/lib/plans/assignment.test.ts

Expected: zero failures.

- [ ] **Step 3: Run required full verification**

    npm run lint && npm test && npm run build

Expected: each command exits 0.

- [ ] **Step 4: Commit corrections only when needed**

    git add src/components/admin/payment-plan-fields.tsx src/components/admin/client-form.tsx src/components/admin/client-billing-actions.tsx src/components/admin/client-form.test.ts src/components/admin/client-billing-actions.test.ts 'src/app/admin/(protected)/actions.ts' 'src/app/admin/(protected)/actions.test.ts'
    git commit -m "fix: verify editable package assignments"

Run this only if verification required an uncommitted correction; otherwise retain prior task commits.

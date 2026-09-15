import { describe, expect, it } from "vitest";
import { buildInstallmentPlan, buildPaymentForSchedule, planTotalSatangForSchedule, selectDueSchedules, selectPaymentGenerationSchedules } from "./schedule";

describe("buildInstallmentPlan", () => {
  it("puts indivisible satang on the last installment so all scheduled amounts equal plan total", () => {
    const plan = buildInstallmentPlan({ totalSatang: 10_000_000, installmentCount: 3, intervalMonths: 1, firstDueDate: "2026-08-11" });

    expect(plan.map((item) => item.amountSatang)).toEqual([3_333_333, 3_333_333, 3_333_334]);
    expect(plan.reduce((total, item) => total + item.amountSatang, 0)).toBe(10_000_000);
  });

  it("clamps month-end due dates rather than rolling into the following month", () => {
    const plan = buildInstallmentPlan({ totalSatang: 300, installmentCount: 3, intervalMonths: 1, firstDueDate: "2026-01-31" });

    expect(plan.map((item) => item.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("selects only due, ungenerated schedule rows for link creation", () => {
    const due = selectDueSchedules([
      { schedule_id: "schedule_due", due_date: "2026-08-10", status: "SCHEDULED", payment_id: "" },
      { schedule_id: "schedule_future", due_date: "2026-08-11", status: "SCHEDULED", payment_id: "" },
      { schedule_id: "schedule_done", due_date: "2026-08-01", status: "GENERATED", payment_id: "pay_1" },
      { schedule_id: "schedule_linked", due_date: "2026-08-01", status: "SCHEDULED", payment_id: "pay_2" },
    ], "2026-08-10");

    expect(due.map((schedule) => schedule.schedule_id)).toEqual(["schedule_due"]);
  });

  it("builds an amount-specific public payment from the canonical schedule row", () => {
    const payment = buildPaymentForSchedule({
      schedule_id: "schedule_1", client_id: "client_1", client_name: "Nisa", line_display_name: "", package_name: "PT",
      payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "3", amount_thb: "1000.50", due_date: "2026-08-10", created_at: "2026-08-01T00:00:00.000Z",
    }, { paymentId: "pay_1", publicToken: "token", baseUrl: "https://pay.example/", createdAt: "2026-08-10T03:00:00.000Z", planTotalSatang: 300_150 });

    expect(payment).toMatchObject({
      payment_id: "pay_1", client_id: "client_1", period: "2026-08", amount_thb: "1000.50", due_date: "2026-08-10",
      public_token: "token", payment_url: "https://pay.example/p/token", status: "PENDING",
    });
    expect(payment).toMatchObject({
      line_message: "",
      line_message_status: "",
      line_retry_key: "",
      line_message_attempted_at: "",
      line_message_sent_at: "",
      line_request_id: "",
      line_message_error: "",
      line_payment_requested_at: "",
      line_slip_expected: "",
      line_slip_received_at: "",
      line_source_message_id: "",
      line_slip_processing_status: "",
      line_slip_error: "",
      line_reply_status: "",
      line_reply_at: "",
      package_name: "PT",
      payment_type: "INSTALLMENTS",
      installment_number: "2",
      installment_count: "3",
      total_price_thb: "3001.5",
    });
  });

  it("calculates exact plan total from rows created in one assignment", () => {
    const rows = ["333.33", "333.33", "333.34"].map((amount_thb, index) => ({
      schedule_id: `s${index + 1}`,
      client_id: "client_1",
      package_name: "PT",
      payment_type: "INSTALLMENTS",
      installment_number: String(index + 1),
      installment_count: "3",
      amount_thb,
      created_at: "2026-08-01T00:00:00.000Z",
    }));

    expect(planTotalSatangForSchedule(rows[1], rows)).toBe(100_000);
  });

  it("uses assignment identity so same-name assignments do not share a plan total", () => {
    const rows = [
      { schedule_id: "a1", client_id: "client_1", package_name: "PT", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2", amount_thb: "500", created_at: "same-time", assignment_id: "assignment_1" },
      { schedule_id: "a2", client_id: "client_1", package_name: "PT", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "2", amount_thb: "500", created_at: "same-time", assignment_id: "assignment_1" },
      { schedule_id: "b1", client_id: "client_1", package_name: "PT", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2", amount_thb: "800", created_at: "same-time", assignment_id: "assignment_2" },
      { schedule_id: "b2", client_id: "client_1", package_name: "PT", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "2", amount_thb: "800", created_at: "same-time", assignment_id: "assignment_2" },
    ];

    expect(planTotalSatangForSchedule(rows[0], rows)).toBe(100_000);
    expect(planTotalSatangForSchedule(rows[2], rows)).toBe(160_000);
  });

  it("snapshots client-facing plan data onto the generated payment", () => {
    const payment = buildPaymentForSchedule({
      schedule_id: "schedule_2",
      client_id: "client_1",
      client_name: "Nisa",
      line_display_name: "",
      package_name: "PT",
      payment_type: "INSTALLMENTS",
      installment_number: "2",
      installment_count: "3",
      amount_thb: "1000",
      due_date: "2026-09-10",
      created_at: "2026-08-01T00:00:00.000Z",
    }, {
      paymentId: "pay_1",
      publicToken: "token",
      baseUrl: "https://pay.example",
      createdAt: "2026-08-10T03:00:00.000Z",
      planTotalSatang: 300_000,
    });

    expect(payment).toMatchObject({
      package_name: "PT",
      payment_type: "INSTALLMENTS",
      installment_number: "2",
      installment_count: "3",
      total_price_thb: "3000",
    });
  });
});

describe("selectPaymentGenerationSchedules", () => {
  const laterInstallment = { schedule_id: "schedule_2", due_date: "2026-08-20", status: "SCHEDULED", payment_id: "", payment_type: "INSTALLMENTS", installment_number: "2" };

  it("makes a second installment available seven days before its deadline", () => {
    expect(selectPaymentGenerationSchedules([laterInstallment], "2026-08-13")).toEqual([laterInstallment]);
  });

  it("does not select that later installment before T-7", () => {
    expect(selectPaymentGenerationSchedules([laterInstallment], "2026-08-12")).toEqual([]);
  });
});

describe("installment amount overrides", () => {
  const input = { totalSatang: 600_000, installmentCount: 6, intervalMonths: 1, firstDueDate: "2026-09-15" };
  it("fixes the overridden installment and evenly splits the balance", () => {
    expect(buildInstallmentPlan({ ...input, amountOverrides: [50_000] }).map((row) => row.amountSatang)).toEqual([50_000, 110_000, 110_000, 110_000, 110_000, 110_000]);
  });
  it("preserves multiple overrides and puts rounding in the last automatic installment", () => {
    const amounts = buildInstallmentPlan({ ...input, totalSatang: 600_001, amountOverrides: [50_000, null, null, null, null, 100_000] }).map((row) => row.amountSatang);
    expect(amounts).toEqual([50_000, 112_500, 112_500, 112_500, 112_501, 100_000]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(600_001);
  });
  it.each([[600_000], [0], [-1], [1.5], [NaN], [100_000, 100_000, 100_000, 100_000, 100_000, 99_999], [null, null, null, null, null, null, 1]])("rejects invalid override set %j", (...amountOverrides) => {
    expect(() => buildInstallmentPlan({ ...input, amountOverrides })).toThrow();
  });
  it("allows every installment to be fixed when the sum matches", () => {
    expect(buildInstallmentPlan({ ...input, amountOverrides: [50_000, 50_000, 50_000, 50_000, 50_000, 350_000] }).map((row) => row.amountSatang)).toEqual([50_000, 50_000, 50_000, 50_000, 50_000, 350_000]);
  });
});

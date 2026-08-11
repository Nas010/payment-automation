import { describe, expect, it } from "vitest";
import { buildInstallmentPlan, buildPaymentForSchedule, selectDueSchedules } from "./schedule";

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
      installment_number: "2", installment_count: "3", amount_thb: "1000.50", due_date: "2026-08-10",
    }, { paymentId: "pay_1", publicToken: "token", baseUrl: "https://pay.example/", createdAt: "2026-08-10T03:00:00.000Z" });

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
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildClientBillingSummary } from "./client-billing";

describe("buildClientBillingSummary", () => {
  it("summarizes every package and custom charge chronologically", () => {
    const summary = buildClientBillingSummary([
      { schedule_id: "future", amount_thb: "200", due_date: "2026-10-01", status: "SCHEDULED" },
      { schedule_id: "paid", amount_thb: "100", due_date: "2026-08-01", status: "PAID" },
      { schedule_id: "next", amount_thb: "50.50", due_date: "2026-09-01", status: "GENERATED" },
    ]);

    expect(summary).toMatchObject({
      totalSatang: 35_050,
      paidSatang: 10_000,
      outstandingSatang: 25_050,
      nextDueDate: "2026-09-01",
    });
    expect(summary.orderedSchedules.map((row) => row.schedule_id)).toEqual(["paid", "next", "future"]);
  });

  it("returns zeroed totals when a client has no schedule", () => {
    expect(buildClientBillingSummary([])).toEqual({
      orderedSchedules: [],
      totalSatang: 0,
      paidSatang: 0,
      outstandingSatang: 0,
      nextDueDate: "",
    });
  });

  it("does not let malformed legacy amounts corrupt the summary", () => {
    const summary = buildClientBillingSummary([
      { schedule_id: "bad", amount_thb: "not-money", due_date: "2026-08-01", status: "PAID" },
      { schedule_id: "valid", amount_thb: "75", due_date: "2026-08-02", status: "SCHEDULED" },
    ]);

    expect(summary).toMatchObject({ totalSatang: 7_500, paidSatang: 0, outstandingSatang: 7_500, nextDueDate: "2026-08-02" });
  });

  it("excludes cancelled and deleted rows while retaining paused balances without a due date", () => {
    const summary = buildClientBillingSummary([
      { schedule_id: "paid", amount_thb: "100", due_date: "2026-08-01", status: "PAID" },
      { schedule_id: "paused", amount_thb: "50", due_date: "2026-08-15", status: "PAUSED" },
      { schedule_id: "cancelled", amount_thb: "200", due_date: "2026-08-10", status: "CANCELLED" },
      { schedule_id: "deleted", amount_thb: "300", due_date: "2026-08-12", status: "DELETED" },
    ]);

    expect(summary).toMatchObject({ totalSatang: 15_000, paidSatang: 10_000, outstandingSatang: 5_000, nextDueDate: "" });
  });
});

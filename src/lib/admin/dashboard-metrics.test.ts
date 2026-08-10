import { describe, expect, it } from "vitest";

async function loadDashboardMetrics() {
  try {
    return await import("./dashboard-metrics");
  } catch {
    return null;
  }
}

describe("dashboard metrics", () => {
  it("derives month keys and parses dashboard settings", async () => {
    const metrics = await loadDashboardMetrics();
    expect(metrics).not.toBeNull();
    if (!metrics) return;

    expect(metrics.previousMonth("2026-01")).toBe("2025-12");
    expect(metrics.activeClientSnapshotKey("2026-08")).toBe("dashboard_active_clients_2026-08");
    expect(metrics.parseActiveClientSnapshot([{ key: "dashboard_active_clients_2026-07", value: "3" }], "2026-07")).toBe(3);
    expect(metrics.parseActiveClientSnapshot([{ key: "dashboard_active_clients_2026-07", value: "3.5" }], "2026-07")).toBeNull();
    expect(metrics.parseDashboardCollectedDeltaDisplay([])).toBe("absolute");
    expect(metrics.parseDashboardCollectedDeltaDisplay([{ key: "dashboard_collected_delta_display", value: "percentage" }])).toBe("percentage");
  });

  it("compares current metrics with prior-month data only when a baseline exists", async () => {
    const metrics = await loadDashboardMetrics();
    expect(metrics).not.toBeNull();
    if (!metrics) return;

    const result = metrics.buildDashboardReadModel({
      today: "2026-08-10",
      clients: [{ active: "TRUE" }, { active: "true" }, { active: "FALSE" }],
      payments: [
        { status: "MANUAL_CONFIRMED", amount_thb: "75", recorded_at: "2026-07-03", manual_confirmed_at: "", created_at: "" },
        { status: "AUTO_RECORDED", amount_thb: "100", recorded_at: "2026-08-03", manual_confirmed_at: "", created_at: "" },
        { status: "REVIEW", amount_thb: "50", recorded_at: "", manual_confirmed_at: "", created_at: "" },
      ],
      schedules: [
        { schedule_id: "first", status: "PAID", due_date: "2026-08-03", amount_thb: "100" },
        { schedule_id: "second", status: "GENERATED", due_date: "2026-08-10", amount_thb: "50" },
        { schedule_id: "third", status: "SCHEDULED", due_date: "2026-08-08", amount_thb: "25" },
      ],
      activeClientsLastMonth: 1,
    });

    expect(result).toMatchObject({ activeClients: 2, dueToday: 1, overdue: 1, needsReview: 1, outstandingSatang: 7_500, collectedThisMonthSatang: 10_000 });
    expect(result.collectedComparison).toEqual({ current: 10_000, previous: 7_500, delta: 2_500 });
    expect(result.activeClientsComparison).toEqual({ current: 2, previous: 1, delta: 1 });

    const withoutBaselines = metrics.buildDashboardReadModel({
      today: "2026-08-10",
      clients: [{ active: "TRUE" }],
      payments: [{ status: "AUTO_RECORDED", amount_thb: "10", recorded_at: "2026-08-03", manual_confirmed_at: "", created_at: "" }],
      schedules: [],
      activeClientsLastMonth: null,
    });

    expect(withoutBaselines.collectedComparison).toBeNull();
    expect(withoutBaselines.activeClientsComparison).toBeNull();

    const zeroPriorMonth = metrics.buildDashboardReadModel({
      today: "2026-08-10",
      clients: [],
      payments: [
        { status: "AUTO_RECORDED", amount_thb: "0", recorded_at: "2026-07-03", manual_confirmed_at: "", created_at: "" },
        { status: "AUTO_RECORDED", amount_thb: "10", recorded_at: "2026-08-03", manual_confirmed_at: "", created_at: "" },
      ],
      schedules: [],
      activeClientsLastMonth: null,
    });

    expect(zeroPriorMonth.collectedComparison).toEqual({ current: 1_000, previous: 0, delta: 1_000 });
  });
});

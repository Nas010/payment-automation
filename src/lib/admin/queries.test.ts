import { describe, expect, it } from "vitest";
import { buildDashboardReadModel } from "./queries";

describe("buildDashboardReadModel", () => {
  it("counts outstanding schedule items without double-counting generated payments", () => {
    const result = buildDashboardReadModel({
      today: "2026-08-10",
      clients: [{ active: "TRUE" }],
      payments: [
        { status: "MANUAL_CONFIRMED", amount_thb: "100", recorded_at: "2026-08-03", manual_confirmed_at: "", created_at: "" },
        { status: "REVIEW", amount_thb: "50", recorded_at: "", manual_confirmed_at: "", created_at: "" },
      ],
      schedules: [
        { schedule_id: "first", status: "PAID", due_date: "2026-08-03", amount_thb: "100" },
        { schedule_id: "second", status: "GENERATED", due_date: "2026-08-10", amount_thb: "50" },
        { schedule_id: "third", status: "SCHEDULED", due_date: "2026-08-08", amount_thb: "25" },
      ],
    });

    expect(result).toMatchObject({ activeClients: 1, dueToday: 1, overdue: 1, needsReview: 1, outstandingSatang: 7_500, collectedThisMonthSatang: 10_000 });
  });
});

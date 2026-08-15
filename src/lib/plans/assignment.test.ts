import { describe, expect, it } from "vitest";
import { buildAssignedScheduleRows } from "./assignment";

describe("buildAssignedScheduleRows", () => {
  it("builds canonical rows for an existing linked client", () => {
    const rows = buildAssignedScheduleRows({
      client: {
        client_id: "client_1",
        client_name: "Nisa",
        line_user_id: "U1",
        line_display_name: "Nisa LINE",
      },
      label: "Extension",
      paymentType: "INSTALLMENTS",
      totalSatang: 10_001,
      paymentCount: 2,
      intervalMonths: 1,
      firstDueDate: "2026-08-31",
      notes: "Round two",
      now: "2026-08-11T00:00:00.000Z",
      assignmentId: "assignment_1",
      assignmentKind: "PACKAGE",
      createScheduleId: (index) => `schedule_${index + 1}`,
    });

    expect(rows.map((row) => ({ id: row.schedule_id, amount: row.amount_thb, due: row.due_date }))).toEqual([
      { id: "schedule_1", amount: "50", due: "2026-08-31" },
      { id: "schedule_2", amount: "50.01", due: "2026-09-30" },
    ]);
    expect(rows[0]).toMatchObject({
      client_id: "client_1",
      client_name: "Nisa",
      line_user_id: "U1",
      line_display_name: "Nisa LINE",
      package_name: "Extension",
      payment_type: "INSTALLMENTS",
      installment_number: "1",
      installment_count: "2",
      status: "SCHEDULED",
      generated_at: "",
      payment_id: "",
      payment_url: "",
      notes: "Round two",
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
      assignment_id: "assignment_1",
      assignment_kind: "PACKAGE",
    });
  });

  it("normalizes a one-time charge to one canonical row", () => {
    const rows = buildAssignedScheduleRows({
      client: { client_id: "client_2", client_name: "Mali", line_user_id: "", line_display_name: "" },
      label: "Extra session",
      paymentType: "ONE_TIME",
      totalSatang: 125_000,
      paymentCount: 1,
      intervalMonths: 0,
      firstDueDate: "2026-08-15",
      notes: "",
      now: "2026-08-11T00:00:00.000Z",
      assignmentId: "manual_1",
      assignmentKind: "MANUAL",
      createScheduleId: () => "schedule_once",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      schedule_id: "schedule_once",
      package_name: "Extra session",
      payment_type: "ONE_TIME",
      installment_number: "1",
      installment_count: "1",
      amount_thb: "1250",
      due_date: "2026-08-15",
      assignment_id: "manual_1",
      assignment_kind: "MANUAL",
    });
  });
});

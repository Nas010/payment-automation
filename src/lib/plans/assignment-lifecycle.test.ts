import { describe, expect, it } from "vitest";
import { assignmentIdForSchedule, buildPackageAssignments } from "./assignment-lifecycle";

function schedule(overrides: Record<string, string> = {}) {
  return {
    schedule_id: "schedule_1",
    client_id: "client_1",
    package_name: "Coaching",
    payment_type: "INSTALLMENTS",
    installment_number: "1",
    installment_count: "2",
    amount_thb: "500",
    due_date: "2026-09-01",
    status: "SCHEDULED",
    created_at: "2026-08-01T00:00:00.000Z",
    assignment_id: "",
    assignment_kind: "",
    ...overrides,
  };
}

describe("assignmentIdForSchedule", () => {
  it("creates a stable legacy identity from assignment-defining fields", () => {
    const first = assignmentIdForSchedule(schedule());
    const second = assignmentIdForSchedule(schedule({ schedule_id: "schedule_2", due_date: "2026-10-01", amount_thb: "250" }));

    expect(first).toMatch(/^legacy:/);
    expect(second).toBe(first);
    expect(assignmentIdForSchedule(schedule({ created_at: "2026-08-02T00:00:00.000Z" }))).not.toBe(first);
  });
});

describe("buildPackageAssignments", () => {
  it("groups package rows by assignment metadata and excludes manual or unknown legacy rows", () => {
    const assignments = buildPackageAssignments([
      schedule({ schedule_id: "paid", assignment_id: "assignment_1", assignment_kind: "PACKAGE", status: "PAID" }),
      schedule({ schedule_id: "paused", installment_number: "2", due_date: "2026-10-01", assignment_id: "assignment_1", assignment_kind: "PACKAGE", status: "PAUSED" }),
      schedule({ schedule_id: "manual", package_name: "Extra session", assignment_id: "manual_1", assignment_kind: "MANUAL" }),
      schedule({ schedule_id: "unknown", package_name: "Legacy custom charge" }),
    ], new Set(["Coaching"]));

    expect(assignments).toMatchObject([{
      id: "assignment_1",
      label: "Coaching",
      state: "PAUSED",
      paidSatang: 50_000,
      outstandingSatang: 50_000,
    }]);
    expect(assignments).not.toContainEqual(expect.objectContaining({ label: "Extra session" }));
    expect(assignments).not.toContainEqual(expect.objectContaining({ label: "Legacy custom charge" }));
  });

  it("uses saved package names for every blank assignment identity", () => {
    const assignments = buildPackageAssignments([
      schedule({ schedule_id: "legacy-package" }),
      schedule({ schedule_id: "legacy-kind-only", package_name: "Extra session", assignment_kind: "PACKAGE" }),
    ], new Set(["Coaching"]));

    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ id: expect.stringMatching(/^legacy:/), label: "Coaching" });
  });

  it("derives active, ended, deleted, and completed states from unpaid rows", () => {
    const assignments = buildPackageAssignments([
      schedule({ assignment_id: "active", assignment_kind: "PACKAGE" }),
      schedule({ assignment_id: "ended", assignment_kind: "PACKAGE", status: "CANCELLED" }),
      schedule({ assignment_id: "deleted", assignment_kind: "PACKAGE", status: "DELETED" }),
      schedule({ assignment_id: "completed", assignment_kind: "PACKAGE", status: "PAID" }),
    ], new Set(["Coaching"]));

    expect(Object.fromEntries(assignments.map((item) => [item.id, item.state]))).toEqual({
      active: "ACTIVE",
      ended: "ENDED",
      deleted: "DELETED",
      completed: "COMPLETED",
    });
  });

  it("keeps paid history while counting only collectable rows as outstanding", () => {
    const [assignment] = buildPackageAssignments([
      schedule({ schedule_id: "paid", assignment_id: "assignment_1", assignment_kind: "PACKAGE", status: "PAID", amount_thb: "1000" }),
      schedule({ schedule_id: "remaining", installment_number: "2", assignment_id: "assignment_1", assignment_kind: "PACKAGE", status: "SCHEDULED", amount_thb: "500" }),
      schedule({ schedule_id: "cancelled", installment_number: "3", assignment_id: "assignment_1", assignment_kind: "PACKAGE", status: "CANCELLED", amount_thb: "500" }),
    ], new Set(["Coaching"]));

    expect(assignment).toMatchObject({ paidSatang: 100_000, outstandingSatang: 50_000, state: "ACTIVE" });
  });

  it("reports a paid-in-full assignment without an outstanding balance", () => {
    const [assignment] = buildPackageAssignments([
      schedule({ assignment_id: "pif", assignment_kind: "PACKAGE", payment_type: "ONE_TIME", installment_count: "1", amount_thb: "1200", status: "PAID" }),
    ], new Set(["Coaching"]));

    expect(assignment).toMatchObject({ state: "COMPLETED", paidSatang: 120_000, outstandingSatang: 0 });
  });
});


it("groups legacy manual rows without assignment metadata and excludes known packages", () => {
  const rows = [schedule({ package_name: "Old custom charge" }), schedule({ package_name: "Old custom charge", schedule_id: "second", installment_number: "2" }), schedule()];
  const assignments = buildPackageAssignments(rows, new Set(["Coaching"]), "MANUAL");
  expect(assignments).toHaveLength(1);
  expect(assignments[0]).toMatchObject({ id: assignmentIdForSchedule(rows[0]), kind: "MANUAL", schedules: rows.slice(0, 2) });
});

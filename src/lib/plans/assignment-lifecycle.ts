import { parseSatang } from "@/lib/money";

export type AssignmentSchedule = {
  schedule_id: string;
  client_id: string;
  package_name: string;
  payment_type: string;
  installment_number: string;
  installment_count: string;
  amount_thb: string;
  due_date: string;
  status: string;
  created_at: string;
  assignment_id?: string;
  assignment_kind?: string;
};

export type PackageAssignmentState = "ACTIVE" | "PAUSED" | "ENDED" | "DELETED" | "COMPLETED";

export type PackageAssignment<T extends AssignmentSchedule = AssignmentSchedule> = {
  id: string;
  kind: "PACKAGE" | "MANUAL";
  clientId: string;
  label: string;
  paymentType: string;
  installmentCount: string;
  createdAt: string;
  state: PackageAssignmentState;
  paidSatang: number;
  outstandingSatang: number;
  nextDueDate: string;
  schedules: T[];
};

function isCollectableStatus(status: string): boolean {
  return !["PAID", "PAUSED", "CANCELLED", "DELETED"].includes(status);
}

function isOutstandingStatus(status: string): boolean {
  return !["PAID", "CANCELLED", "DELETED"].includes(status);
}

function assignmentState(schedules: readonly AssignmentSchedule[]): PackageAssignmentState {
  const unpaid = schedules.filter((schedule) => schedule.status !== "PAID");
  if (!unpaid.length) return "COMPLETED";
  if (unpaid.every((schedule) => schedule.status === "DELETED")) return "DELETED";
  if (unpaid.every((schedule) => schedule.status === "CANCELLED")) return "ENDED";
  if (unpaid.every((schedule) => schedule.status === "PAUSED")) return "PAUSED";
  return "ACTIVE";
}

export function assignmentIdForSchedule(schedule: AssignmentSchedule): string {
  if (schedule.assignment_id) return schedule.assignment_id;
  return `legacy:${[schedule.client_id, schedule.package_name, schedule.payment_type, schedule.installment_count, schedule.created_at].map(encodeURIComponent).join(":")}`;
}

export function buildPackageAssignments<T extends AssignmentSchedule>(schedules: readonly T[], savedPackageNames: ReadonlySet<string>, kind: "PACKAGE" | "MANUAL" = "PACKAGE"): PackageAssignment<T>[] {
  const groups = new Map<string, T[]>();

  for (const schedule of schedules) {
    const isPackage = schedule.assignment_id
      ? schedule.assignment_kind === kind
      : kind === "PACKAGE" && savedPackageNames.has(schedule.package_name);
    if (!isPackage) continue;
    const id = assignmentIdForSchedule(schedule);
    const group = groups.get(id) ?? [];
    group.push(schedule);
    groups.set(id, group);
  }

  return [...groups.entries()].map(([id, rows]) => {
    const first = rows[0];
    const paidSatang = rows.reduce((total, schedule) => schedule.status === "PAID"
      ? total + (parseSatang(schedule.amount_thb) ?? 0)
      : total, 0);
    const outstandingSatang = rows.reduce((total, schedule) => isOutstandingStatus(schedule.status)
      ? total + (parseSatang(schedule.amount_thb) ?? 0)
      : total, 0);
    const nextDueDate = rows
      .filter((schedule) => isCollectableStatus(schedule.status))
      .sort((left, right) => left.due_date.localeCompare(right.due_date) || left.schedule_id.localeCompare(right.schedule_id))[0]?.due_date ?? "";

    return {
      id,
      kind,
      clientId: first.client_id,
      label: first.package_name,
      paymentType: first.payment_type,
      installmentCount: first.installment_count,
      createdAt: first.created_at,
      state: assignmentState(rows),
      paidSatang,
      outstandingSatang,
      nextDueDate,
      schedules: rows,
    };
  });
}

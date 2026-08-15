import { buildInstallmentPlan } from "@/lib/plans/schedule";
import type { NewScheduleRecord } from "@/lib/sheets/schedules";

export type AssignedScheduleInput = {
  client: {
    client_id: string;
    client_name: string;
    line_user_id: string;
    line_display_name: string;
  };
  label: string;
  paymentType: "ONE_TIME" | "INSTALLMENTS";
  totalSatang: number;
  paymentCount: number;
  intervalMonths: number;
  firstDueDate: string;
  notes: string;
  now: string;
  assignmentId: string;
  assignmentKind: "PACKAGE" | "MANUAL";
  createScheduleId: (index: number) => string;
};

export function buildAssignedScheduleRows(input: AssignedScheduleInput): NewScheduleRecord[] {
  const plan = buildInstallmentPlan({
    totalSatang: input.totalSatang,
    installmentCount: input.paymentCount,
    intervalMonths: input.intervalMonths,
    firstDueDate: input.firstDueDate,
  });

  return plan.map((item, index) => ({
    schedule_id: input.createScheduleId(index),
    client_id: input.client.client_id,
    client_name: input.client.client_name,
    line_user_id: input.client.line_user_id,
    line_display_name: input.client.line_display_name,
    package_name: input.label,
    payment_type: input.paymentType,
    installment_number: String(item.installmentNumber),
    installment_count: String(input.paymentCount),
    amount_thb: String(item.amountSatang / 100),
    due_date: item.dueDate,
    status: "SCHEDULED",
    generated_at: "",
    payment_id: "",
    payment_url: "",
    notes: input.notes,
    created_at: input.now,
    updated_at: input.now,
    assignment_id: input.assignmentId,
    assignment_kind: input.assignmentKind,
  }));
}

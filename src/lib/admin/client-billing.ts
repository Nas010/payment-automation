import { parseSatang } from "@/lib/money";

type BillingSchedule = {
  schedule_id: string;
  amount_thb: string;
  due_date: string;
  status: string;
};

export function buildClientBillingSummary<T extends BillingSchedule>(schedules: readonly T[]) {
  const orderedSchedules = [...schedules].sort((left, right) =>
    left.due_date.localeCompare(right.due_date) || left.schedule_id.localeCompare(right.schedule_id));
  let totalSatang = 0;
  let paidSatang = 0;

  for (const schedule of orderedSchedules) {
    const amountSatang = parseSatang(schedule.amount_thb) ?? 0;
    totalSatang += amountSatang;
    if (schedule.status === "PAID") paidSatang += amountSatang;
  }

  return {
    orderedSchedules,
    totalSatang,
    paidSatang,
    outstandingSatang: totalSatang - paidSatang,
    nextDueDate: orderedSchedules.find((schedule) => schedule.status !== "PAID")?.due_date ?? "",
  };
}

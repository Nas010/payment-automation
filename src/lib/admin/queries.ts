import { parseSatang } from "@/lib/money";
import { listClients, type ClientRecord } from "@/lib/sheets/clients";
import { listPayments, type PaymentRecord } from "@/lib/sheets/payments";
import { listSchedules, type ScheduleRecord } from "@/lib/sheets/schedules";

type MetricClient = Pick<ClientRecord, "active">;
type MetricPayment = Pick<PaymentRecord, "status" | "amount_thb" | "recorded_at" | "manual_confirmed_at" | "created_at">;
type MetricSchedule = Pick<ScheduleRecord, "schedule_id" | "status" | "due_date" | "amount_thb">;

function satang(value: string): number { return parseSatang(value) ?? 0; }

export function buildDashboardReadModel(input: { today: string; clients: MetricClient[]; payments: MetricPayment[]; schedules: MetricSchedule[] }) {
  const month = input.today.slice(0, 7);
  const unpaid = input.schedules.filter((schedule) => schedule.status === "SCHEDULED" || schedule.status === "GENERATED");
  const collected = input.payments.filter((payment) => ["AUTO_RECORDED", "MANUAL_CONFIRMED"].includes(payment.status) && (payment.recorded_at || payment.manual_confirmed_at || payment.created_at).slice(0, 7) === month);
  return {
    activeClients: input.clients.filter((client) => client.active.toUpperCase() === "TRUE").length,
    dueToday: unpaid.filter((schedule) => schedule.due_date === input.today).length,
    overdue: unpaid.filter((schedule) => schedule.due_date < input.today).length,
    needsReview: input.payments.filter((payment) => payment.status === "REVIEW" || payment.status === "FLAGGED").length,
    outstandingSatang: unpaid.reduce((total, schedule) => total + satang(schedule.amount_thb), 0),
    collectedThisMonthSatang: collected.reduce((total, payment) => total + satang(payment.amount_thb), 0),
    upcoming: [...unpaid].sort((left, right) => left.due_date.localeCompare(right.due_date)),
  };
}

export function bangkokToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export async function getAdminDashboard() {
  const [clients, payments, schedules] = await Promise.all([listClients(), listPayments(), listSchedules()]);
  const today = bangkokToday();
  const dashboard = buildDashboardReadModel({ today, clients, payments, schedules });
  return { ...dashboard, upcoming: schedules.filter((schedule) => schedule.status === "SCHEDULED" || schedule.status === "GENERATED").sort((left, right) => left.due_date.localeCompare(right.due_date)), clients, payments, schedules };
}

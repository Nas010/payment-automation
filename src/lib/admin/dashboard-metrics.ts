import { parseSatang } from "@/lib/money";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import { z } from "zod";

type MetricClient = { active: string };
type MetricPayment = { status: string; amount_thb: string; recorded_at: string; manual_confirmed_at: string; created_at: string };
export type MetricSchedule = Pick<ScheduleRecord, "schedule_id" | "client_id" | "client_name" | "package_name" | "installment_number" | "installment_count" | "amount_thb" | "due_date" | "status" | "payment_id">;
type OperationalSetting = { key: string; value: string };

export type DashboardComparison = { current: number; previous: number; delta: number };
export type DashboardCollectedDeltaDisplay = "absolute" | "percentage";
export type DashboardReadModel = {
  activeClients: number;
  activeClientsComparison: DashboardComparison | null;
  dueToday: number;
  overdue: number;
  needsReview: number;
  outstandingSatang: number;
  collectedThisMonthSatang: number;
  collectedComparison: DashboardComparison | null;
  upcoming: MetricSchedule[];
};

export const DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY = "dashboard_collected_delta_display";
export const dashboardCollectedDeltaDisplaySchema = z.enum(["absolute", "percentage"]);

function satang(value: string): number { return parseSatang(value) ?? 0; }

function comparison(current: number, previous: number): DashboardComparison {
  return { current, previous, delta: current - previous };
}

function finalizedAt(payment: MetricPayment): string {
  return payment.recorded_at || payment.manual_confirmed_at || payment.created_at;
}

function isFinalized(payment: MetricPayment): boolean {
  return payment.status === "AUTO_RECORDED" || payment.status === "MANUAL_CONFIRMED";
}

export function previousMonth(month: string): string {
  const [rawYear, rawMonth] = month.split("-").map(Number);
  const date = new Date(Date.UTC(rawYear, rawMonth - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function activeClientSnapshotKey(month: string): string {
  return `dashboard_active_clients_${month}`;
}

export function parseActiveClientSnapshot(settings: OperationalSetting[], month: string): number | null {
  const value = settings.find((setting) => setting.key === activeClientSnapshotKey(month))?.value;
  if (!value || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : null;
}

export function parseDashboardCollectedDeltaDisplay(settings: OperationalSetting[]): DashboardCollectedDeltaDisplay {
  return settings.find((setting) => setting.key === DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY)?.value === "percentage" ? "percentage" : "absolute";
}

export function buildDashboardReadModel(input: { today: string; clients: MetricClient[]; payments: MetricPayment[]; schedules: MetricSchedule[]; activeClientsLastMonth?: number | null }): DashboardReadModel {
  const month = input.today.slice(0, 7);
  const priorMonth = previousMonth(month);
  const unpaid = input.schedules.filter((schedule) => schedule.status === "SCHEDULED" || schedule.status === "GENERATED");
  const finalized = input.payments.filter(isFinalized);
  const currentPayments = finalized.filter((payment) => finalizedAt(payment).slice(0, 7) === month);
  const previousPayments = finalized.filter((payment) => finalizedAt(payment).slice(0, 7) === priorMonth);
  const activeClients = input.clients.filter((client) => client.active.toUpperCase() === "TRUE").length;
  const currentCollected = currentPayments.reduce((total, payment) => total + satang(payment.amount_thb), 0);
  const previousCollected = previousPayments.reduce((total, payment) => total + satang(payment.amount_thb), 0);

  return {
    activeClients,
    activeClientsComparison: input.activeClientsLastMonth === null || input.activeClientsLastMonth === undefined ? null : comparison(activeClients, input.activeClientsLastMonth),
    dueToday: unpaid.filter((schedule) => schedule.due_date === input.today).length,
    overdue: unpaid.filter((schedule) => schedule.due_date < input.today).length,
    needsReview: input.payments.filter((payment) => payment.status === "REVIEW" || payment.status === "FLAGGED").length,
    outstandingSatang: unpaid.reduce((total, schedule) => total + satang(schedule.amount_thb), 0),
    collectedThisMonthSatang: currentCollected,
    collectedComparison: previousPayments.length ? comparison(currentCollected, previousCollected) : null,
    upcoming: [...unpaid].sort((left, right) => left.due_date.localeCompare(right.due_date)),
  };
}

import { bangkokDateKey } from "@/lib/date";
import { buildDashboardReadModel, parseActiveClientSnapshot, previousMonth } from "@/lib/admin/dashboard-metrics";
import { listClients } from "@/lib/sheets/clients";
import { listPayments } from "@/lib/sheets/payments";
import { listSchedules } from "@/lib/sheets/schedules";
import { listOperationalSettings } from "@/lib/sheets/settings";

export { buildDashboardReadModel } from "@/lib/admin/dashboard-metrics";

export function bangkokToday(): string { return bangkokDateKey(); }

export async function getAdminDashboard() {
  const [clients, payments, schedules, settings] = await Promise.all([listClients(), listPayments(), listSchedules(), listOperationalSettings()]);
  const today = bangkokToday();
  const dashboard = buildDashboardReadModel({ today, clients, payments, schedules, activeClientsLastMonth: parseActiveClientSnapshot(settings, previousMonth(today.slice(0, 7))) });
  return { ...dashboard, clients, payments, schedules, settings };
}

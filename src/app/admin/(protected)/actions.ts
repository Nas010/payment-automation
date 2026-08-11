"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY, dashboardCollectedDeltaDisplaySchema } from "@/lib/admin/dashboard-metrics";
import { paymentLinkBaseUrl } from "@/lib/config";
import { createLineLinkCode, expiresAt, normalizeLineLinkCode } from "@/lib/line/link-code";
import { renderLineLinkInstruction } from "@/lib/line/link-message";
import { disconnectLineUser, generateMissingLineLinkCodes, renewLineLinkCode, type GenerateMissingLineLinkCodesResult, type RenewLineLinkCodeResult } from "@/lib/line/linking";
import { parseSatang } from "@/lib/money";
import { buildInstallmentPlan } from "@/lib/plans/schedule";
import { generateDuePaymentLinks } from "@/lib/payments/generate";
import { persistPaymentTransition } from "@/lib/payments/transition";
import { listClients, updateClient, updateLineLinkClient, writeClient } from "@/lib/sheets/clients";
import { getPaymentById, appendAudit } from "@/lib/sheets/payments";
import { listSchedules, writeSchedule } from "@/lib/sheets/schedules";
import { listPackages, savePackage, upsertOperationalSetting } from "@/lib/sheets/settings";

const clientSchema = z.object({ client_name: z.string().trim().min(1), package_name: z.string().trim().min(1), payment_type: z.enum(["ONE_TIME", "INSTALLMENTS"]), total_price_thb: z.string(), installment_count: z.coerce.number().int().min(1), interval_months: z.coerce.number().int().min(0), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });

function values(formData: FormData) { return Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])); }

function newLineLinkCode(clients: Awaited<ReturnType<typeof listClients>>): string {
  const usedCodes = new Set(clients.map((client) => normalizeLineLinkCode(client.line_link_code)).filter((code): code is string => Boolean(code)));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = normalizeLineLinkCode(createLineLinkCode());
    if (code && !usedCodes.has(code)) return code;
  }
  throw new Error("Unable to generate a unique LINE link code");
}

function revalidateLinePages(clientId?: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  if (clientId) revalidatePath(`/admin/clients/${clientId}`);
}

export async function generateDueLinksAction(): Promise<void> {
  await requireAdmin();
  const baseUrl = paymentLinkBaseUrl(process.env, (await headers()).get("origin"));
  await generateDuePaymentLinks({ baseUrl });
  revalidatePath("/admin");
}

export async function createClientAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const data = clientSchema.parse(values(formData));
  const [packages, clients] = await Promise.all([listPackages(), listClients()]);
  const selectedPackage = packages.find((item) => item.package_name === data.package_name && item.active.toUpperCase() === "TRUE");
  if (!selectedPackage) throw new Error("Choose an active package");
  const totalSatang = parseSatang(data.total_price_thb);
  if (!totalSatang || totalSatang <= 0) throw new Error("Total price must be a positive THB amount");
  const paymentType = data.payment_type;
  const count = paymentType === "ONE_TIME" ? 1 : data.installment_count;
  const interval = paymentType === "ONE_TIME" ? 0 : data.interval_months;
  if (paymentType === "INSTALLMENTS" && interval < 1) throw new Error("Installment plans need an interval of at least one month");
  const clientId = `client_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  const lineLinkCode = newLineLinkCode(clients);
  const lineLinkFields = { line_link_code: lineLinkCode, line_link_code_expires_at: expiresAt(now), line_link_status: "CODE_ACTIVE", line_linked_at: "", line_link_message: renderLineLinkInstruction({ clientName: data.client_name, code: lineLinkCode }), line_link_error: "" };
  const plan = buildInstallmentPlan({ totalSatang, installmentCount: count, intervalMonths: interval, firstDueDate: data.first_due_date });
  if (clients.some((client) => client.client_id === clientId)) throw new Error("Could not allocate a unique client ID");
  await writeClient({ client_id: clientId, active: "TRUE", client_name: data.client_name, line_user_id: "", line_display_name: "", package_name: data.package_name, payment_type: paymentType, total_price_thb: String(totalSatang / 100), installment_count: String(count), interval_months: String(interval), first_due_date: data.first_due_date, default_amount_thb: String(plan[0].amountSatang / 100), billing_frequency: "MANUAL", next_due_date: data.first_due_date, notes: data.notes, created_at: now, updated_at: now, ...lineLinkFields });
  for (const item of plan) await writeSchedule({ schedule_id: `schedule_${crypto.randomUUID().replaceAll("-", "")}`, client_id: clientId, client_name: data.client_name, line_user_id: "", line_display_name: "", package_name: data.package_name, payment_type: paymentType, installment_number: String(item.installmentNumber), installment_count: String(count), amount_thb: String(item.amountSatang / 100), due_date: item.dueDate, status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: data.notes, created_at: now, updated_at: now });
  await appendAudit({ paymentId: "", clientId, action: "CLIENT_CREATED", previousStatus: "", newStatus: "SCHEDULED", reason: "Client and payment schedule created from admin", source: "ADMIN", metadata: JSON.stringify({ packageName: data.package_name, installmentCount: count, intervalMonths: interval }) });
  revalidatePath("/admin");
  redirect(`/admin/clients/${clientId}`);
}

export async function generateMissingLineLinkCodesAction(): Promise<GenerateMissingLineLinkCodesResult> {
  await requireAdmin();
  const result = await generateMissingLineLinkCodes({ listClients, updateClient, updateLineLinkClient, appendAudit }, { now: new Date() });
  revalidateLinePages();
  return result;
}

export async function renewLineLinkCodeAction(clientId: string): Promise<RenewLineLinkCodeResult> {
  await requireAdmin();
  const result = await renewLineLinkCode({ listClients, updateClient, updateLineLinkClient, appendAudit }, { clientId, now: new Date() });
  revalidateLinePages(clientId);
  return result;
}

export async function disconnectLineAction(clientId: string): Promise<boolean> {
  await requireAdmin();
  const disconnected = await disconnectLineUser({ listClients, updateClient, updateLineLinkClient, appendAudit }, { clientId, now: new Date() });
  revalidateLinePages(clientId);
  return disconnected;
}

export async function confirmPaymentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const paymentId = String(formData.get("payment_id") ?? ""); const reason = String(formData.get("reason") ?? "").trim(); const acknowledged = formData.get("acknowledged") === "on";
  if (!paymentId || !reason || !acknowledged) throw new Error("Reason and independent verification acknowledgement are required");
  const [payment, schedules] = await Promise.all([getPaymentById(paymentId), listSchedules()]);
  const schedule = schedules.find((item) => item.payment_id === paymentId);
  if (!payment || !schedule) throw new Error("Payment or linked schedule was not found");
  await persistPaymentTransition({ payment, schedule, nextStatus: "MANUAL_CONFIRMED", source: "ADMIN", reason });
  revalidatePath("/admin");
}

export async function savePackageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const data = values(formData); const type = data.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : "ONE_TIME";
  const total = parseSatang(data.total_price_thb); const count = Number(data.installment_count); const interval = Number(data.interval_months);
  if (!data.package_name || !total || total <= 0 || !Number.isInteger(count) || count < 1 || (type === "INSTALLMENTS" && (!Number.isInteger(interval) || interval < 1))) throw new Error("Enter a unique package, positive price, and valid payment plan");
  await savePackage({ package_name: data.package_name, total_price_thb: String(total / 100), payment_type: type, installment_count: String(type === "ONE_TIME" ? 1 : count), interval_months: String(type === "ONE_TIME" ? 0 : interval), active: data.active === "on" ? "TRUE" : "FALSE" });
  revalidatePath("/admin/packages");
}

export async function saveOperationalSettingAction(formData: FormData): Promise<void> {
  await requireAdmin(); const data = values(formData); if (!data.key.trim()) throw new Error("Setting key is required"); await upsertOperationalSetting(data.key.trim(), data.value.trim()); revalidatePath("/admin/settings");
}

export async function saveDashboardDisplaySettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const display = dashboardCollectedDeltaDisplaySchema.parse(values(formData).collected_delta_display);
  await upsertOperationalSetting(DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY, display);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/dashboard");
}

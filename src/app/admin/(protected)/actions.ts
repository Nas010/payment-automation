"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY, dashboardCollectedDeltaDisplaySchema } from "@/lib/admin/dashboard-metrics";
import { runtimeConfig } from "@/lib/runtime-config";
import { sendDueLinePaymentRequests } from "@/lib/line/due-payments";
import { createLineLinkCode, expiresAt, normalizeLineLinkCode } from "@/lib/line/link-code";
import { renderLineLinkInstruction } from "@/lib/line/link-message";
import { disconnectLineUser, generateMissingLineLinkCodes, renewLineLinkCode, type GenerateMissingLineLinkCodesResult, type RenewLineLinkCodeResult } from "@/lib/line/linking";
import { parseSatang } from "@/lib/money";
import { buildAssignedScheduleRows } from "@/lib/plans/assignment";
import { buildInstallmentPlan } from "@/lib/plans/schedule";
import { generateDuePaymentLinks } from "@/lib/payments/generate";
import { persistPaymentTransition } from "@/lib/payments/transition";
import { listClients, updateClient, updateLineLinkClient, writeClient } from "@/lib/sheets/clients";
import { getPaymentById, appendAudit, updatePaymentIfUnchanged } from "@/lib/sheets/payments";
import { listSchedules, writeSchedule } from "@/lib/sheets/schedules";
import { listPackages, savePackage, upsertOperationalSetting } from "@/lib/sheets/settings";

const clientSchema = z.object({ client_name: z.string().trim().min(1), package_name: z.string().trim().min(1), payment_type: z.enum(["ONE_TIME", "INSTALLMENTS"]), total_price_thb: z.string(), installment_count: z.coerce.number().int().min(1), interval_months: z.coerce.number().int().min(0), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });
const assignPackageSchema = z.object({ package_name: z.string().trim().min(1), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });
const manualPaymentSchema = z.object({ description: z.string().trim().min(1), amount_thb: z.string(), frequency: z.enum(["ONE_TIME", "RECURRING"]), payment_count: z.coerce.number().int().min(1), interval_months: z.coerce.number().int().min(0), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });

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

function revalidatePaymentPages(paymentId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${paymentId}`);
}

export type LinePaymentAdminActionResult = { outcome: "SENT" | "ALREADY_ACCEPTED" | "DISABLED" | "MISSING_RECIPIENT" | "FAILED" | "NOT_ELIGIBLE" };

export async function sendLinePaymentAction(paymentId: string): Promise<LinePaymentAdminActionResult> {
  await requireAdmin();
  if (!paymentId.trim()) throw new Error("Payment ID is required");
  const baseUrl = (await runtimeConfig()).publicBaseUrl;
  const result = await sendDueLinePaymentRequests({ baseUrl, paymentIds: [paymentId] });
  revalidatePaymentPages(paymentId);
  if (result.accepted.includes(paymentId)) return { outcome: "SENT" };
  if (result.alreadyAccepted.includes(paymentId)) return { outcome: "ALREADY_ACCEPTED" };
  if (result.disabled) return { outcome: "DISABLED" };
  if (result.skippedMissingUserId.includes(paymentId)) return { outcome: "MISSING_RECIPIENT" };
  if (result.failed.includes(paymentId)) return { outcome: "FAILED" };
  return { outcome: "NOT_ELIGIBLE" };
}

export async function stopAwaitingLineSlipAction(paymentId: string): Promise<boolean> {
  await requireAdmin();
  if (!paymentId.trim()) throw new Error("Payment ID is required");
  const payment = await getPaymentById(paymentId);
  if (!payment || payment.line_slip_expected !== "TRUE" || payment.line_slip_processing_status !== "AWAITING") return false;
  const now = new Date().toISOString();
  const updated = {
    ...payment,
    line_slip_expected: "FALSE",
    line_slip_processing_status: "STOPPED",
    updated_at: now,
  };
  if (!await updatePaymentIfUnchanged({ expectedPayment: payment, payment: updated })) {
    revalidatePaymentPages(paymentId);
    return false;
  }
  await appendAudit({
    paymentId: payment.payment_id,
    clientId: payment.client_id,
    action: "LINE_SLIP_AWAITING_STOPPED",
    previousStatus: "AWAITING",
    newStatus: "STOPPED",
    reason: "Admin stopped awaiting a LINE payment slip",
    source: "ADMIN",
    metadata: JSON.stringify({ paymentId: payment.payment_id, lineSlipExpected: false }),
  });
  revalidatePaymentPages(paymentId);
  return true;
}

function revalidateClientBillingPages(clientId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${clientId}`);
}

function newScheduleId(): string {
  return `schedule_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function generateDueLinksAction(): Promise<void> {
  await requireAdmin();
  const baseUrl = (await runtimeConfig()).publicBaseUrl;
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

export async function assignPackageAction(clientId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const data = assignPackageSchema.parse(values(formData));
  const [clients, packages] = await Promise.all([listClients(), listPackages()]);
  const client = clients.find((item) => item.client_id === clientId);
  if (!client) throw new Error("Client was not found");
  const selectedPackage = packages.find((item) => item.package_name === data.package_name && item.active.toUpperCase() === "TRUE");
  if (!selectedPackage) throw new Error("Choose an active package");
  const totalSatang = parseSatang(selectedPackage.total_price_thb);
  if (!totalSatang || totalSatang <= 0 || !Number.isSafeInteger(totalSatang)) throw new Error("Package price must be a positive THB amount");
  const paymentType = selectedPackage.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : selectedPackage.payment_type === "ONE_TIME" ? "ONE_TIME" : null;
  if (!paymentType) throw new Error("Package payment type is invalid");
  const paymentCount = paymentType === "ONE_TIME" ? 1 : Number(selectedPackage.installment_count);
  const intervalMonths = paymentType === "ONE_TIME" ? 0 : Number(selectedPackage.interval_months);
  const now = new Date().toISOString();
  const schedules = buildAssignedScheduleRows({ client, label: selectedPackage.package_name, paymentType, totalSatang, paymentCount, intervalMonths, firstDueDate: data.first_due_date, notes: data.notes, now, createScheduleId: newScheduleId });

  for (const schedule of schedules) await writeSchedule(schedule);
  await updateClient({
    ...client,
    package_name: selectedPackage.package_name,
    payment_type: paymentType,
    total_price_thb: String(totalSatang / 100),
    installment_count: String(paymentCount),
    interval_months: String(intervalMonths),
    first_due_date: data.first_due_date,
    default_amount_thb: schedules[0].amount_thb,
    billing_frequency: "MANUAL",
    next_due_date: data.first_due_date,
    updated_at: now,
  });
  await appendAudit({ paymentId: "", clientId, action: "PACKAGE_ASSIGNED", previousStatus: "", newStatus: "SCHEDULED", reason: "Package assigned to existing client", source: "ADMIN", metadata: JSON.stringify({ packageName: selectedPackage.package_name, installmentCount: paymentCount, intervalMonths }) });
  revalidateClientBillingPages(clientId);
  redirect(`/admin/clients/${clientId}`);
}

export async function createManualPaymentAction(clientId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const data = manualPaymentSchema.parse(values(formData));
  const clients = await listClients();
  const client = clients.find((item) => item.client_id === clientId);
  if (!client) throw new Error("Client was not found");
  const totalSatang = parseSatang(data.amount_thb);
  if (!totalSatang || totalSatang <= 0 || !Number.isSafeInteger(totalSatang)) throw new Error("Amount must be a positive THB amount");
  const paymentType = data.frequency === "ONE_TIME" ? "ONE_TIME" : "INSTALLMENTS";
  const paymentCount = data.frequency === "ONE_TIME" ? 1 : data.payment_count;
  const intervalMonths = data.frequency === "ONE_TIME" ? 0 : data.interval_months;
  if (data.frequency === "RECURRING" && (paymentCount < 2 || intervalMonths < 1)) throw new Error("Recurring payments need at least two payments and a one-month interval");
  const now = new Date().toISOString();
  const schedules = buildAssignedScheduleRows({ client, label: data.description, paymentType, totalSatang, paymentCount, intervalMonths, firstDueDate: data.first_due_date, notes: data.notes, now, createScheduleId: newScheduleId });

  for (const schedule of schedules) await writeSchedule(schedule);
  await appendAudit({ paymentId: "", clientId, action: "MANUAL_PAYMENT_SCHEDULED", previousStatus: "", newStatus: "SCHEDULED", reason: "Manual payment scheduled for existing client", source: "ADMIN", metadata: JSON.stringify({ description: data.description, paymentCount, intervalMonths, totalSatang }) });
  revalidateClientBillingPages(clientId);
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

export async function saveDashboardDisplaySettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const display = dashboardCollectedDeltaDisplaySchema.parse(values(formData).collected_delta_display);
  await upsertOperationalSetting(DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY, display);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/dashboard");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { DASHBOARD_COLLECTED_DELTA_DISPLAY_KEY, dashboardCollectedDeltaDisplaySchema } from "@/lib/admin/dashboard-metrics";
import { runtimeConfig } from "@/lib/runtime-config";
import { sendDueLinePaymentRequests } from "@/lib/line/due-payments";
import { generateMissingLineConnections, renewLineConnection, type GenerateMissingLineConnectionsResult, type RenewLineConnectionResult } from "@/lib/line/connection";
import { createLineConnectionTokenFields } from "@/lib/line/connection-token";
import { disconnectLineUser } from "@/lib/line/linking";
import { parseSatang } from "@/lib/money";
import { buildAssignedScheduleRows } from "@/lib/plans/assignment";
import { buildPackageAssignments, type PackageAssignment } from "@/lib/plans/assignment-lifecycle";
import { buildInstallmentPlan } from "@/lib/plans/schedule";
import { generateDuePaymentLinks } from "@/lib/payments/generate";
import { persistPaymentTransition } from "@/lib/payments/transition";
import { claimLineConnection, listClients, updateClient, updateLineLinkClient, writeClient } from "@/lib/sheets/clients";
import { getPaymentById, appendAudit, listPayments, updatePaymentIfUnchanged, type PaymentRecord } from "@/lib/sheets/payments";
import { listSchedules, updateSchedule, writeSchedule, type ScheduleRecord } from "@/lib/sheets/schedules";
import { listPackages, savePackage, upsertOperationalSetting } from "@/lib/sheets/settings";

const clientSchema = z.object({ client_name: z.string().trim().min(1), package_name: z.string().trim().min(1), payment_type: z.enum(["ONE_TIME", "INSTALLMENTS"]), total_price_thb: z.string(), installment_count: z.coerce.number().int().min(1), interval_months: z.coerce.number().int().min(0), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });
const assignPackageSchema = z.object({ package_name: z.string().trim().min(1), payment_type: z.enum(["ONE_TIME", "INSTALLMENTS"]), total_price_thb: z.string(), installment_count: z.coerce.number().int().min(1), interval_months: z.coerce.number().int().min(0), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });
const manualPaymentSchema = z.object({ description: z.string().trim().min(1), amount_thb: z.string(), frequency: z.enum(["ONE_TIME", "RECURRING"]), payment_count: z.coerce.number().int().min(1), interval_months: z.coerce.number().int().min(0), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });
const assignmentIdSchema = z.object({ assignment_id: z.string().trim().min(1) });
const changePackageAssignmentSchema = assignmentIdSchema.extend({ package_name: z.string().trim().min(1), first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().trim() });

function values(formData: FormData) { return Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])); }

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

function newAssignmentId(): string {
  return `assignment_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function generateAndSendInitialPayment(scheduleIds: string[]): Promise<void> {
  if (!scheduleIds.length) return;
  const baseUrl = (await runtimeConfig()).publicBaseUrl;
  const generated = await generateDuePaymentLinks({ baseUrl, scheduleIds });
  if (generated.created.length) await sendDueLinePaymentRequests({ baseUrl, paymentIds: generated.created.map((payment) => payment.payment_id) });
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
  const lineLinkFields = { line_link_code: "", line_link_code_expires_at: "", line_linked_at: "", line_link_message: "", line_link_error: "", ...createLineConnectionTokenFields({ clientId, now }) };
  const plan = buildInstallmentPlan({ totalSatang, installmentCount: count, intervalMonths: interval, firstDueDate: data.first_due_date });
  if (clients.some((client) => client.client_id === clientId)) throw new Error("Could not allocate a unique client ID");
  await writeClient({ client_id: clientId, active: "TRUE", client_name: data.client_name, line_user_id: "", line_display_name: "", line_picture_url: "", package_name: data.package_name, payment_type: paymentType, total_price_thb: String(totalSatang / 100), installment_count: String(count), interval_months: String(interval), first_due_date: data.first_due_date, default_amount_thb: String(plan[0].amountSatang / 100), billing_frequency: "MANUAL", next_due_date: data.first_due_date, notes: data.notes, created_at: now, updated_at: now, ...lineLinkFields });
  const assignmentId = newAssignmentId();
  const schedules = plan.map((item) => ({ schedule_id: `schedule_${crypto.randomUUID().replaceAll("-", "")}`, client_id: clientId, client_name: data.client_name, line_user_id: "", line_display_name: "", package_name: data.package_name, payment_type: paymentType, installment_number: String(item.installmentNumber), installment_count: String(count), amount_thb: String(item.amountSatang / 100), due_date: item.dueDate, status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: data.notes, created_at: now, updated_at: now, assignment_id: assignmentId, assignment_kind: "PACKAGE" as const }));
  for (const schedule of schedules) await writeSchedule(schedule);
  await generateAndSendInitialPayment([schedules[0].schedule_id]);
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
  const totalSatang = parseSatang(data.total_price_thb);
  if (!totalSatang || totalSatang <= 0 || !Number.isSafeInteger(totalSatang)) throw new Error("Total price must be a positive THB amount");
  const paymentType = data.payment_type;
  const paymentCount = paymentType === "ONE_TIME" ? 1 : data.installment_count;
  const intervalMonths = paymentType === "ONE_TIME" ? 0 : data.interval_months;
  if (paymentType === "INSTALLMENTS" && (paymentCount < 2 || intervalMonths < 1)) throw new Error("Installment plans need at least two payments and a one-month interval");
  const now = new Date().toISOString();
  const schedules = buildAssignedScheduleRows({ client, label: selectedPackage.package_name, paymentType, totalSatang, paymentCount, intervalMonths, firstDueDate: data.first_due_date, notes: data.notes, now, assignmentId: newAssignmentId(), assignmentKind: "PACKAGE", createScheduleId: newScheduleId });

  for (const schedule of schedules) await writeSchedule(schedule);
  await generateAndSendInitialPayment([schedules[0].schedule_id]);
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
  const schedules = buildAssignedScheduleRows({ client, label: data.description, paymentType, totalSatang, paymentCount, intervalMonths, firstDueDate: data.first_due_date, notes: data.notes, now, assignmentId: newAssignmentId(), assignmentKind: "MANUAL", createScheduleId: newScheduleId });

  for (const schedule of schedules) await writeSchedule(schedule);
  await generateAndSendInitialPayment([schedules[0].schedule_id]);
  await appendAudit({ paymentId: "", clientId, action: "MANUAL_PAYMENT_SCHEDULED", previousStatus: "", newStatus: "SCHEDULED", reason: "Manual payment scheduled for existing client", source: "ADMIN", metadata: JSON.stringify({ description: data.description, paymentCount, intervalMonths, totalSatang }) });
  revalidateClientBillingPages(clientId);
  redirect(`/admin/clients/${clientId}`);
}

type PackageLifecycleContext = {
  client: Awaited<ReturnType<typeof listClients>>[number];
  assignment: PackageAssignment<ScheduleRecord>;
  packages: Awaited<ReturnType<typeof listPackages>>;
  payments: PaymentRecord[];
};

async function loadPackageLifecycleContext(clientId: string, assignmentId: string): Promise<PackageLifecycleContext> {
  const [clients, schedules, payments, packages] = await Promise.all([listClients(), listSchedules(), listPayments(), listPackages()]);
  const client = clients.find((item) => item.client_id === clientId);
  if (!client) throw new Error("Client was not found");
  const assignment = buildPackageAssignments(schedules.filter((item) => item.client_id === clientId), new Set(packages.map((item) => item.package_name)))
    .find((item) => item.id === assignmentId);
  if (!assignment) throw new Error("Package assignment was not found for this client");
  return { client, assignment, packages, payments };
}

function requireAssignmentState(assignment: PackageAssignment<ScheduleRecord>, allowed: readonly PackageAssignment<ScheduleRecord>["state"][], action: string): void {
  if (["COMPLETED", "ENDED", "DELETED"].includes(assignment.state)) {
    throw new Error(`Package assignment is already ${assignment.state.toLowerCase()}`);
  }
  if (!allowed.includes(assignment.state)) throw new Error(`Package assignment must be ${allowed.map((item) => item.toLowerCase()).join(" or ")} to ${action}`);
}

function outstandingAssignmentSchedules(assignment: PackageAssignment<ScheduleRecord>): ScheduleRecord[] {
  return assignment.schedules.filter((schedule) => !["PAID", "CANCELLED", "DELETED"].includes(schedule.status));
}

function generatedPaymentForSchedule(schedule: ScheduleRecord, paymentsById: ReadonlyMap<string, PaymentRecord>): PaymentRecord | null {
  const hasGeneratedPayment = schedule.status === "GENERATED" || Boolean(schedule.generated_at || schedule.payment_id || schedule.payment_url);
  if (!hasGeneratedPayment) return null;
  if (!schedule.payment_id) throw new Error(`Generated schedule ${schedule.schedule_id} is missing a linked payment`);
  const payment = paymentsById.get(schedule.payment_id);
  if (!payment || payment.client_id !== schedule.client_id) throw new Error(`Generated schedule ${schedule.schedule_id} is missing a linked payment`);
  if (payment.status !== "PENDING") throw new Error(`Package assignment cannot be changed while payment ${payment.payment_id} is ${payment.status}`);
  return payment;
}

async function updateLifecycleSchedules(schedules: readonly ScheduleRecord[], nextStatus: "PAUSED" | "SCHEDULED" | "CANCELLED" | "DELETED", payments: readonly PaymentRecord[], now: string): Promise<void> {
  const paymentsById = new Map(payments.map((payment) => [payment.payment_id, payment]));
  const linkedPayments = new Map<string, PaymentRecord>();
  const paymentsByScheduleId = new Map<string, PaymentRecord>();

  for (const schedule of schedules) {
    const payment = generatedPaymentForSchedule(schedule, paymentsById);
    if (payment) {
      linkedPayments.set(payment.payment_id, payment);
      paymentsByScheduleId.set(schedule.schedule_id, payment);
    }
  }

  for (const payment of linkedPayments.values()) {
    const voided = { ...payment, status: "VOID", line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED", updated_at: now };
    if (!await updatePaymentIfUnchanged({ expectedPayment: payment, payment: voided })) {
      throw new Error("Payment changed before package lifecycle update");
    }
  }

  for (const schedule of schedules) {
    const payment = paymentsByScheduleId.get(schedule.schedule_id);
    await updateSchedule({
      ...schedule,
      status: nextStatus,
      ...(payment ? { generated_at: "", payment_id: "", payment_url: "" } : {}),
      updated_at: now,
    });
  }
}

async function recordPackageLifecycleAction(input: {
  clientId: string;
  assignment: PackageAssignment<ScheduleRecord>;
  action: string;
  newStatus: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await appendAudit({
    paymentId: "",
    clientId: input.clientId,
    action: input.action,
    previousStatus: input.assignment.state,
    newStatus: input.newStatus,
    reason: input.reason,
    source: "ADMIN",
    metadata: JSON.stringify({ assignmentId: input.assignment.id, packageName: input.assignment.label, ...input.metadata }),
  });
}

async function finishPackageLifecycleAction(clientId: string): Promise<void> {
  revalidateClientBillingPages(clientId);
  redirect(`/admin/clients/${clientId}`);
}

export async function pausePackageAssignmentAction(clientId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const data = assignmentIdSchema.parse(values(formData));
  const context = await loadPackageLifecycleContext(clientId, data.assignment_id);
  requireAssignmentState(context.assignment, ["ACTIVE"], "pause");
  await updateLifecycleSchedules(outstandingAssignmentSchedules(context.assignment), "PAUSED", context.payments, new Date().toISOString());
  await recordPackageLifecycleAction({ clientId, assignment: context.assignment, action: "PACKAGE_ASSIGNMENT_PAUSED", newStatus: "PAUSED", reason: "Package assignment paused by admin" });
  await finishPackageLifecycleAction(clientId);
}

export async function resumePackageAssignmentAction(clientId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const data = assignmentIdSchema.parse(values(formData));
  const context = await loadPackageLifecycleContext(clientId, data.assignment_id);
  requireAssignmentState(context.assignment, ["PAUSED"], "resume");
  await updateLifecycleSchedules(outstandingAssignmentSchedules(context.assignment), "SCHEDULED", context.payments, new Date().toISOString());
  await recordPackageLifecycleAction({ clientId, assignment: context.assignment, action: "PACKAGE_ASSIGNMENT_RESUMED", newStatus: "ACTIVE", reason: "Package assignment resumed by admin" });
  await finishPackageLifecycleAction(clientId);
}

export async function endPackageAssignmentAction(clientId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const data = assignmentIdSchema.parse(values(formData));
  const context = await loadPackageLifecycleContext(clientId, data.assignment_id);
  requireAssignmentState(context.assignment, ["ACTIVE", "PAUSED"], "end");
  await updateLifecycleSchedules(outstandingAssignmentSchedules(context.assignment), "CANCELLED", context.payments, new Date().toISOString());
  await recordPackageLifecycleAction({ clientId, assignment: context.assignment, action: "PACKAGE_ASSIGNMENT_ENDED", newStatus: "ENDED", reason: "Package assignment ended by admin" });
  await finishPackageLifecycleAction(clientId);
}

export async function deletePackageAssignmentAction(clientId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const data = assignmentIdSchema.parse(values(formData));
  const context = await loadPackageLifecycleContext(clientId, data.assignment_id);
  requireAssignmentState(context.assignment, ["ACTIVE", "PAUSED"], "delete");
  if (context.assignment.paidSatang > 0) throw new Error("Package assignment cannot be deleted after a payment has been recorded");
  await updateLifecycleSchedules(outstandingAssignmentSchedules(context.assignment), "DELETED", context.payments, new Date().toISOString());
  await recordPackageLifecycleAction({ clientId, assignment: context.assignment, action: "PACKAGE_ASSIGNMENT_DELETED", newStatus: "DELETED", reason: "Package assignment deleted by admin" });
  await finishPackageLifecycleAction(clientId);
}

export async function changePackageAssignmentAction(clientId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const data = changePackageAssignmentSchema.parse(values(formData));
  const context = await loadPackageLifecycleContext(clientId, data.assignment_id);
  requireAssignmentState(context.assignment, ["ACTIVE", "PAUSED"], "change");
  const selectedPackage = context.packages.find((item) => item.package_name === data.package_name && item.active.toUpperCase() === "TRUE");
  if (!selectedPackage) throw new Error("Choose an active package");
  const targetTotalSatang = parseSatang(selectedPackage.total_price_thb);
  const paymentType = selectedPackage.payment_type === "ONE_TIME" ? "ONE_TIME" : selectedPackage.payment_type === "INSTALLMENTS" ? "INSTALLMENTS" : null;
  const configuredCount = Number(selectedPackage.installment_count);
  const configuredInterval = Number(selectedPackage.interval_months);
  const paymentCount = paymentType === "ONE_TIME" ? 1 : configuredCount;
  const intervalMonths = paymentType === "ONE_TIME" ? 0 : configuredInterval;
  if (!targetTotalSatang || targetTotalSatang <= 0 || !Number.isSafeInteger(targetTotalSatang) || !paymentType || !Number.isInteger(paymentCount) || paymentCount < 1 || (paymentType === "INSTALLMENTS" && (paymentCount < 2 || !Number.isInteger(intervalMonths) || intervalMonths < 1))) {
    throw new Error("Selected package has invalid payment terms");
  }

  const now = new Date().toISOString();
  const scheduledOutstandingSatang = Math.max(targetTotalSatang - context.assignment.paidSatang, 0);
  await updateLifecycleSchedules(outstandingAssignmentSchedules(context.assignment), "CANCELLED", context.payments, now);
  const schedules = scheduledOutstandingSatang > 0
    ? buildAssignedScheduleRows({ client: context.client, label: selectedPackage.package_name, paymentType, totalSatang: scheduledOutstandingSatang, paymentCount, intervalMonths, firstDueDate: data.first_due_date, notes: data.notes, now, assignmentId: newAssignmentId(), assignmentKind: "PACKAGE", createScheduleId: newScheduleId })
    : [];
  for (const schedule of schedules) await writeSchedule(schedule);
  await generateAndSendInitialPayment(schedules.length ? [schedules[0].schedule_id] : []);
  await updateClient({
    ...context.client,
    package_name: selectedPackage.package_name,
    payment_type: paymentType,
    total_price_thb: String(targetTotalSatang / 100),
    installment_count: String(paymentCount),
    interval_months: String(intervalMonths),
    first_due_date: data.first_due_date,
    default_amount_thb: schedules[0]?.amount_thb ?? "0",
    billing_frequency: "MANUAL",
    next_due_date: schedules[0]?.due_date ?? "",
    updated_at: now,
  });
  await recordPackageLifecycleAction({
    clientId,
    assignment: context.assignment,
    action: "PACKAGE_ASSIGNMENT_CHANGED",
    newStatus: scheduledOutstandingSatang > 0 ? "ACTIVE" : "COMPLETED",
    reason: "Package assignment changed by admin",
    metadata: {
      packageName: selectedPackage.package_name,
      paidSatang: context.assignment.paidSatang,
      targetTotalSatang,
      scheduledOutstandingSatang,
      excessCreditSatang: Math.max(context.assignment.paidSatang - targetTotalSatang, 0),
    },
  });
  await finishPackageLifecycleAction(clientId);
}

export async function generateMissingLineConnectionsAction(): Promise<GenerateMissingLineConnectionsResult> {
  await requireAdmin();
  const result = await generateMissingLineConnections({ listClients, updateLineLinkClient, claimLineConnection, appendAudit }, { now: new Date() });
  revalidateLinePages();
  return result;
}

export async function renewLineConnectionAction(clientId: string): Promise<RenewLineConnectionResult> {
  await requireAdmin();
  const result = await renewLineConnection({ listClients, updateLineLinkClient, claimLineConnection, appendAudit }, { clientId, now: new Date() });
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

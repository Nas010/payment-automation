import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  headers: vi.fn(),
  listClients: vi.fn(),
  writeClient: vi.fn(),
  updateClient: vi.fn(),
  updateLineLinkClient: vi.fn(),
  claimLineConnection: vi.fn(),
  appendAudit: vi.fn(),
  listPackages: vi.fn(),
  writeSchedule: vi.fn(),
  generateDuePaymentLinks: vi.fn(),
  getPaymentById: vi.fn(),
  listPayments: vi.fn(),
  listSchedules: vi.fn(),
  updateSchedule: vi.fn(),
  updateSchedulesIfUnchanged: vi.fn(),
  persistPaymentTransition: vi.fn(),
  sendDueLinePaymentRequests: vi.fn(),
  updatePaymentIfUnchanged: vi.fn(),
  savePackage: vi.fn(),
  upsertOperationalSetting: vi.fn(),
  runtimeConfig: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/payments/generate", () => ({ generateDuePaymentLinks: mocks.generateDuePaymentLinks }));
vi.mock("@/lib/payments/transition", () => ({ persistPaymentTransition: mocks.persistPaymentTransition }));
vi.mock("@/lib/line/due-payments", () => ({ sendDueLinePaymentRequests: mocks.sendDueLinePaymentRequests }));
vi.mock("@/lib/sheets/clients", () => ({ listClients: mocks.listClients, writeClient: mocks.writeClient, updateClient: mocks.updateClient, updateLineLinkClient: mocks.updateLineLinkClient, claimLineConnection: mocks.claimLineConnection }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit, getPaymentById: mocks.getPaymentById, listPayments: mocks.listPayments, updatePaymentIfUnchanged: mocks.updatePaymentIfUnchanged }));
vi.mock("@/lib/sheets/schedules", () => ({ listSchedules: mocks.listSchedules, updateSchedule: mocks.updateSchedule, updateSchedulesIfUnchanged: mocks.updateSchedulesIfUnchanged, writeSchedule: mocks.writeSchedule }));
vi.mock("@/lib/sheets/settings", () => ({ listPackages: mocks.listPackages, savePackage: mocks.savePackage, upsertOperationalSetting: mocks.upsertOperationalSetting }));

import { hashLineConnectionToken, recoverLineConnectionToken } from "@/lib/line/connection-token";
import { assignPackageAction, changePackageAssignmentAction, confirmPaymentAction, createClientAction, createManualPaymentAction, deletePackageAssignmentAction, disconnectLineAction, endPackageAssignmentAction, generateMissingLineConnectionsAction, pausePackageAssignmentAction, renewLineConnectionAction, resumePackageAssignmentAction, sendLinePaymentAction, stopAwaitingLineSlipAction, togglePackageActiveAction } from "./actions";

const now = "2026-08-10T12:00:00.000Z";
const userId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", line_picture_url: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "",
    line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "",
    ...overrides,
  };
}

function clientForm(): FormData {
  const formData = new FormData();
  for (const [key, value] of [["client_name", "Nisa"], ["line_user_id", userId], ["line_display_name", "Manual name"], ["package_name", "PT"], ["payment_type", "ONE_TIME"], ["total_price_thb", "1000"], ["installment_count", "1"], ["interval_months", "0"], ["first_due_date", "2026-08-17"], ["notes", ""]]) formData.set(key, value);
  return formData;
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    rowNumber: 2,
    payment_id: "pay_1",
    client_id: "client_1",
    status: "PENDING",
    line_slip_expected: "TRUE",
    line_slip_processing_status: "AWAITING",
    updated_at: now,
    ...overrides,
  } as PaymentRecord;
}

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    rowNumber: 2,
    schedule_id: "schedule_1",
    client_id: "client_1",
    client_name: "Nisa",
    line_user_id: "",
    line_display_name: "",
    package_name: "PT",
    payment_type: "INSTALLMENTS",
    installment_number: "1",
    installment_count: "2",
    amount_thb: "500",
    due_date: "2026-08-17",
    status: "SCHEDULED",
    generated_at: "",
    payment_id: "",
    payment_url: "",
    notes: "",
    created_at: now,
    updated_at: now,
    assignment_id: "assignment_1",
    assignment_kind: "PACKAGE",
    lifecycle_operation_id: "",
    ...overrides,
  };
}

function assignmentForm(values: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("assignment_id", "assignment_1");
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.headers.mockResolvedValue(new Headers({ origin: "https://example.test" }));
  mocks.listClients.mockResolvedValue([]);
  mocks.writeClient.mockResolvedValue(undefined);
  mocks.updateClient.mockResolvedValue(undefined);
  mocks.updateLineLinkClient.mockResolvedValue(true);
  mocks.claimLineConnection.mockResolvedValue("CLAIMED");
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
  mocks.writeSchedule.mockResolvedValue(undefined);
  mocks.generateDuePaymentLinks.mockResolvedValue({ created: [], existing: [], failed: [] });
  mocks.getPaymentById.mockResolvedValue(payment());
  mocks.listPayments.mockResolvedValue([]);
  mocks.listSchedules.mockResolvedValue([]);
  mocks.updateSchedule.mockResolvedValue(undefined);
  mocks.updateSchedulesIfUnchanged.mockResolvedValue(true);
  mocks.updatePaymentIfUnchanged.mockResolvedValue(true);
  mocks.sendDueLinePaymentRequests.mockResolvedValue({ accepted: ["pay_1"], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });
  mocks.runtimeConfig.mockResolvedValue({ publicBaseUrl: "https://example.test" });
});

afterEach(() => vi.unstubAllEnvs());

describe("protected LINE trainer actions", () => {
  it("creates a client with a blank mapping and a seven-day secure connection token", async () => {
    await createClientAction(clientForm());

    const saved = mocks.writeClient.mock.calls[0]?.[0] as Record<string, string>;
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ line_user_id: "", line_display_name: "", line_link_status: "LINK_ACTIVE", line_linked_at: "", line_link_error: "", line_link_code: "", line_link_code_expires_at: "", line_link_message: "" });
    const rawToken = recoverLineConnectionToken({ clientId: saved.client_id, encryptedToken: saved.line_link_token_encrypted });
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved.line_link_token_hash).toBe(hashLineConnectionToken(rawToken));
    expect(new Date(saved.line_link_token_expires_at).getTime() - new Date(saved.created_at).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(JSON.stringify(saved)).not.toContain(rawToken);
    expect(mocks.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ line_user_id: "", line_display_name: "", assignment_id: expect.stringMatching(/^assignment_[a-z0-9]+$/), assignment_kind: "PACKAGE" }));
  });

  it("returns bulk created, active, linked, and failed reports after admin authorization", async () => {
    mocks.listClients.mockResolvedValue([
      client({ client_id: "created" }),
      client({ rowNumber: 3, client_id: "active", line_link_token_hash: "a".repeat(64), line_link_token_encrypted: "encrypted", line_link_token_expires_at: "2099-08-17T12:00:00.000Z", line_link_status: "LINK_ACTIVE" }),
      client({ rowNumber: 4, client_id: "linked", line_user_id: userId, line_link_status: "LINKED" }),
      client({ rowNumber: 5, client_id: "failed", client_name: "Broken" }),
    ]);
    mocks.updateLineLinkClient.mockImplementation(async ({ client: updated }: { client: ClientRecord }) => { if (updated.client_id === "failed") throw new Error("sheet unavailable"); return true; });

    await expect(generateMissingLineConnectionsAction()).resolves.toMatchObject({ created: ["created"], alreadyActive: ["active"], alreadyLinked: ["linked"], failed: [{ clientId: "failed", error: "sheet unavailable" }] });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/clients");
  });

  it("creates a new secure connection link only for an unlinked selected client", async () => {
    mocks.listClients.mockResolvedValue([client({ line_link_token_hash: "a".repeat(64), line_link_token_encrypted: "old", line_link_token_expires_at: "2099-08-17T12:00:00.000Z", line_link_status: "LINK_ACTIVE" })]);

    const result = await renewLineConnectionAction("client_1");

    expect(result).toEqual({ clientId: "client_1", status: "LINK_ACTIVE" });
    expect(mocks.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_user_id: "", line_link_status: "LINK_ACTIVE", line_link_code: "", line_link_message: "" }) }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/clients/client_1");
  });

  it("rejects renewal for a client that already has a different LINE user ID", async () => {
    mocks.listClients.mockResolvedValue([client({ line_user_id: userId, line_display_name: "Nisa LINE", line_link_code: "ABCDEF0123", line_link_status: "LINKED" })]);

    await expect(renewLineConnectionAction("client_1")).resolves.toBeNull();

    expect(mocks.updateLineLinkClient).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("disconnects an existing mapping, clears link fields, and preserves its audit event", async () => {
    mocks.listClients.mockResolvedValue([client({ line_user_id: userId, line_display_name: "Nisa LINE", line_link_status: "LINKED", line_linked_at: now })]);

    await expect(disconnectLineAction("client_1")).resolves.toBe(true);

    expect(mocks.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_user_id: "", line_display_name: "", line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "", line_link_token_hash: "", line_link_token_encrypted: "", line_link_token_expires_at: "" }) }));
    expect(mocks.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ releaseLineUserId: userId }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINE_LINK_DISCONNECTED", clientId: "client_1", source: "LINE_TRAINER" }));
  });
});

describe("protected LINE payment actions", () => {
  it("sends a single payment through shared sender and revalidates payment views", async () => {
    await expect(sendLinePaymentAction("pay_1")).resolves.toEqual({ outcome: "SENT" });

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.sendDueLinePaymentRequests).toHaveBeenCalledWith({ baseUrl: "https://example.test", paymentIds: ["pay_1"] });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/payments/pay_1");
  });

  it("does not turn an accepted request into a resend", async () => {
    mocks.sendDueLinePaymentRequests.mockResolvedValue({ accepted: [], alreadyAccepted: ["pay_1"], skippedMissingUserId: [], failed: [], disabled: false });

    await expect(sendLinePaymentAction("pay_1")).resolves.toEqual({ outcome: "ALREADY_ACCEPTED" });
    expect(mocks.sendDueLinePaymentRequests).toHaveBeenCalledTimes(1);
  });

  it("stops awaiting a LINE slip through payment CAS and records an admin audit", async () => {
    await expect(stopAwaitingLineSlipAction("pay_1")).resolves.toBe(true);

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith({
      expectedPayment: payment(),
      payment: expect.objectContaining({ line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED", updated_at: expect.any(String) }),
    });
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ paymentId: "pay_1", clientId: "client_1", action: "LINE_SLIP_AWAITING_STOPPED", source: "ADMIN" }));
  });

  it("does not audit when a competing update wins the payment CAS", async () => {
    mocks.updatePaymentIfUnchanged.mockResolvedValue(false);

    await expect(stopAwaitingLineSlipAction("pay_1")).resolves.toBe(false);
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("rejects direct manual confirmation of a voided payment", async () => {
    const formData = new FormData();
    formData.set("payment_id", "pay_1");
    formData.set("reason", "bank checked");
    formData.set("acknowledged", "on");
    mocks.getPaymentById.mockResolvedValue(payment({ status: "VOID" }));
    mocks.listSchedules.mockResolvedValue([schedule({ status: "GENERATED", payment_id: "pay_1" })]);

    await expect(confirmPaymentAction(formData)).rejects.toThrow("Voided payments cannot be manually confirmed");

    expect(mocks.persistPaymentTransition).not.toHaveBeenCalled();
  });
});

describe("existing client billing actions", () => {
  it("assigns an active package schedule and updates the current client summary", async () => {
    mocks.listClients.mockResolvedValue([client({ line_user_id: userId, line_display_name: "Nisa LINE", line_link_status: "LINKED" })]);
    mocks.listPackages.mockResolvedValue([{
      rowNumber: 4,
      package_name: "Extended coaching",
      total_price_thb: "1200",
      payment_type: "INSTALLMENTS",
      installment_count: "2",
      interval_months: "1",
      active: "TRUE",
    }]);
    const formData = new FormData();
    formData.set("package_name", "Extended coaching");
    formData.set("payment_type", "INSTALLMENTS");
    formData.set("total_price_thb", "1800");
    formData.set("installment_count", "3");
    formData.set("interval_months", "2");
    formData.set("first_due_date", "2026-08-31");
    formData.set("notes", "Second program");

    await assignPackageAction("client_1", formData);

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.writeSchedule).toHaveBeenCalledTimes(3);
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(1, expect.objectContaining({
      client_id: "client_1",
      line_user_id: userId,
      package_name: "Extended coaching",
      installment_number: "1",
      installment_count: "3",
      amount_thb: "600",
      due_date: "2026-08-31",
      assignment_id: expect.stringMatching(/^assignment_[a-z0-9]+$/),
      assignment_kind: "PACKAGE",
    }));
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(2, expect.objectContaining({ due_date: "2026-10-31", amount_thb: "600", assignment_kind: "PACKAGE" }));
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(3, expect.objectContaining({ due_date: "2026-12-31", amount_thb: "600" }));
    const packageAssignmentIds = new Set(mocks.writeSchedule.mock.calls.map(([row]) => row.assignment_id));
    expect([...packageAssignmentIds]).toHaveLength(1);
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: "client_1",
      package_name: "Extended coaching",
      payment_type: "INSTALLMENTS",
      total_price_thb: "1800",
      installment_count: "3",
      interval_months: "2",
      first_due_date: "2026-08-31",
      default_amount_thb: "600",
      next_due_date: "2026-08-31",
    }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client_1",
      action: "PACKAGE_ASSIGNED",
      source: "ADMIN",
      metadata: JSON.stringify({ packageName: "Extended coaching", installmentCount: 3, intervalMonths: 2 }),
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/clients/client_1");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/clients/client_1");
  });

  it("normalizes a one-time package assignment even when extra installment values are submitted", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Extended coaching", total_price_thb: "1200", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" }]);
    const formData = new FormData();
    for (const [key, value] of [["package_name", "Extended coaching"], ["payment_type", "ONE_TIME"], ["total_price_thb", "750"], ["installment_count", "9"], ["interval_months", "9"], ["first_due_date", "2026-08-31"], ["notes", ""]]) formData.set(key, value);

    await assignPackageAction("client_1", formData);

    expect(mocks.writeSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ payment_type: "ONE_TIME", installment_count: "1", installment_number: "1", amount_thb: "750" }));
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.objectContaining({ payment_type: "ONE_TIME", total_price_thb: "750", installment_count: "1", interval_months: "0" }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: JSON.stringify({ packageName: "Extended coaching", installmentCount: 1, intervalMonths: 0 }) }));
  });

  it("rejects an installment package assignment without two payments and a monthly interval", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Extended coaching", total_price_thb: "1200", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" }]);
    const formData = new FormData();
    for (const [key, value] of [["package_name", "Extended coaching"], ["payment_type", "INSTALLMENTS"], ["total_price_thb", "750"], ["installment_count", "1"], ["interval_months", "0"], ["first_due_date", "2026-08-31"], ["notes", ""]]) formData.set(key, value);

    await expect(assignPackageAction("client_1", formData)).rejects.toThrow("Installment plans need at least two payments and a one-month interval");

    expect(mocks.writeSchedule).not.toHaveBeenCalled();
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("rejects an inactive package before writing client data", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{
      rowNumber: 4,
      package_name: "Retired package",
      total_price_thb: "1000",
      payment_type: "ONE_TIME",
      installment_count: "1",
      interval_months: "0",
      active: "FALSE",
    }]);
    const formData = new FormData();
    formData.set("package_name", "Retired package");
    formData.set("payment_type", "ONE_TIME");
    formData.set("total_price_thb", "1000");
    formData.set("installment_count", "1");
    formData.set("interval_months", "0");
    formData.set("first_due_date", "2026-08-31");
    formData.set("notes", "");

    await expect(assignPackageAction("client_1", formData)).rejects.toThrow("Choose an active package");

    expect(mocks.writeSchedule).not.toHaveBeenCalled();
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("schedules a recurring manual payment without replacing the current package", async () => {
    mocks.listClients.mockResolvedValue([client({ line_user_id: userId, line_display_name: "Nisa LINE" })]);
    const formData = new FormData();
    for (const [key, value] of [["description", "Nutrition check-in"], ["amount_thb", "1200"], ["frequency", "RECURRING"], ["payment_count", "3"], ["interval_months", "1"], ["first_due_date", "2026-08-15"], ["notes", "Monthly add-on"]]) formData.set(key, value);

    await createManualPaymentAction("client_1", formData);

    expect(mocks.writeSchedule).toHaveBeenCalledTimes(3);
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(1, expect.objectContaining({ package_name: "Nutrition check-in", payment_type: "INSTALLMENTS", installment_count: "3", amount_thb: "400", due_date: "2026-08-15", assignment_id: expect.stringMatching(/^assignment_[a-z0-9]+$/), assignment_kind: "MANUAL" }));
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(3, expect.objectContaining({ installment_number: "3", due_date: "2026-10-15" }));
    const manualAssignmentIds = new Set(mocks.writeSchedule.mock.calls.map(([row]) => row.assignment_id));
    expect([...manualAssignmentIds]).toHaveLength(1);
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client_1",
      action: "MANUAL_PAYMENT_SCHEDULED",
      metadata: JSON.stringify({ description: "Nutrition check-in", paymentCount: 3, intervalMonths: 1, totalSatang: 120000 }),
    }));
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/clients/client_1");
  });

  it("normalizes a one-time manual payment even when extra recurrence values are submitted", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    const formData = new FormData();
    for (const [key, value] of [["description", "Assessment"], ["amount_thb", "750"], ["frequency", "ONE_TIME"], ["payment_count", "9"], ["interval_months", "9"], ["first_due_date", "2026-08-20"], ["notes", ""]]) formData.set(key, value);

    await createManualPaymentAction("client_1", formData);

    expect(mocks.writeSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ payment_type: "ONE_TIME", installment_count: "1", installment_number: "1", amount_thb: "750" }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: JSON.stringify({ description: "Assessment", paymentCount: 1, intervalMonths: 0, totalSatang: 75000 }) }));
  });

  it("changes an active package after voiding its pending generated payment", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([
      { rowNumber: 4, package_name: "PT", total_price_thb: "1000", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" },
      { rowNumber: 5, package_name: "PIF", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0", active: "TRUE" },
    ]);
    mocks.listSchedules.mockResolvedValue([
      schedule({ schedule_id: "paid", status: "PAID", generated_at: "", payment_id: "", payment_url: "" }),
      schedule({ rowNumber: 3, schedule_id: "generated", installment_number: "2", status: "GENERATED", generated_at: now, payment_id: "pay_1", payment_url: "https://pay.test/pay_1" }),
    ]);
    mocks.listPayments.mockResolvedValue([payment()]);

    await changePackageAssignmentAction("client_1", assignmentForm({ package_name: "PIF", first_due_date: "2026-09-01", notes: "Changed" }));

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({
      expectedPayment: payment(),
      payment: expect.objectContaining({ status: "VOID", line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED" }),
    }));
    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalledWith({ updates: expect.arrayContaining([expect.objectContaining({
      expectedSchedule: expect.objectContaining({ schedule_id: "generated", status: "GENERATED", payment_id: "pay_1" }),
      schedule: expect.objectContaining({ schedule_id: "generated", status: "CANCELLED", generated_at: "", payment_id: "", payment_url: "" }),
    })]) });
    expect(mocks.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ assignment_kind: "PACKAGE", amount_thb: "1000", package_name: "PIF", due_date: "2026-09-01", notes: "Changed" }));
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.objectContaining({ package_name: "PIF", total_price_thb: "1500", payment_type: "ONE_TIME", default_amount_thb: "1000" }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PACKAGE_ASSIGNMENT_CHANGED", metadata: expect.stringContaining('"paidSatang":50000') }));
  });

  it("does not create replacement rows when paid credit covers a package downgrade", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Starter", total_price_thb: "400", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([schedule({ schedule_id: "paid-pif", payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", status: "PAID", generated_at: "", payment_id: "", payment_url: "" })]);

    await changePackageAssignmentAction("client_1", assignmentForm({ package_name: "Starter", first_due_date: "2026-09-01", notes: "Downgrade" }));

    expect(mocks.writeSchedule).not.toHaveBeenCalled();
    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalledWith({ updates: [expect.objectContaining({
      expectedSchedule: expect.objectContaining({ schedule_id: "paid-pif", status: "PAID" }),
      schedule: expect.objectContaining({ schedule_id: "paid-pif", status: "PAID", lifecycle_operation_id: expect.stringMatching(/^change_/) }),
    })] });
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.objectContaining({ package_name: "Starter", default_amount_thb: "0", next_due_date: "" }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PACKAGE_ASSIGNMENT_CHANGED", metadata: expect.stringContaining('"excessCreditSatang":10000') }));
  });

  it("changes a completed one-row PIF assignment and schedules only its upgrade difference", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([schedule({ schedule_id: "paid-pif", payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", status: "PAID", generated_at: "", payment_id: "", payment_url: "" })]);

    await changePackageAssignmentAction("client_1", assignmentForm({ package_name: "Premium", first_due_date: "2026-09-01", notes: "Upgrade" }));

    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalled();
    expect(mocks.writeSchedule).toHaveBeenCalledOnce();
    expect(mocks.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ package_name: "Premium", payment_type: "ONE_TIME", amount_thb: "1000", assignment_id: expect.stringMatching(/^assignment_change_/), lifecycle_operation_id: "" }));
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.objectContaining({ package_name: "Premium", default_amount_thb: "1000" }));
  });

  it("fails closed on an invalid paid amount before any package change write", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([schedule({ schedule_id: "paid-pif", payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", status: "PAID", amount_thb: "0", generated_at: "", payment_id: "", payment_url: "" })]);

    await expect(changePackageAssignmentAction("client_1", assignmentForm({ package_name: "Premium", first_due_date: "2026-09-01", notes: "Upgrade" }))).rejects.toThrow("Paid schedule paid-pif has an invalid amount");

    expect(mocks.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.updateSchedulesIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.writeSchedule).not.toHaveBeenCalled();
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("retries detachment after its payment was already successfully voided", async () => {
    const generated = schedule({ status: "GENERATED", generated_at: now, payment_id: "pay_1", payment_url: "https://pay.test/pay_1" });
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([generated]);
    mocks.listPayments
      .mockResolvedValueOnce([payment()])
      .mockResolvedValueOnce([payment({ status: "VOID", line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED" })]);
    mocks.updateSchedulesIfUnchanged
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(pausePackageAssignmentAction("client_1", assignmentForm())).rejects.toThrow("Schedule changed before package lifecycle update");
    await expect(pausePackageAssignmentAction("client_1", assignmentForm())).resolves.toBeUndefined();

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledOnce();
    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalledTimes(2);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PACKAGE_ASSIGNMENT_PAUSED" }));
  });

  it("does not revoke a generated payment while its due-message delivery is in progress", async () => {
    const generated = schedule({ status: "GENERATED", generated_at: now, payment_id: "pay_1", payment_url: "https://pay.test/pay_1" });
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([generated]);
    mocks.listPayments.mockResolvedValue([payment({ line_message_status: "SENDING" })]);

    await expect(pausePackageAssignmentAction("client_1", assignmentForm())).rejects.toThrow("Payment pay_1 is being delivered");

    expect(mocks.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.updateSchedulesIfUnchanged).not.toHaveBeenCalled();
  });

  it("does not revoke a generated payment while its installment reminder is in progress", async () => {
    const generated = schedule({ status: "GENERATED", generated_at: now, payment_id: "pay_1", payment_url: "https://pay.test/pay_1" });
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([generated]);
    mocks.listPayments.mockResolvedValue([payment({ line_reminder_delivery_log: JSON.stringify({ version: 1, deliveries: { T_MINUS_7_DAYS: { status: "SENDING" } } }) })]);

    await expect(pausePackageAssignmentAction("client_1", assignmentForm())).rejects.toThrow("Payment pay_1 is being delivered");

    expect(mocks.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.updateSchedulesIfUnchanged).not.toHaveBeenCalled();
  });

  it("fails closed when a generated payment has malformed reminder delivery state", async () => {
    const generated = schedule({ status: "GENERATED", generated_at: now, payment_id: "pay_1", payment_url: "https://pay.test/pay_1" });
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([generated]);
    mocks.listPayments.mockResolvedValue([payment({ line_reminder_delivery_log: "not-json" })]);

    await expect(pausePackageAssignmentAction("client_1", assignmentForm())).rejects.toThrow("Payment pay_1 is being delivered");

    expect(mocks.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.updateSchedulesIfUnchanged).not.toHaveBeenCalled();
  });

  it("allows only one concurrent package change to claim and create a replacement", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "ONE_TIME", installment_count: "1", interval_months: "0", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([schedule({ payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", amount_thb: "500" })]);
    mocks.updateSchedulesIfUnchanged.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const form = () => assignmentForm({ package_name: "Premium", first_due_date: "2026-09-01", notes: "Upgrade" });

    const results = await Promise.allSettled([
      changePackageAssignmentAction("client_1", form()),
      changePackageAssignmentAction("client_1", form()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(mocks.writeSchedule).toHaveBeenCalledOnce();
  });

  it("reuses deterministic replacement rows after one partial write failure", async () => {
    const old = schedule({ payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", amount_thb: "500" });
    const stored: ScheduleRecord[] = [old];
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" }]);
    mocks.listSchedules.mockImplementation(async () => stored);
    mocks.updateSchedulesIfUnchanged.mockImplementation(async ({ updates }: { updates: Array<{ schedule: ScheduleRecord }> }) => {
      for (const update of updates) {
        const index = stored.findIndex((item) => item.schedule_id === update.schedule.schedule_id);
        stored[index] = update.schedule;
      }
      return true;
    });
    let writeAttempt = 0;
    mocks.writeSchedule.mockImplementation(async (row: ScheduleRecord) => {
      writeAttempt += 1;
      if (writeAttempt === 2) throw new Error("injected replacement write failure");
      stored.push({ ...row, rowNumber: stored.length + 2 });
    });
    const form = () => assignmentForm({ package_name: "Premium", first_due_date: "2026-09-01", notes: "Upgrade" });

    await expect(changePackageAssignmentAction("client_1", form())).rejects.toThrow("injected replacement write failure");
    await expect(changePackageAssignmentAction("client_1", form())).resolves.toBeUndefined();

    const replacements = stored.filter((item) => item.assignment_id.startsWith("assignment_change_"));
    expect(replacements).toHaveLength(2);
    expect(new Set(replacements.map((item) => item.schedule_id)).size).toBe(2);
    expect(mocks.writeSchedule).toHaveBeenCalledTimes(3);
    expect(mocks.writeSchedule.mock.calls[1]?.[0].schedule_id).toBe(mocks.writeSchedule.mock.calls[2]?.[0].schedule_id);
  });

  it("lets only one concurrent retry append replacement rows after a partial change", async () => {
    const old = schedule({ payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", amount_thb: "500" });
    const stored: ScheduleRecord[] = [old];
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" }]);
    mocks.listSchedules.mockImplementation(async () => stored);
    mocks.updateSchedulesIfUnchanged.mockImplementation(async ({ updates }: { updates: Array<{ schedule: ScheduleRecord }> }) => {
      for (const update of updates) {
        const index = stored.findIndex((item) => item.schedule_id === update.schedule.schedule_id);
        stored[index] = update.schedule;
      }
      return true;
    });
    let writeAttempt = 0;
    mocks.writeSchedule.mockImplementation(async (row: ScheduleRecord) => {
      writeAttempt += 1;
      if (writeAttempt === 2) throw new Error("injected replacement write failure");
      stored.push({ ...row, rowNumber: stored.length + 2 });
    });
    const form = () => assignmentForm({ package_name: "Premium", first_due_date: "2026-09-01", notes: "Upgrade" });

    await expect(changePackageAssignmentAction("client_1", form())).rejects.toThrow("injected replacement write failure");

    let releaseFirstRetryWrite: (() => void) | undefined;
    let retryWriteCalls = 0;
    const firstRetryWriteStarted = new Promise<void>((resolve) => {
      mocks.writeSchedule.mockImplementation(async (row: ScheduleRecord) => {
        retryWriteCalls += 1;
        if (retryWriteCalls === 1) {
          resolve();
          await new Promise<void>((release) => { releaseFirstRetryWrite = release; });
        }
        stored.push({ ...row, rowNumber: stored.length + 2 });
      });
    });

    const firstRetry = changePackageAssignmentAction("client_1", form());
    await firstRetryWriteStarted;
    const secondRetry = changePackageAssignmentAction("client_1", form());

    await expect(secondRetry).rejects.toThrow("Replacement schedule write is already in progress");
    releaseFirstRetryWrite?.();
    await expect(firstRetry).resolves.toBeUndefined();

    const replacements = stored.filter((item) => item.assignment_id.startsWith("assignment_change_"));
    expect(replacements).toHaveLength(2);
    expect(new Set(replacements.map((item) => item.schedule_id)).size).toBe(2);
  });

  it("reclaims an expired replacement-write lease after an interrupted change", async () => {
    const operationId = "change_8c32190c684c0b8aa144bc49c2cf6c71";
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([schedule({
      status: "CANCELLED",
      lifecycle_operation_id: `${operationId}:REPLACEMENT_WRITING:2000-01-01T00:00:00.000Z`,
    })]);

    await expect(changePackageAssignmentAction("client_1", assignmentForm({ package_name: "Premium", first_due_date: "2026-09-01", notes: "Upgrade" }))).resolves.toBeUndefined();

    expect(mocks.writeSchedule).toHaveBeenCalledTimes(2);
  });

  it("blocks concurrent retries while every source row shares a replacement-write lease", async () => {
    const operationId = "change_8c32190c684c0b8aa144bc49c2cf6c71";
    const lease = `${operationId}:REPLACEMENT_WRITING:2999-01-01T00:00:00.000Z`;
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "INSTALLMENTS", installment_count: "2", interval_months: "1", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([
      schedule({ status: "CANCELLED", lifecycle_operation_id: lease }),
      schedule({ rowNumber: 3, schedule_id: "schedule_2", installment_number: "2", status: "CANCELLED", lifecycle_operation_id: lease }),
    ]);

    await expect(changePackageAssignmentAction("client_1", assignmentForm({ package_name: "Premium", first_due_date: "2026-09-01", notes: "Upgrade" }))).rejects.toThrow("Replacement schedule write is already in progress");

    expect(mocks.writeSchedule).not.toHaveBeenCalled();
  });

  it("pauses, resumes, and ends only outstanding package rows", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([
      schedule({ schedule_id: "paid", status: "PAID", generated_at: "", payment_id: "", payment_url: "" }),
      schedule({ rowNumber: 3, schedule_id: "open", installment_number: "2" }),
    ]);

    await pausePackageAssignmentAction("client_1", assignmentForm());
    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalledWith({ updates: expect.arrayContaining([
      expect.objectContaining({ expectedSchedule: expect.objectContaining({ schedule_id: "paid" }), schedule: expect.objectContaining({ schedule_id: "paid", status: "PAID" }) }),
      expect.objectContaining({ expectedSchedule: expect.objectContaining({ schedule_id: "open" }), schedule: expect.objectContaining({ schedule_id: "open", status: "PAUSED" }) }),
    ]) });

    mocks.updateSchedulesIfUnchanged.mockClear();
    mocks.listSchedules.mockResolvedValue([
      schedule({ schedule_id: "paid", status: "PAID", generated_at: "", payment_id: "", payment_url: "" }),
      schedule({ rowNumber: 3, schedule_id: "open", installment_number: "2", status: "PAUSED" }),
    ]);
    await resumePackageAssignmentAction("client_1", assignmentForm());
    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalledWith({ updates: expect.arrayContaining([expect.objectContaining({ schedule: expect.objectContaining({ schedule_id: "open", status: "SCHEDULED" }) })]) });

    mocks.updateSchedulesIfUnchanged.mockClear();
    mocks.listSchedules.mockResolvedValue([
      schedule({ schedule_id: "paid", status: "PAID", generated_at: "", payment_id: "", payment_url: "" }),
      schedule({ rowNumber: 3, schedule_id: "open", installment_number: "2" }),
    ]);
    await endPackageAssignmentAction("client_1", assignmentForm());
    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalledWith({ updates: expect.arrayContaining([expect.objectContaining({ schedule: expect.objectContaining({ schedule_id: "open", status: "CANCELLED" }) })]) });
  });

  it("rejects deleting an assignment with paid history but deletes unpaid rows", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([
      schedule({ schedule_id: "paid", status: "PAID", generated_at: "", payment_id: "", payment_url: "" }),
      schedule({ rowNumber: 3, schedule_id: "open", installment_number: "2" }),
    ]);

    await expect(deletePackageAssignmentAction("client_1", assignmentForm())).rejects.toThrow("cannot be deleted after a payment");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();

    mocks.listSchedules.mockResolvedValue([schedule({ status: "SCHEDULED" })]);
    await deletePackageAssignmentAction("client_1", assignmentForm());
    expect(mocks.updateSchedulesIfUnchanged).toHaveBeenCalledWith({ updates: [expect.objectContaining({ schedule: expect.objectContaining({ status: "DELETED" }) })] });
  });

  it("rejects deleting an assignment with paid history even when its paid amount is invalid", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([
      schedule({ schedule_id: "paid", status: "PAID", amount_thb: "not-an-amount", generated_at: "", payment_id: "", payment_url: "" }),
      schedule({ rowNumber: 3, schedule_id: "open", installment_number: "2" }),
    ]);

    await expect(deletePackageAssignmentAction("client_1", assignmentForm())).rejects.toThrow("cannot be deleted after a payment");

    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(mocks.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("blocks lifecycle writes when generated payment is under review", async () => {
    mocks.listClients.mockResolvedValue([client()]);
    mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
    mocks.listSchedules.mockResolvedValue([schedule({ status: "GENERATED", generated_at: now, payment_id: "pay_1", payment_url: "https://pay.test/pay_1" })]);
    mocks.listPayments.mockResolvedValue([payment({ status: "REVIEW" })]);

    await expect(pausePackageAssignmentAction("client_1", assignmentForm())).rejects.toThrow("cannot be changed while payment pay_1 is REVIEW");
    expect(mocks.updatePaymentIfUnchanged).not.toHaveBeenCalled();
    expect(mocks.updateSchedulesIfUnchanged).not.toHaveBeenCalled();
  });

  it("toggles an existing package without accepting editable package details", async () => {
    const packageRecord = { rowNumber: 4, package_name: "Premium", total_price_thb: "1500", payment_type: "INSTALLMENTS", installment_count: "3", interval_months: "1", active: "TRUE" };
    mocks.listPackages.mockResolvedValue([packageRecord]);
    const formData = new FormData();
    formData.set("package_row", "4");
    formData.set("active", "FALSE");

    await togglePackageActiveAction(formData);

    expect(mocks.savePackage).toHaveBeenCalledWith({ ...packageRecord, active: "FALSE" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/packages");
  });
});

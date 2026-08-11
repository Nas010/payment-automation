import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  headers: vi.fn(),
  listClients: vi.fn(),
  writeClient: vi.fn(),
  updateClient: vi.fn(),
  updateLineLinkClient: vi.fn(),
  appendAudit: vi.fn(),
  listPackages: vi.fn(),
  writeSchedule: vi.fn(),
  generateDuePaymentLinks: vi.fn(),
  getPaymentById: vi.fn(),
  listSchedules: vi.fn(),
  persistPaymentTransition: vi.fn(),
  sendDueLinePaymentRequests: vi.fn(),
  updatePaymentIfUnchanged: vi.fn(),
  savePackage: vi.fn(),
  upsertOperationalSetting: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/config", () => ({ paymentLinkBaseUrl: vi.fn(() => "https://example.test") }));
vi.mock("@/lib/payments/generate", () => ({ generateDuePaymentLinks: mocks.generateDuePaymentLinks }));
vi.mock("@/lib/payments/transition", () => ({ persistPaymentTransition: mocks.persistPaymentTransition }));
vi.mock("@/lib/line/due-payments", () => ({ sendDueLinePaymentRequests: mocks.sendDueLinePaymentRequests }));
vi.mock("@/lib/sheets/clients", () => ({ listClients: mocks.listClients, writeClient: mocks.writeClient, updateClient: mocks.updateClient, updateLineLinkClient: mocks.updateLineLinkClient }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit, getPaymentById: mocks.getPaymentById, updatePaymentIfUnchanged: mocks.updatePaymentIfUnchanged }));
vi.mock("@/lib/sheets/schedules", () => ({ listSchedules: mocks.listSchedules, writeSchedule: mocks.writeSchedule }));
vi.mock("@/lib/sheets/settings", () => ({ listPackages: mocks.listPackages, savePackage: mocks.savePackage, upsertOperationalSetting: mocks.upsertOperationalSetting }));

import { assignPackageAction, createClientAction, createManualPaymentAction, disconnectLineAction, generateMissingLineLinkCodesAction, renewLineLinkCodeAction, saveOperationalSettingAction, sendLinePaymentAction, stopAwaitingLineSlipAction } from "./actions";

const now = "2026-08-10T12:00:00.000Z";
const userId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "PT", payment_type: "ONE_TIME", total_price_thb: "1000", installment_count: "1", interval_months: "0", first_due_date: "2026-08-10", default_amount_thb: "1000", billing_frequency: "MANUAL", next_due_date: "2026-08-10", notes: "", created_at: now, updated_at: now,
    line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.headers.mockResolvedValue(new Headers({ origin: "https://example.test" }));
  mocks.listClients.mockResolvedValue([]);
  mocks.writeClient.mockResolvedValue(undefined);
  mocks.updateClient.mockResolvedValue(undefined);
  mocks.updateLineLinkClient.mockResolvedValue(true);
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.listPackages.mockResolvedValue([{ package_name: "PT", active: "TRUE" }]);
  mocks.writeSchedule.mockResolvedValue(undefined);
  mocks.getPaymentById.mockResolvedValue(payment());
  mocks.updatePaymentIfUnchanged.mockResolvedValue(true);
  mocks.sendDueLinePaymentRequests.mockResolvedValue({ accepted: ["pay_1"], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });
});

describe("protected LINE trainer actions", () => {
  it("creates a client with a blank mapping and a seven-day active code instruction", async () => {
    await createClientAction(clientForm());

    const saved = mocks.writeClient.mock.calls[0]?.[0] as Record<string, string>;
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ line_user_id: "", line_display_name: "", line_link_status: "CODE_ACTIVE", line_linked_at: "", line_link_error: "" });
    expect(saved.line_link_code).toMatch(/^[A-F0-9]{10}$/);
    expect(saved.line_link_message).toBe(`Hi Nisa, reply with this exact message to link your LINE account:\nLINK ${saved.line_link_code}`);
    expect(new Date(saved.line_link_code_expires_at).getTime() - new Date(saved.created_at).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(mocks.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ line_user_id: "", line_display_name: "" }));
  });

  it("returns bulk created, active, linked, and failed reports after admin authorization", async () => {
    mocks.listClients.mockResolvedValue([
      client({ client_id: "created" }),
      client({ rowNumber: 3, client_id: "active", line_link_code: "ABCDEF0123", line_link_code_expires_at: "2099-08-17T12:00:00.000Z", line_link_status: "CODE_ACTIVE" }),
      client({ rowNumber: 4, client_id: "linked", line_user_id: userId, line_link_status: "LINKED" }),
      client({ rowNumber: 5, client_id: "failed", client_name: "Broken" }),
    ]);
    mocks.updateLineLinkClient.mockImplementation(async ({ client: updated }: { client: ClientRecord }) => { if (updated.client_id === "failed") throw new Error("sheet unavailable"); return true; });

    await expect(generateMissingLineLinkCodesAction()).resolves.toMatchObject({ created: ["created"], alreadyActive: ["active"], alreadyLinked: ["linked"], failed: [{ clientId: "failed", error: "sheet unavailable" }] });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/clients");
  });

  it("renews only an unlinked selected client code and revalidates its detail", async () => {
    mocks.listClients.mockResolvedValue([client({ line_link_code: "ABCDEF0123", line_link_code_expires_at: "2099-08-17T12:00:00.000Z", line_link_status: "CODE_ACTIVE" })]);

    const result = await renewLineLinkCodeAction("client_1");

    expect(result).toMatchObject({ clientId: "client_1", status: "CODE_ACTIVE" });
    expect(result?.code).toMatch(/^[A-F0-9]{10}$/);
    expect(result?.code).not.toBe("ABCDEF0123");
    expect(mocks.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_user_id: "", line_link_status: "CODE_ACTIVE" }) }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/clients/client_1");
  });

  it("rejects renewal for a client that already has a different LINE user ID", async () => {
    mocks.listClients.mockResolvedValue([client({ line_user_id: userId, line_display_name: "Nisa LINE", line_link_code: "ABCDEF0123", line_link_status: "LINKED" })]);

    await expect(renewLineLinkCodeAction("client_1")).resolves.toBeNull();

    expect(mocks.updateLineLinkClient).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("disconnects an existing mapping, clears link fields, and preserves its audit event", async () => {
    mocks.listClients.mockResolvedValue([client({ line_user_id: userId, line_display_name: "Nisa LINE", line_link_status: "LINKED", line_linked_at: now })]);

    await expect(disconnectLineAction("client_1")).resolves.toBe(true);

    expect(mocks.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ line_user_id: "", line_display_name: "", line_link_code: "", line_link_code_expires_at: "", line_link_status: "", line_linked_at: "", line_link_message: "", line_link_error: "" }) }));
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
});

describe("protected operational setting actions", () => {
  it("rejects the LINE due template key from the generic settings writer", async () => {
    const formData = new FormData();
    formData.set("key", "line_due_message_template");
    formData.set("value", "invalid template without required placeholders");

    await expect(saveOperationalSettingAction(formData)).rejects.toThrow(/dedicated LINE due-message controls/i);
    expect(mocks.upsertOperationalSetting).not.toHaveBeenCalled();
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
    formData.set("first_due_date", "2026-08-31");
    formData.set("notes", "Second program");

    await assignPackageAction("client_1", formData);

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.writeSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(1, expect.objectContaining({
      client_id: "client_1",
      line_user_id: userId,
      package_name: "Extended coaching",
      installment_number: "1",
      installment_count: "2",
      amount_thb: "600",
      due_date: "2026-08-31",
    }));
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(2, expect.objectContaining({ due_date: "2026-09-30", amount_thb: "600" }));
    expect(mocks.updateClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: "client_1",
      package_name: "Extended coaching",
      payment_type: "INSTALLMENTS",
      total_price_thb: "1200",
      installment_count: "2",
      interval_months: "1",
      first_due_date: "2026-08-31",
      default_amount_thb: "600",
      next_due_date: "2026-08-31",
    }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client_1",
      action: "PACKAGE_ASSIGNED",
      source: "ADMIN",
      metadata: JSON.stringify({ packageName: "Extended coaching", installmentCount: 2, intervalMonths: 1 }),
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/clients/client_1");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/clients/client_1");
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
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(1, expect.objectContaining({ package_name: "Nutrition check-in", payment_type: "INSTALLMENTS", installment_count: "3", amount_thb: "400", due_date: "2026-08-15" }));
    expect(mocks.writeSchedule).toHaveBeenNthCalledWith(3, expect.objectContaining({ installment_number: "3", due_date: "2026-10-15" }));
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
});

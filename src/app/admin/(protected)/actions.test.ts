import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";

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
vi.mock("@/lib/sheets/clients", () => ({ listClients: mocks.listClients, writeClient: mocks.writeClient, updateClient: mocks.updateClient, updateLineLinkClient: mocks.updateLineLinkClient }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit, getPaymentById: mocks.getPaymentById }));
vi.mock("@/lib/sheets/schedules", () => ({ listSchedules: mocks.listSchedules, writeSchedule: mocks.writeSchedule }));
vi.mock("@/lib/sheets/settings", () => ({ listPackages: mocks.listPackages, savePackage: mocks.savePackage, upsertOperationalSetting: mocks.upsertOperationalSetting }));

import { createClientAction, disconnectLineAction, generateMissingLineLinkCodesAction, renewLineLinkCodeAction } from "./actions";

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

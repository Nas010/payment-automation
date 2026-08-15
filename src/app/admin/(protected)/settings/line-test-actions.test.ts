import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultLineMessageTestProfile } from "@/lib/line/message-test-profile";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), revalidatePath: vi.fn(), runtimeConfig: vi.fn(),
  getProfile: vi.fn(), saveProfile: vi.fn(), issue: vi.fn(), disconnect: vi.fn(),
  preview: vi.fn(), send: vi.fn(), recover: vi.fn(), buildUrl: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/sheets/line-message-test-profile", () => ({
  getLineMessageTestProfile: mocks.getProfile,
  saveLineMessageTestProfile: mocks.saveProfile,
  updateLineMessageTestProfileIfUnchanged: vi.fn(), claimLineMessageTestConnection: vi.fn(), disconnectLineMessageTestConnection: vi.fn(),
}));
vi.mock("@/lib/line/message-test-connection", () => ({ createLineMessageTestConnectionService: () => ({ issue: mocks.issue, disconnect: mocks.disconnect }) }));
vi.mock("@/lib/line/message-test-delivery", () => ({ previewLineMessageTest: mocks.preview, sendLineMessageTest: mocks.send }));
vi.mock("@/lib/line/connection-token", () => ({ recoverLineConnectionToken: mocks.recover, buildLineConnectUrl: mocks.buildUrl }));
vi.mock("@/lib/sheets/clients", () => ({ listClients: vi.fn() }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: vi.fn() }));

import {
  disconnectLineMessageTestConnectionAction,
  previewLineMessageTestAction,
  renewLineMessageTestConnectionAction,
  saveLineMessageTestProfileAction,
  sendLineMessageTestAction,
} from "./line-test-actions";

const linked = {
  ...createDefaultLineMessageTestProfile("2026-08-15"),
  lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  lineDisplayName: "Test Account",
  lineLinkStatus: "LINKED" as const,
  lineLinkedAt: "2026-08-15T00:00:00.000Z",
};

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values = {
    client_name: "Sample Client", package_name: "Sample Package", total_price_thb: "4500",
    payment_type: "INSTALLMENTS", installment_count: "3", interval_months: "1", first_due_date: "2026-08-15",
    scenario_payment_type: "INSTALLMENTS", scenario_stage: "LATER", installment_number: "2", reminder_slot: "T_MINUS_3_DAYS",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({});
  mocks.getProfile.mockResolvedValue(linked);
  mocks.runtimeConfig.mockResolvedValue({ publicBaseUrl: "https://pay.example", lineLiffId: "1234567890-Test" });
  mocks.preview.mockResolvedValue({ text: "Rendered preview", messages: [] });
  mocks.send.mockResolvedValue({ outcome: "ACCEPTED", requestCode: "request_1" });
  mocks.issue.mockResolvedValue({ ...linked, lineLinkStatus: "LINK_ACTIVE", lineLinkTokenEncrypted: "encrypted" });
  mocks.disconnect.mockResolvedValue(true);
  mocks.recover.mockReturnValue("A".repeat(43));
  mocks.buildUrl.mockReturnValue("https://liff.line.me/1234567890-Test?token=safe");
});

describe("LINE message test actions", () => {
  it("saves only editable client details while preserving linked identity", async () => {
    const submitted = form({ line_user_id: "Uforged", line_link_status: "REVIEW" });
    const result = await saveLineMessageTestProfileAction(submitted);

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ clientName: "Sample Client", lineUserId: linked.lineUserId, lineLinkStatus: "LINKED" }));
    expect(result).toMatchObject({ ok: true, profile: { clientName: "Sample Client", lineDisplayName: "Test Account" } });
    expect(JSON.stringify(result)).not.toContain(linked.lineUserId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("renews through the dedicated service and returns only a complete LIFF URL", async () => {
    const result = await renewLineMessageTestConnectionAction();
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.issue).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, connectUrl: "https://liff.line.me/1234567890-Test?token=safe" });
    expect(JSON.stringify(result)).not.toContain("encrypted");
  });

  it("previews current form details without sending or mutating", async () => {
    const result = await previewLineMessageTestAction(form());
    expect(result).toMatchObject({ ok: true, preview: "Rendered preview" });
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://pay.example", profile: expect.objectContaining({ clientName: "Sample Client", lineUserId: linked.lineUserId }) }));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends current validated details and returns a client-safe outcome", async () => {
    const result = await sendLineMessageTestAction(form());
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ scenario: { paymentType: "INSTALLMENTS", stage: "LATER", installmentNumber: 2, reminderSlot: "T_MINUS_3_DAYS" } }));
    expect(result).toMatchObject({ ok: true, outcome: "ACCEPTED", requestCode: "request_1" });
    expect(JSON.stringify(result)).not.toContain(linked.lineUserId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("disconnects only the test profile", async () => {
    await expect(disconnectLineMessageTestConnectionAction()).resolves.toMatchObject({ ok: true, profile: { lineLinkStatus: "" } });
    expect(mocks.disconnect).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });
});

import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cronSecret: vi.fn(),
  runtimeConfig: vi.fn(),
  getInstallation: vi.fn(),
  generateDuePaymentLinks: vi.fn(),
  reconcileManualConfirmations: vi.fn(),
  sendDueLinePaymentRequests: vi.fn(),
  sendInstallmentReminderRequests: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ cronSecret: mocks.cronSecret }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/installation/repository", () => ({ getInstallation: mocks.getInstallation }));
vi.mock("@/lib/payments/generate", () => ({ generateDuePaymentLinks: mocks.generateDuePaymentLinks }));
vi.mock("@/lib/sheets/payments", () => ({ reconcileManualConfirmations: mocks.reconcileManualConfirmations }));
vi.mock("@/lib/line/due-payments", () => ({ sendDueLinePaymentRequests: mocks.sendDueLinePaymentRequests }));
vi.mock("@/lib/line/installment-reminders", () => ({ sendInstallmentReminderRequests: mocks.sendInstallmentReminderRequests }));

import { GET } from "./route";

function request(authorized = true): NextRequest {
  return new NextRequest("https://pay.example/api/cron/generate", { headers: authorized ? { authorization: "Bearer cron-secret" } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cronSecret.mockReturnValue("cron-secret");
  mocks.runtimeConfig.mockResolvedValue({ publicBaseUrl: "https://pay.example" });
  mocks.getInstallation.mockResolvedValue({ setupStatus: "COMPLETE" });
  mocks.generateDuePaymentLinks.mockResolvedValue({ created: [{ payment_id: "pay_1" }], existing: [], failed: [] });
  mocks.reconcileManualConfirmations.mockResolvedValue(1);
  mocks.sendDueLinePaymentRequests.mockResolvedValue({ accepted: ["pay_1"], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false });
  mocks.sendInstallmentReminderRequests.mockResolvedValue([]);
});

describe("GET /api/cron/generate", () => {
  it("schedules the daily payment job at 02:05 UTC", () => {
    const deployment = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };

    expect(deployment.crons).toContainEqual({ path: "/api/cron/generate", schedule: "5 2 * * *" });
  });

  it("rejects unauthorized calls before all generation, reconciliation, and delivery work", async () => {
    await expect(GET(request(false))).resolves.toMatchObject({ status: 401 });
    expect(mocks.generateDuePaymentLinks).not.toHaveBeenCalled();
    expect(mocks.reconcileManualConfirmations).not.toHaveBeenCalled();
    expect(mocks.sendDueLinePaymentRequests).not.toHaveBeenCalled();
    expect(mocks.sendInstallmentReminderRequests).not.toHaveBeenCalled();
  });

  it("returns 503 without writes while dashboard setup is incomplete", async () => {
    mocks.getInstallation.mockResolvedValue({ setupStatus: "WORKSPACE_CONNECTED" });
    await expect(GET(request())).resolves.toMatchObject({ status: 503 });
    expect(mocks.generateDuePaymentLinks).not.toHaveBeenCalled();
    expect(mocks.reconcileManualConfirmations).not.toHaveBeenCalled();
    expect(mocks.sendDueLinePaymentRequests).not.toHaveBeenCalled();
    expect(mocks.sendInstallmentReminderRequests).not.toHaveBeenCalled();
  });

  it("finishes generation and reconciliation before prioritizing reminder slots over due-payment retries", async () => {
    const completed: string[] = [];
    mocks.generateDuePaymentLinks.mockImplementation(async () => {
      await Promise.resolve();
      completed.push("generate");
      return { created: [], existing: [], failed: [] };
    });
    mocks.reconcileManualConfirmations.mockImplementation(async () => { expect(completed).toEqual(["generate"]); completed.push("reconcile"); return 1; });
    mocks.sendInstallmentReminderRequests.mockImplementation(async () => { expect(completed).toEqual(["generate", "reconcile"]); completed.push("reminders"); return []; });
    mocks.sendDueLinePaymentRequests.mockImplementation(async () => { expect(completed).toEqual(["generate", "reconcile", "reminders"]); completed.push("line"); return { accepted: [], alreadyAccepted: [], skippedMissingUserId: [], failed: [], disabled: false }; });

    const response = await GET(request());

    expect(completed).toEqual(["generate", "reconcile", "reminders", "line"]);
    await expect(response.json()).resolves.toMatchObject({ created: 0, manual_confirmations_reconciled: 1, line: { accepted: [] } });
  });

  it("still sends existing reminder invoices when generation fails", async () => {
    mocks.generateDuePaymentLinks.mockRejectedValue(new Error("private Sheets detail"));
    mocks.sendInstallmentReminderRequests.mockResolvedValue(["pay_existing"]);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ reminders: ["pay_existing"], failed_stages: ["generate"] });
    expect(mocks.sendDueLinePaymentRequests).toHaveBeenCalledOnce();
  });

  it("does not let a reconciliation failure suppress reminders", async () => {
    mocks.reconcileManualConfirmations.mockRejectedValue(new Error("private reconciliation detail"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(mocks.sendInstallmentReminderRequests).toHaveBeenCalledOnce();
    expect(mocks.sendDueLinePaymentRequests).toHaveBeenCalledOnce();
  });

  it("reports a reminder-stage failure without suppressing due-payment delivery or exposing secrets", async () => {
    mocks.sendInstallmentReminderRequests.mockRejectedValue(new Error("private credential detail"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.failed_stages).toEqual(["reminders"]);
    expect(JSON.stringify(body)).not.toContain("private credential detail");
    expect(mocks.sendDueLinePaymentRequests).toHaveBeenCalledOnce();
  });

  it("returns a failed-generation count without exposing generator error details", async () => {
    mocks.generateDuePaymentLinks.mockResolvedValue({ created: [], existing: [], failed: [{ scheduleId: "schedule_1", error: "secret https://private.example/payment" }] });

    const body = await (await GET(request())).json();

    expect(body).toMatchObject({ failed: 1 });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("private.example");
  });
});

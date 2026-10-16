import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cronSecret: vi.fn(), getInstallation: vi.fn(), runtimeConfig: vi.fn(), generateDuePaymentLinks: vi.fn(), sendInstallmentReminderRequests: vi.fn(), appendAudit: vi.fn() }));
vi.mock("@/lib/config", () => ({ cronSecret: mocks.cronSecret }));
vi.mock("@/lib/installation/repository", () => ({ getInstallation: mocks.getInstallation }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/payments/generate", () => ({ generateDuePaymentLinks: mocks.generateDuePaymentLinks }));
vi.mock("@/lib/line/installment-reminders", () => ({ sendInstallmentReminderRequests: mocks.sendInstallmentReminderRequests }));
vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit }));

import { GET } from "./route";

function request(authorized = true): NextRequest {
  return new NextRequest("https://pay.example/api/cron/reminders", { headers: authorized ? { authorization: "Bearer cron-secret" } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cronSecret.mockReturnValue("cron-secret");
  mocks.getInstallation.mockResolvedValue({ setupStatus: "COMPLETE" });
  mocks.runtimeConfig.mockResolvedValue({ lineMessagingEnabled: true, publicBaseUrl: "https://pay.example" });
  mocks.generateDuePaymentLinks.mockResolvedValue({ created: [], existing: [], failed: [] });
  mocks.sendInstallmentReminderRequests.mockResolvedValue(["pay_1"]);
  mocks.appendAudit.mockResolvedValue(undefined);
});

describe("independent installment reminder recovery", () => {
  it("has its own daily recovery job two hours after the primary job", () => {
    const deployment = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(deployment.crons).toContainEqual({ path: "/api/cron/reminders", schedule: "5 4 * * *" });
    expect(deployment.crons).toContainEqual({ path: "/api/cron/generate", schedule: "5 2 * * *" });
  });

  it("rejects unauthorized requests before reads, writes, or messages", async () => {
    expect((await GET(request(false))).status).toBe(401);
    expect(mocks.getInstallation).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
    expect(mocks.generateDuePaymentLinks).not.toHaveBeenCalled();
    expect(mocks.sendInstallmentReminderRequests).not.toHaveBeenCalled();
  });

  it("does no delivery or writes before setup is complete", async () => {
    mocks.getInstallation.mockResolvedValue({ setupStatus: "WORKSPACE_CONNECTED" });
    expect((await GET(request())).status).toBe(503);
    expect(mocks.appendAudit).not.toHaveBeenCalled();
    expect(mocks.generateDuePaymentLinks).not.toHaveBeenCalled();
    expect(mocks.sendInstallmentReminderRequests).not.toHaveBeenCalled();
  });

  it("respects disabled LINE messaging without creating invoices", async () => {
    mocks.runtimeConfig.mockResolvedValue({ lineMessagingEnabled: false });
    await expect((await GET(request())).json()).resolves.toEqual({ disabled: true, reminders: [] });
    expect(mocks.appendAudit).not.toHaveBeenCalled();
    expect(mocks.generateDuePaymentLinks).not.toHaveBeenCalled();
    expect(mocks.sendInstallmentReminderRequests).not.toHaveBeenCalled();
  });

  it("recreates missing reminder-window invoices before sending and records completion", async () => {
    const completed: string[] = [];
    mocks.generateDuePaymentLinks.mockImplementationOnce(async () => { completed.push("generate"); return { created: [{}], existing: [], failed: [] }; });
    mocks.sendInstallmentReminderRequests.mockImplementationOnce(async () => { expect(completed).toEqual(["generate"]); return ["pay_1"]; });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.generateDuePaymentLinks).toHaveBeenCalledWith({ baseUrl: "https://pay.example", remindersOnly: true });
    expect(mocks.sendInstallmentReminderRequests).toHaveBeenCalledWith({ baseUrl: "https://pay.example", slots: ["T_MINUS_7_DAYS"] });
    await expect(response.json()).resolves.toMatchObject({ created: 1, reminders: ["pay_1"], failed_stages: [] });
    expect(mocks.appendAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "LINE_REMINDER_JOB_COMPLETED", newStatus: "COMPLETED", metadata: JSON.stringify({ created: 1, accepted: 1, failedStages: [] }) }));
  });

  it("still processes existing reminders when invoice generation fails", async () => {
    mocks.generateDuePaymentLinks.mockRejectedValueOnce(new Error("private upstream detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(mocks.sendInstallmentReminderRequests).toHaveBeenCalledWith({ baseUrl: "https://pay.example", slots: ["T_MINUS_7_DAYS"] });
    await expect(response.json()).resolves.toMatchObject({ reminders: ["pay_1"], failed_stages: ["generate"] });
  });

  it("reports generation row failures and reminder failures without exposing vendor errors", async () => {
    mocks.generateDuePaymentLinks.mockResolvedValueOnce({ created: [], existing: [], failed: [{ error: "private sheet" }] });
    mocks.sendInstallmentReminderRequests.mockRejectedValueOnce(new Error("private LINE detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ created: 0, reminders: [], failed_stages: ["generate", "reminders"] });
    expect(JSON.stringify(mocks.appendAudit.mock.calls)).not.toContain("private");
  });

  it("does not let an unavailable audit ledger suppress the recovery job", async () => {
    mocks.appendAudit.mockRejectedValue(new Error("private ledger detail"));
    expect((await GET(request())).status).toBe(200);
    expect(mocks.sendInstallmentReminderRequests).toHaveBeenCalledOnce();
  });
});

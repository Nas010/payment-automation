import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";

const mocks = vi.hoisted(() => ({
  appendAudit: vi.fn(),
  updatePaymentIfUnchanged: vi.fn(),
  updateSchedule: vi.fn(),
  hasPaymentTransitionAudit: vi.fn(),
}));

vi.mock("@/lib/sheets/payments", () => ({ appendAudit: mocks.appendAudit, updatePaymentIfUnchanged: mocks.updatePaymentIfUnchanged }));
vi.mock("@/lib/sheets/schedules", () => ({ updateSchedule: mocks.updateSchedule }));
vi.mock("@/lib/sheets/audit", () => ({ hasPaymentTransitionAudit: mocks.hasPaymentTransitionAudit }));

import { persistPaymentTransition, reconcileTerminalPaymentEffects, transitionPayment } from "./transition";

const reconcileTerminalEffects = reconcileTerminalPaymentEffects as unknown as (input: { payment: PaymentRecord; schedule: ScheduleRecord; now?: string }) => Promise<boolean>;

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { payment_id: "pay_1", client_id: "client_1", status: "REVIEW", line_slip_expected: "TRUE", updated_at: "old", manual_confirmed_at: "", recorded_at: "", ...overrides } as PaymentRecord;
}

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return { schedule_id: "schedule_1", payment_id: "pay_1", status: "GENERATED", ...overrides } as ScheduleRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updatePaymentIfUnchanged.mockResolvedValue(true);
  mocks.updateSchedule.mockResolvedValue(undefined);
  mocks.appendAudit.mockResolvedValue(undefined);
  mocks.hasPaymentTransitionAudit.mockResolvedValue(false);
});

describe("transitionPayment", () => {
  it("marks linked schedule paid when a review payment is manually confirmed", () => {
    const result = transitionPayment({ paymentStatus: "REVIEW", scheduleStatus: "GENERATED", nextStatus: "MANUAL_CONFIRMED" });

    expect(result).toEqual({ paymentStatus: "MANUAL_CONFIRMED", scheduleStatus: "PAID" });
  });

  it("rejects a manual attempt to assign the system-only automatic status", () => {
    expect(() => transitionPayment({ paymentStatus: "REVIEW", scheduleStatus: "GENERATED", nextStatus: "AUTO_RECORDED", source: "ADMIN" })).toThrow("AUTO_RECORDED is system-only");
  });

  it("allows a LINE webhook to assign automatic status", () => {
    expect(transitionPayment({ paymentStatus: "PENDING", scheduleStatus: "GENERATED", nextStatus: "AUTO_RECORDED", source: "LINE_WEBHOOK" })).toEqual({ paymentStatus: "AUTO_RECORDED", scheduleStatus: "PAID" });
  });

  it("clears a pending LINE slip expectation when an admin manually confirms payment", async () => {
    await persistPaymentTransition({ payment: payment(), schedule: schedule(), nextStatus: "MANUAL_CONFIRMED", source: "ADMIN", reason: "bank checked", now: "2026-08-10T12:00:00.000Z" });

    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ expectedPayment: payment(), payment: expect.objectContaining({ status: "MANUAL_CONFIRMED", line_slip_expected: "FALSE" }) }));
  });

  it("aborts a transition when shared payment CAS loses", async () => {
    mocks.updatePaymentIfUnchanged.mockResolvedValue(false);

    await expect(persistPaymentTransition({ payment: payment(), schedule: schedule(), nextStatus: "MANUAL_CONFIRMED", source: "ADMIN", reason: "bank checked" })).rejects.toThrow("Payment changed before transition");
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("leaves a durable terminal-effects marker when schedule persistence fails after payment CAS", async () => {
    mocks.updateSchedule.mockRejectedValueOnce(new Error("schedule unavailable"));

    await expect(persistPaymentTransition({ payment: payment({ status: "PENDING" }), schedule: schedule(), nextStatus: "AUTO_RECORDED", source: "LINE_WEBHOOK", reason: "slip", now: "2026-08-10T12:00:00.000Z" })).rejects.toThrow("schedule unavailable");
    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ status: "AUTO_RECORDED", line_slip_error: "TRANSITION_EFFECTS_PENDING:LINE_WEBHOOK:PENDING" }) }));
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("reconciles a terminal payment's missing schedule and one deterministic audit without changing terminal status", async () => {
    const recorded = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_slip_error: "TRANSITION_EFFECTS_PENDING:LINE_WEBHOOK:PENDING" });
    const paidSchedule = schedule({ status: "PAID" });

    await reconcileTerminalEffects({ payment: recorded, schedule: paidSchedule, now: "2026-08-10T12:00:00.000Z" });

    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(mocks.hasPaymentTransitionAudit).toHaveBeenCalledWith({ paymentId: "pay_1", action: "AUTO_RECORDED", source: "LINE_WEBHOOK", scheduleId: "schedule_1" });
    expect(mocks.appendAudit).toHaveBeenCalledOnce();
    expect(mocks.updatePaymentIfUnchanged.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ payment: expect.objectContaining({ status: "AUTO_RECORDED", line_slip_error: "" }) }));
  });

  it("repairs schedule then audit after a failed terminal transition, and does not duplicate the recovered audit", async () => {
    mocks.updateSchedule.mockRejectedValueOnce(new Error("schedule unavailable"));
    await expect(persistPaymentTransition({ payment: payment({ status: "PENDING" }), schedule: schedule(), nextStatus: "AUTO_RECORDED", source: "LINE_WEBHOOK", reason: "slip", now: "2026-08-10T12:00:00.000Z" })).rejects.toThrow("schedule unavailable");
    const recorded = mocks.updatePaymentIfUnchanged.mock.calls[0]?.[0].payment as PaymentRecord;
    mocks.updateSchedule.mockResolvedValue(undefined);

    await reconcileTerminalEffects({ payment: recorded, schedule: schedule(), now: "2026-08-10T12:01:00.000Z" });
    expect(mocks.updateSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ status: "PAID" }));
    expect(mocks.appendAudit).toHaveBeenCalledOnce();
    expect(mocks.updatePaymentIfUnchanged.mock.calls.at(-1)?.[0].payment).toMatchObject({ status: "AUTO_RECORDED", line_slip_error: "" });

    mocks.hasPaymentTransitionAudit.mockResolvedValue(true);
    await reconcileTerminalEffects({ payment: recorded, schedule: schedule({ status: "PAID" }), now: "2026-08-10T12:02:00.000Z" });
    expect(mocks.appendAudit).toHaveBeenCalledOnce();
  });

  it("keeps terminal effects pending when audit append fails so a redelivery can retry it", async () => {
    const recorded = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_slip_error: "TRANSITION_EFFECTS_PENDING:LINE_WEBHOOK:PENDING" });
    mocks.appendAudit.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(reconcileTerminalEffects({ payment: recorded, schedule: schedule({ status: "PAID" }) })).rejects.toThrow("audit unavailable");
    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledTimes(2);
    expect(mocks.updatePaymentIfUnchanged.mock.calls.at(-1)?.[0].payment).toMatchObject({ line_slip_error: "TRANSITION_EFFECTS_PENDING:LINE_WEBHOOK:PENDING" });

    mocks.appendAudit.mockResolvedValueOnce(undefined);
    await reconcileTerminalEffects({ payment: recorded, schedule: schedule({ status: "PAID" }) });
    expect(mocks.appendAudit).toHaveBeenCalledTimes(2);
    expect(mocks.updatePaymentIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ line_slip_error: "" }) }));
  });

  it("derives terminal audit provenance from the exact current marker and ignores a terminal row without one", async () => {
    const adminMarker = payment({ status: "MANUAL_CONFIRMED", line_slip_expected: "FALSE", line_slip_error: "TRANSITION_EFFECTS_PENDING:ADMIN:REVIEW" });

    await reconcileTerminalEffects({ payment: adminMarker, schedule: schedule(), now: "2026-08-10T12:00:00.000Z" });
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ source: "ADMIN", previousStatus: "REVIEW", newStatus: "MANUAL_CONFIRMED" }));

    vi.clearAllMocks();
    await expect(reconcileTerminalEffects({ payment: payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_slip_error: "" }), schedule: schedule() })).resolves.toBe(false);
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(mocks.appendAudit).not.toHaveBeenCalled();
  });

  it("claims terminal effects once across concurrent reconcilers and rechecks an ambiguously appended audit", async () => {
    let current = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_slip_error: "TRANSITION_EFFECTS_PENDING:CLIENT_UPLOAD:PENDING" });
    mocks.updatePaymentIfUnchanged.mockImplementation(async ({ expectedPayment, payment: next }) => {
      if (expectedPayment.line_slip_error !== current.line_slip_error) return false;
      current = next;
      return true;
    });
    let auditApplied = false;
    mocks.hasPaymentTransitionAudit.mockImplementation(async () => auditApplied);
    mocks.appendAudit.mockImplementation(async () => {
      auditApplied = true;
      throw new Error("connection reset after audit append");
    });

    await Promise.all([
      reconcileTerminalEffects({ payment: current, schedule: schedule(), now: "2026-08-10T12:00:00.000Z" }),
      reconcileTerminalEffects({ payment: current, schedule: schedule(), now: "2026-08-10T12:00:00.000Z" }),
    ]);

    expect(mocks.appendAudit).toHaveBeenCalledOnce();
    expect(current.line_slip_error).toBe("");
    expect(mocks.updateSchedule).toHaveBeenCalledTimes(1);
  });

  it.each(["ADMIN", "CLIENT_UPLOAD"]) ("recovers a pending %s terminal marker", async (source) => {
    const terminal = payment({ status: source === "ADMIN" ? "MANUAL_CONFIRMED" : "AUTO_RECORDED", line_slip_expected: "FALSE", line_slip_error: `TRANSITION_EFFECTS_PENDING:${source}:PENDING` });

    await reconcileTerminalEffects({ payment: terminal, schedule: schedule(), now: "2026-08-10T12:00:00.000Z" });

    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ source, previousStatus: "PENDING" }));
  });

  it("reclaims an expired terminal-effects lease after a prior owner stopped", async () => {
    const terminal = payment({ status: "AUTO_RECORDED", line_slip_expected: "FALSE", line_slip_error: "TRANSITION_EFFECTS_CLAIMED:CLIENT_UPLOAD:PENDING:1:11111111-1111-4111-8111-111111111111" });

    await expect(reconcileTerminalEffects({ payment: terminal, schedule: schedule(), now: "2026-08-10T12:00:00.000Z" })).resolves.toBe(true);

    expect(mocks.updatePaymentIfUnchanged.mock.calls[0]?.[0].payment.line_slip_error).toMatch(/^TRANSITION_EFFECTS_CLAIMED:CLIENT_UPLOAD:PENDING:/);
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ source: "CLIENT_UPLOAD" }));
  });
});

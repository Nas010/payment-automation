import { beforeEach, expect, it, vi } from "vitest";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/sheets/payments", () => ({ updatePaymentRecordsAndSchedules: save }));
import { correctPayment } from "./correction";
const payment = { payment_id: "pay_1", client_id: "client_1", amount_thb: "4900", total_price_thb: "4900", status: "MANUAL_CONFIRMED", manual_confirmed_at: "2026-09-10T00:00:00Z", recorded_at: "", line_slip_error: "", line_message_status: "ACCEPTED", line_reminder_delivery_log: "", updated_at: "old" } as PaymentRecord;
const schedule = { schedule_id: "schedule_1", client_id: "client_1", payment_id: "pay_1", amount_thb: "4900", status: "PAID", assignment_id: "assignment_1", installment_count: "1", installment_number: "1" } as ScheduleRecord;
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(true); });
it("corrects a paid invoice including an outside-system top-up", async () => {
  await correctPayment({ payment, schedules: [schedule], payments: [payment], amountThb: "5800", reason: "Received another 900 by bank transfer", undoConfirmation: false });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    updates: [{ expectedPayment: payment, payment: expect.objectContaining({ amount_thb: "5800", total_price_thb: "5800", status: "MANUAL_CONFIRMED", manual_confirmed_at: payment.manual_confirmed_at }) }],
    scheduleUpdates: [{ expectedSchedule: schedule, schedule: expect.objectContaining({ amount_thb: "5800", status: "PAID" }) }],
    audit: expect.objectContaining({ action: "PAYMENT_AMOUNT_CORRECTED", reason: "Received another 900 by bank transfer", metadata: expect.stringContaining('"previousAmountThb":"4900"') }),
  }));
});
it("undoes manual confirmation into review without re-enabling messages", async () => {
  await correctPayment({ payment, schedules: [schedule], payments: [payment], amountThb: "5800", reason: "Wrong amount confirmed", undoConfirmation: true });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ updates: [expect.objectContaining({ payment: expect.objectContaining({ status: "REVIEW", manual_confirmed_at: "", line_slip_expected: "FALSE", line_message_status: "ACCEPTED" }) })], scheduleUpdates: [expect.objectContaining({ schedule: expect.objectContaining({ status: "GENERATED", amount_thb: "5800" }) })] }));
});
it.each(["0", "-1", "bad"])("rejects invalid amount %s", async (amountThb) => {
  await expect(correctPayment({ payment, schedules: [schedule], payments: [payment], amountThb, reason: "Correction", undoConfirmation: false })).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
});
it("rejects stale persistence without claiming success", async () => {
  save.mockResolvedValue(false);
  await expect(correctPayment({ payment, schedules: [schedule], payments: [payment], amountThb: "5800", reason: "Correction", undoConfirmation: false })).rejects.toThrow("changed");
});
it.each(["VOID", "AUTO_RECORDED"])("does not undo %s", async (status) => {
  await expect(correctPayment({ payment: { ...payment, status }, schedules: [schedule], payments: [payment], amountThb: "5800", reason: "Correction", undoConfirmation: true })).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
});
it("blocks changes while a message is being delivered", async () => {
  await expect(correctPayment({ payment: { ...payment, line_message_status: "SENDING" }, schedules: [schedule], payments: [payment], amountThb: "5800", reason: "Correction", undoConfirmation: false })).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
});

it.each(["DOWNLOADING", "ANALYZING"])("blocks correction during slip %s", async (line_slip_processing_status) => {
  await expect(correctPayment({ payment: { ...payment, line_slip_processing_status }, schedules: [schedule], payments: [payment], amountThb: "5800", reason: "Correction", undoConfirmation: false })).rejects.toThrow("in progress");
  expect(save).not.toHaveBeenCalled();
});
it("guards every installment and updates related invoice totals", async () => {
  const sibling = { ...schedule, schedule_id: "schedule_2", payment_id: "pay_2", amount_thb: "1000" };
  const otherPayment = { ...payment, payment_id: "pay_2", amount_thb: "1000" };
  await correctPayment({ payment, schedules: [schedule, sibling], payments: [payment, otherPayment], amountThb: "5800", reason: "Top up", undoConfirmation: false });
  expect(save.mock.calls[0][0].scheduleUpdates).toHaveLength(2);
  expect(save.mock.calls[0][0].updates[1].payment).toMatchObject({ amount_thb: "1000", total_price_thb: "6800" });
});

import { describe, expect, it, vi } from "vitest";

const { appendPayment, appendAudit, getPaymentById, listPayments, listSchedules, updatePaymentIfUnchanged, updateSchedule, updateScheduleIfUnchanged } = vi.hoisted(() => ({
  appendPayment: vi.fn(),
  appendAudit: vi.fn(),
  getPaymentById: vi.fn(),
  listPayments: vi.fn(),
  listSchedules: vi.fn(),
  updatePaymentIfUnchanged: vi.fn(),
  updateSchedule: vi.fn(),
  updateScheduleIfUnchanged: vi.fn(),
}));

vi.mock("@/lib/sheets/payments", () => ({ appendPayment, appendAudit, getPaymentById, listPayments, updatePaymentIfUnchanged }));
vi.mock("@/lib/sheets/schedules", () => ({ listSchedules, updateSchedule, updateScheduleIfUnchanged }));

import { generateDuePaymentLinks } from "./generate";

describe("generateDuePaymentLinks", () => {
  it("creates one link from each due canonical schedule row and marks it generated", async () => {
    listSchedules.mockResolvedValueOnce([
      {
        rowNumber: 7, schedule_id: "schedule_1", client_id: "client_1", client_name: "Nisa", line_user_id: "line_1",
        line_display_name: "", package_name: "PT", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2",
        amount_thb: "1500", due_date: "2026-08-10", status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: "",
        created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
      },
      {
        rowNumber: 8, schedule_id: "schedule_later", client_id: "client_1", client_name: "Nisa", line_user_id: "", line_display_name: "",
        package_name: "PT", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "2", amount_thb: "1500",
        due_date: "2026-09-10", status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: "", created_at: "2026-08-01T00:00:00.000Z", updated_at: "",
      },
    ]);
    listPayments.mockResolvedValueOnce([]);
    appendPayment.mockResolvedValueOnce(undefined);
    updateSchedule.mockResolvedValueOnce(undefined);
    updateScheduleIfUnchanged.mockResolvedValueOnce(true);
    appendAudit.mockResolvedValueOnce(undefined);

    const result = await generateDuePaymentLinks({
      baseUrl: "https://pay.example", today: "2026-08-10", now: "2026-08-10T01:00:00.000Z",
      createPaymentId: () => "pay_1", createToken: () => "token_1",
    });

    expect(result.created).toHaveLength(1);
    expect(result.existing).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.created[0]).toMatchObject({ payment_id: "pay_1", client_id: "client_1", status: "PENDING", payment_url: "https://pay.example/p/token_1" });
    expect(appendPayment).toHaveBeenCalledWith(expect.objectContaining({ total_price_thb: "3000", line_terms_image_token: "", line_reminder_delivery_log: "" }));
    expect(updateScheduleIfUnchanged).toHaveBeenCalledWith({
      expectedSchedule: expect.objectContaining({ rowNumber: 7, status: "SCHEDULED", payment_id: "" }),
      schedule: expect.objectContaining({ rowNumber: 7, status: "GENERATED", payment_id: "pay_1", generated_at: "2026-08-10T01:00:00.000Z" }),
    });
  });

  it("creates an initial installment immediately when its schedule is explicitly selected", async () => {
    const first = { rowNumber: 7, schedule_id: "schedule_1", client_id: "client_1", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "PT", payment_type: "INSTALLMENTS", installment_number: "1", installment_count: "2", amount_thb: "1500", due_date: "2026-09-10", status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: "", created_at: "2026-08-01T00:00:00.000Z", updated_at: "" };
    listSchedules.mockResolvedValueOnce([first, { ...first, schedule_id: "schedule_2", installment_number: "2", due_date: "2026-10-10" }]);
    listPayments.mockResolvedValueOnce([]); appendPayment.mockResolvedValueOnce(undefined); updateSchedule.mockResolvedValueOnce(undefined); updateScheduleIfUnchanged.mockResolvedValueOnce(true); appendAudit.mockResolvedValueOnce(undefined);
    const result = await generateDuePaymentLinks({ baseUrl: "https://pay.example", today: "2026-08-10", scheduleIds: ["schedule_1"], createPaymentId: () => "pay_1", createToken: () => "token_1" });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ due_date: "2026-09-10", payment_url: "https://pay.example/p/token_1" });
  });

  it("voids a freshly appended payment when schedule generation loses its CAS", async () => {
    appendAudit.mockClear();
    const due = { rowNumber: 7, schedule_id: "schedule_1", client_id: "client_1", client_name: "Nisa", line_user_id: "", line_display_name: "", package_name: "PT", payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", amount_thb: "1500", due_date: "2026-08-10", status: "SCHEDULED", generated_at: "", payment_id: "", payment_url: "", notes: "", created_at: "2026-08-01T00:00:00.000Z", updated_at: "" };
    listSchedules.mockResolvedValueOnce([due]);
    listPayments.mockResolvedValueOnce([]);
    appendPayment.mockResolvedValueOnce(undefined);
    updateScheduleIfUnchanged.mockResolvedValueOnce(false);
    const appended = { rowNumber: 4, payment_id: "pay_1", client_id: "client_1", status: "PENDING", line_slip_expected: "", line_slip_processing_status: "", updated_at: "2026-08-10T01:00:00.000Z" };
    getPaymentById.mockResolvedValueOnce(appended);
    updatePaymentIfUnchanged.mockResolvedValueOnce(true);

    const result = await generateDuePaymentLinks({ baseUrl: "https://pay.example", today: "2026-08-10", now: "2026-08-10T01:00:00.000Z", createPaymentId: () => "pay_1", createToken: () => "token_1" });

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([{ scheduleId: "schedule_1", error: "Schedule changed before payment link generation" }]);
    expect(updatePaymentIfUnchanged).toHaveBeenCalledWith({
      expectedPayment: appended,
      payment: expect.objectContaining({ payment_id: "pay_1", status: "VOID", line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED" }),
    });
    expect(appendAudit).not.toHaveBeenCalled();
  });
});

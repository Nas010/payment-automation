import { describe, expect, it, vi } from "vitest";

const { appendPayment, appendAudit, listPayments, listSchedules, updateSchedule } = vi.hoisted(() => ({
  appendPayment: vi.fn(),
  appendAudit: vi.fn(),
  listPayments: vi.fn(),
  listSchedules: vi.fn(),
  updateSchedule: vi.fn(),
}));

vi.mock("@/lib/sheets/payments", () => ({ appendPayment, appendAudit, listPayments }));
vi.mock("@/lib/sheets/schedules", () => ({ listSchedules, updateSchedule }));

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
    appendAudit.mockResolvedValueOnce(undefined);

    const result = await generateDuePaymentLinks({
      baseUrl: "https://pay.example", today: "2026-08-10", now: "2026-08-10T01:00:00.000Z",
      createPaymentId: () => "pay_1", createToken: () => "token_1",
    });

    expect(result.created).toHaveLength(1);
    expect(result.existing).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.created[0]).toMatchObject({ payment_id: "pay_1", client_id: "client_1", status: "PENDING", payment_url: "https://pay.example/p/token_1" });
    expect(appendPayment).toHaveBeenCalledWith(expect.objectContaining({ total_price_thb: "3000", line_terms_image_token: "" }));
    expect(updateSchedule).toHaveBeenCalledWith(expect.objectContaining({ rowNumber: 7, status: "GENERATED", payment_id: "pay_1", generated_at: "2026-08-10T01:00:00.000Z" }));
  });
});

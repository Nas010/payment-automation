import { describe, expect, it } from "vitest";
import { CLIENT_HEADERS, PAYMENT_HEADERS, SCHEDULE_HEADERS } from "@/lib/sheets/records";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";
import type { ScheduleRecord } from "@/lib/sheets/schedules";
import { LineDueTemplateError, renderLineDueMessageProfile } from "./message-profile";
import { resolveLineDueMessageValues } from "./message-values";

function blankRecord(headers: readonly string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header, ""]));
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { ...blankRecord(PAYMENT_HEADERS), rowNumber: 2, payment_id: "pay_1", client_id: "client_1", amount_thb: "1500", due_date: "2026-08-10", payment_url: "https://pay.example/p/token_1", ...overrides } as PaymentRecord;
}

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return { ...blankRecord(CLIENT_HEADERS), rowNumber: 2, client_id: "client_1", client_name: "Nisa Current", ...overrides } as ClientRecord;
}

function schedule(overrides: Partial<ScheduleRecord>): ScheduleRecord {
  return { ...blankRecord(SCHEDULE_HEADERS), rowNumber: 2, client_id: "client_1", package_name: "PT", payment_type: "INSTALLMENTS", installment_count: "3", created_at: "2026-08-01T00:00:00.000Z", ...overrides } as ScheduleRecord;
}

describe("resolveLineDueMessageValues", () => {
  it("prefers stable Payment plan snapshot and current Client name", () => {
    const result = resolveLineDueMessageValues({
      payment: payment({ package_name: "Original PT", payment_type: "INSTALLMENTS", installment_number: "2", installment_count: "3", total_price_thb: "4500" }),
      client: client({ client_name: "Nisa Current", package_name: "Changed package", total_price_thb: "9999" }),
      schedules: [],
    });
    expect(result).toEqual({ paymentType: "INSTALLMENTS", values: expect.objectContaining({
      client_name: "Nisa Current",
      package_name: "Original PT",
      payment_type: "Installments",
      installment_number: "2",
      installment_ordinal: "2nd",
      installment_number_word: "two",
      installment_ordinal_word: "second",
      installment_count: "3",
      installment_count_word: "three",
      amount: "฿1,500.00",
      total_amount: "฿4,500.00",
      due_date: "2026-08-10",
      due_month_name: "August",
      payment_url: "https://pay.example/p/token_1",
    }) });
  });

  it("resolves a legacy Payment from its matched schedule group", () => {
    const schedules = ["1500", "1500", "1500"].map((amount_thb, index) => schedule({
      rowNumber: index + 2,
      schedule_id: `schedule_${index + 1}`,
      installment_number: String(index + 1),
      amount_thb,
      payment_id: index === 1 ? "pay_1" : "",
    }));
    const result = resolveLineDueMessageValues({
      payment: payment(),
      client: client(),
      schedules,
    });
    expect(result.paymentType).toBe("INSTALLMENTS");
    expect(result.values).toMatchObject({ package_name: "PT", installment_ordinal_word: "second", total_amount: "฿4,500.00" });
  });

  it("never borrows changed schedule fields for a partially populated snapshot row", () => {
    const result = resolveLineDueMessageValues({
      payment: payment({ payment_type: "INSTALLMENTS", package_name: "", installment_number: "", installment_count: "", total_price_thb: "" }),
      client: client(),
      schedules: [schedule({ payment_id: "pay_1", package_name: "Changed PT", payment_type: "ONE_TIME", installment_number: "1", installment_count: "1", amount_thb: "9999" })],
    });

    expect(result).toMatchObject({
      paymentType: "INSTALLMENTS",
      values: { package_name: undefined, total_amount: undefined },
    });
    expect(result.values.installment_number).toBeUndefined();
    expect(result.values.installment_count).toBeUndefined();
  });

  it.each([
    ["number-only", { installment_number: "2", installment_count: "" }],
    ["count-only", { installment_number: "", installment_count: "3" }],
    ["out-of-bounds", { installment_number: "4", installment_count: "3" }],
  ])("keeps %s snapshot installment data unavailable without consulting changed schedules", (_shape, installmentPosition) => {
    const changedSchedules = new Proxy([
      schedule({
        payment_id: "pay_1",
        package_name: "Changed PT",
        payment_type: "ONE_TIME",
        installment_number: "1",
        installment_count: "1",
        amount_thb: "9999",
      }),
    ], {
      get(target, property, receiver) {
        if (property === "find") throw new Error("Snapshot-backed payment must not consult schedules");
        return Reflect.get(target, property, receiver);
      },
    });
    const result = resolveLineDueMessageValues({
      payment: payment({
        package_name: "Snapshot PT",
        payment_type: "INSTALLMENTS",
        total_price_thb: "4500",
        ...installmentPosition,
      }),
      client: client(),
      schedules: changedSchedules,
    });

    expect(result.values).toMatchObject({
      package_name: "Snapshot PT",
      payment_type: "Installments",
      total_amount: "฿4,500.00",
    });
    expect(result.values.installment_number).toBeUndefined();
    expect(result.values.installment_count).toBeUndefined();
    expect(renderLineDueMessageProfile({
      version: 1,
      message: "{{package_name}} {{amount}} {{due_date}} {{payment_url}}",
      customPlaceholders: [],
    }, "INSTALLMENTS", result.values)).toBe(
      "Snapshot PT ฿1,500.00 2026-08-10 https://pay.example/p/token_1",
    );
    expect(() => renderLineDueMessageProfile({
      version: 1,
      message: "{{installment_number}} {{amount}} {{due_date}} {{payment_url}}",
      customPlaceholders: [],
    }, "INSTALLMENTS", result.values)).toThrow(
      expect.objectContaining<Partial<LineDueTemplateError>>({ code: "TEMPLATE_DATA_MISSING" }),
    );
  });

  it("leaves an incomplete legacy plan total absent for templates that do not need it", () => {
    const result = resolveLineDueMessageValues({
      payment: payment(),
      client: client(),
      schedules: [schedule({ payment_id: "pay_1", payment_type: "ONE_TIME", installment_number: "1", installment_count: "2", amount_thb: "1500" })],
    });

    expect(result.values.total_amount).toBeUndefined();
  });
});

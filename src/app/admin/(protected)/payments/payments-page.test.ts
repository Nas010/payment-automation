import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";

const mocks = vi.hoisted(() => ({ readPaymentClientSnapshot: vi.fn() }));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
vi.mock("@/lib/sheets/payment-client-snapshot", () => ({ readPaymentClientSnapshot: mocks.readPaymentClientSnapshot }));

import PaymentsPage from "./page";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    rowNumber: 2, payment_id: "pay_1", client_id: "client_1", client_name: "Nisa", period: "2026-08", amount_thb: "1500", due_date: "2026-08-15", payment_url: "https://payments.example/p/token", status: "PENDING", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-10T08:30:00.000Z", line_message_status: "FAILED_RETRYABLE", line_message_attempted_at: "2026-08-10T08:15:00.000Z", line_slip_expected: "TRUE", line_slip_processing_status: "AWAITING",
    ...overrides,
  } as PaymentRecord;
}

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "TRUE", client_name: "Nisa", line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_display_name: "Nisa LINE", line_picture_url: "", line_link_status: "LINKED",
    ...overrides,
  } as ClientRecord;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment()], clients: [client()] });
});

describe("PaymentsPage ledger", () => {
  it("renders concise client-facing delivery and slip states", async () => {
    const html = renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain(">Not sent<");
    expect(html).not.toContain("FAILED_RETRYABLE");
    expect(html).not.toContain("Recipient linked");
    expect(html).not.toContain("Last attempt");
    expect(html).toContain("Awaiting payment slip");
    expect(html).not.toContain("AWAITING");
    expect(html).not.toContain("Generated payment links and submitted evidence.");
  });

  it("shows package payment context instead of the generated due-month key", async () => {
    mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment({ package_name: "Personal Training", payment_type: "INSTALLMENTS", installment_number: "3", installment_count: "12" })], clients: [client()] });

    const html = renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Personal Training · Installment 3 of 12");
    expect(html).not.toContain(">2026-08<");
  });

  it("renders one direct open-payment button without copy controls", async () => {
    const html = renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Open payment");
    expect(html).toContain('href="https://payments.example/p/token"');
    expect(html).not.toContain("Copy link");
  });
});

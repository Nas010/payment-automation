import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/sheets/clients";
import type { PaymentRecord } from "@/lib/sheets/payments";

const mocks = vi.hoisted(() => ({ readPaymentClientSnapshot: vi.fn(), notFound: vi.fn(), sendLinePaymentAction: vi.fn(), stopAwaitingLineSlipAction: vi.fn(), confirmPaymentAction: vi.fn() }));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props) }));
vi.mock("@/lib/sheets/payment-client-snapshot", () => ({ readPaymentClientSnapshot: mocks.readPaymentClientSnapshot }));
vi.mock("../../actions", () => ({ confirmPaymentAction: mocks.confirmPaymentAction, sendLinePaymentAction: mocks.sendLinePaymentAction, stopAwaitingLineSlipAction: mocks.stopAwaitingLineSlipAction }));

import PaymentDetailPage from "./page";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    rowNumber: 2, payment_id: "pay_1", client_id: "client_1", client_name: "Nisa", period: "2026-08", amount_thb: "1500", due_date: "2026-08-15", payment_url: "https://payments.example/p/token", status: "PENDING", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-10T08:30:00.000Z", line_message_status: "FAILED_RETRYABLE", line_message_attempted_at: "2026-08-10T08:15:00.000Z", line_slip_expected: "TRUE", line_slip_processing_status: "AWAITING",
    ...overrides,
  } as PaymentRecord;
}

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    rowNumber: 2, client_id: "client_1", active: "FALSE", client_name: "Nisa", line_user_id: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", line_display_name: "Nisa LINE", line_picture_url: "", line_link_status: "LINKED",
    ...overrides,
  } as ClientRecord;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment()], clients: [client()] });
});

describe("PaymentDetailPage LINE workflow", () => {
  it("renders message, unavailable recipient, last attempt, slip state, and fallback send action", async () => {
    const html = renderToStaticMarkup(await PaymentDetailPage({ params: Promise.resolve({ paymentId: "pay_1" }) }));

    expect(html).toContain("FAILED_RETRYABLE");
    expect(html).toContain("Missing linked LINE account");
    expect(html).toContain("Last attempt");
    expect(html).toContain("AWAITING");
    expect(html).toContain("Send LINE payment request");
  });

  it("does not present a voided payment as payable or manually confirmable", async () => {
    mocks.readPaymentClientSnapshot.mockResolvedValue({ payments: [payment({ status: "VOID", line_slip_expected: "FALSE", line_slip_processing_status: "STOPPED" })], clients: [client()] });

    const html = renderToStaticMarkup(await PaymentDetailPage({ params: Promise.resolve({ paymentId: "pay_1" }) }));

    expect(html).toContain("VOID");
    expect(html).not.toContain("Copy payment link");
    expect(html).not.toContain("Send LINE payment request");
    expect(html).not.toContain("Confirm manually");
  });
});

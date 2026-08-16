import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "@/lib/sheets/payments";

const mocks = vi.hoisted(() => ({
  getPaymentByToken: vi.fn(),
  runtimeConfig: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock("@/lib/sheets/payments", () => ({ getPaymentByToken: mocks.getPaymentByToken }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.toDataURL } }));

import PaymentPage from "./page";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { payment_id: "pay_1", client_name: "Nisa", amount_thb: "3000", status: "PENDING", ...overrides } as PaymentRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.getPaymentByToken.mockResolvedValue(payment());
});

describe("PaymentPage", () => {
  it("renders an inactive notice for a voided payment before loading configuration or creating a QR", async () => {
    mocks.getPaymentByToken.mockResolvedValue(payment({ status: "VOID" }));

    const html = renderToStaticMarkup(await PaymentPage({ params: Promise.resolve({ token: "token_1" }) }));

    expect(html).toContain("This payment request is no longer active");
    expect(mocks.runtimeConfig).not.toHaveBeenCalled();
    expect(mocks.toDataURL).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { PaymentRecord } from "@/lib/sheets/payments";

const mocks = vi.hoisted(() => ({
  getPaymentByToken: vi.fn(),
  processSlipImage: vi.fn(),
  allow: vi.fn(),
}));

vi.mock("@/lib/sheets/payments", () => ({ getPaymentByToken: mocks.getPaymentByToken }));
vi.mock("@/lib/slip/process", () => ({ processSlipImage: mocks.processSlipImage }));
vi.mock("@/lib/security/rate-limit", () => ({ paymentSubmissionLimiter: { allow: mocks.allow } }));

import { POST } from "./route";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { payment_id: "pay_1", status: "PENDING", ...overrides } as PaymentRecord;
}

function request(): NextRequest {
  const form = new FormData();
  form.set("slip", new File([new Uint8Array([137, 80, 78, 71])], "slip.png", { type: "image/png" }));
  return new Request("https://example.test/api/payment/token_1/submit", { method: "POST", body: form }) as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allow.mockReturnValue(true);
  mocks.getPaymentByToken.mockResolvedValue(payment());
  mocks.processSlipImage.mockResolvedValue({ decision: "AUTO_RECORDED" });
});

describe("POST /api/payment/[token]/submit", () => {
  it("rejects a voided payment before reading the submitted slip", async () => {
    mocks.getPaymentByToken.mockResolvedValue(payment({ status: "VOID" }));
    const formData = vi.fn();

    const response = await POST({ headers: new Headers(), formData } as unknown as NextRequest, { params: Promise.resolve({ token: "token_1" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "This payment request is no longer active" });
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.processSlipImage).not.toHaveBeenCalled();
  });

  it("delegates image processing while preserving successful upload response", async () => {
    const response = await POST(request(), { params: Promise.resolve({ token: "token_1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "AUTO_RECORDED", message: "Payment slip received and recorded." });
    expect(mocks.processSlipImage).toHaveBeenCalledWith(expect.objectContaining({ expectedPayment: payment(), source: { type: "WEB_UPLOAD" }, declaredType: "image/png" }));
  });
});

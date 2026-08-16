import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaymentByToken: vi.fn(),
  runtimeConfig: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("@/lib/sheets/payments", () => ({ getPaymentByToken: mocks.getPaymentByToken }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("qrcode", () => ({ default: { toBuffer: mocks.toBuffer } }));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/payments/[publicToken]/promptpay-qr.png", () => {
  it("returns not found for an unknown payment without exposing its token", async () => {
    mocks.getPaymentByToken.mockResolvedValue(null);

    const response = await GET(new Request("https://pay.example/api/payments/private-token/promptpay-qr.png"), { params: Promise.resolve({ publicToken: "private-token" }) });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain("private-token");
  });

  it("returns not found for a voided payment before loading configuration or generating a QR", async () => {
    mocks.getPaymentByToken.mockResolvedValue({ amount_thb: "3000", status: "VOID" });

    const response = await GET(new Request("https://pay.example/api/payments/token_1/promptpay-qr.png"), { params: Promise.resolve({ publicToken: "token_1" }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.runtimeConfig).not.toHaveBeenCalled();
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it("returns a non-cacheable high-contrast 720px PNG for the exact website PromptPay payload", async () => {
    mocks.getPaymentByToken.mockResolvedValue({ amount_thb: "฿3,000.00" });
    mocks.runtimeConfig.mockResolvedValue({ promptPayIdentifier: "0812345678", promptPayType: "phone" });
    mocks.toBuffer.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

    const response = await GET(new Request("https://pay.example/api/payments/token_1/promptpay-qr.png"), { params: Promise.resolve({ publicToken: "token_1" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);
    expect(mocks.toBuffer).toHaveBeenCalledWith("00020101021229370016A000000677010111011300668123456785802TH53037645404300063045061", { width: 720, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } });
  });

  it("returns not found for a payment with an invalid amount", async () => {
    mocks.getPaymentByToken.mockResolvedValue({ amount_thb: "invalid" });
    mocks.runtimeConfig.mockResolvedValue({ promptPayIdentifier: "0812345678", promptPayType: "phone" });

    await expect(GET(new Request("https://pay.example/api/payments/token_1/promptpay-qr.png"), { params: Promise.resolve({ publicToken: "token_1" }) })).resolves.toMatchObject({ status: 404 });
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it("returns a sanitized server error when PromptPay configuration is unavailable, distinct from invalid payment input", async () => {
    mocks.getPaymentByToken.mockResolvedValue({ amount_thb: "3000" });
    mocks.runtimeConfig.mockRejectedValue(new Error("private configuration failure"));

    const response = await GET(new Request("https://pay.example/api/payments/private-token/promptpay-qr.png"), { params: Promise.resolve({ publicToken: "private-token" }) });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("private");
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it("returns a sanitized server error when a malformed PromptPay configuration cannot build a payload", async () => {
    mocks.getPaymentByToken.mockResolvedValue({ amount_thb: "3000" });
    mocks.runtimeConfig.mockResolvedValue({ promptPayIdentifier: "not-a-valid-phone", promptPayType: "phone" });

    const response = await GET(new Request("https://pay.example/api/payments/private-token/promptpay-qr.png"), { params: Promise.resolve({ publicToken: "private-token" }) });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("private");
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it("returns a sanitized server error when payment lookup fails", async () => {
    mocks.getPaymentByToken.mockRejectedValue(new Error("private workbook failure for private-token"));

    const response = await GET(new Request("https://pay.example/api/payments/private-token/promptpay-qr.png"), { params: Promise.resolve({ publicToken: "private-token" }) });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("private-token");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getPaymentById: vi.fn(),
  getConfiguredDriveClient: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/sheets/payments", () => ({ getPaymentById: mocks.getPaymentById }));
vi.mock("@/lib/storage/drive-client", () => ({ getConfiguredDriveClient: mocks.getConfiguredDriveClient }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.getPaymentById.mockResolvedValue({ payment_id: "pay_1", slip_url: "https://drive.google.com/open?id=file-12345" });
  mocks.getConfiguredDriveClient.mockResolvedValue({
    files: {
      get: vi.fn().mockResolvedValue({ data: new ArrayBuffer(3), headers: { "content-type": "image/png" } }),
    },
  });
});

describe("private slip route", () => {
  it("reads private bytes through the active configured Drive client", async () => {
    const response = await GET(new Request("https://example.com/admin/slips/pay_1"), { params: Promise.resolve({ paymentId: "pay_1" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getConfiguredDriveClient).toHaveBeenCalledTimes(1);
  });

  it("returns a safe not-found response without contacting Drive", async () => {
    mocks.getPaymentById.mockResolvedValue({ payment_id: "pay_1", slip_url: "" });

    const response = await GET(new Request("https://example.com/admin/slips/pay_1"), { params: Promise.resolve({ paymentId: "pay_1" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Private slip not available" });
    expect(mocks.getConfiguredDriveClient).not.toHaveBeenCalled();
  });

  it("sanitizes Drive failures", async () => {
    mocks.getConfiguredDriveClient.mockResolvedValue({ files: { get: vi.fn().mockRejectedValue(new Error("private Google response")) } });

    const response = await GET(new Request("https://example.com/admin/slips/pay_1"), { params: Promise.resolve({ paymentId: "pay_1" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Private slip not available" });
    expect(JSON.stringify(await response.json().catch(() => ({})))).not.toContain("private Google response");
  });
});

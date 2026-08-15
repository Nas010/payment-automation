import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtimeConfig: vi.fn(),
  qrToBuffer: vi.fn(),
  composite: vi.fn(),
  png: vi.fn(),
  outputToBuffer: vi.fn(),
}));

vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("qrcode", () => ({ default: { toBuffer: mocks.qrToBuffer } }));
vi.mock("sharp", () => ({
  default: vi.fn(() => ({ composite: mocks.composite })),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtimeConfig.mockResolvedValue({ publicBaseUrl: "https://pay.example" });
  mocks.qrToBuffer.mockResolvedValue(Buffer.from("qr"));
  mocks.composite.mockReturnValue({ png: mocks.png });
  mocks.png.mockReturnValue({ toBuffer: mocks.outputToBuffer });
  mocks.outputToBuffer.mockResolvedValue(Buffer.from([137, 80, 78, 71]));
});

describe("GET /api/line/message-test-qr", () => {
  it("encodes only the harmless test URL and adds a visible TEST label", async () => {
    const response = await GET();

    expect(mocks.qrToBuffer).toHaveBeenCalledWith("https://pay.example/line/message-test", {
      width: 640,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    expect(mocks.composite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ input: Buffer.from("qr"), top: 0, left: 0 }),
      expect.objectContaining({ input: expect.any(Buffer), top: 640, left: 0 }),
    ]));
    const label = (mocks.composite.mock.calls[0]?.[0][1].input as Buffer).toString("utf8");
    expect(label).toContain("TEST — NOT PAYABLE");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("returns a sanitized failure when config or rendering fails", async () => {
    mocks.runtimeConfig.mockRejectedValueOnce(new Error("private workbook detail"));
    const configFailure = await GET();
    expect(configFailure.status).toBe(500);
    await expect(configFailure.text()).resolves.toBe("Internal Server Error");

    mocks.qrToBuffer.mockRejectedValueOnce(new Error("private QR detail"));
    const renderFailure = await GET();
    expect(renderFailure.status).toBe(500);
    await expect(renderFailure.text()).resolves.toBe("Internal Server Error");
  });
});

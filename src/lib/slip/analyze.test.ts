import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({ createWorker: vi.fn(), selectSlipQrPayload: vi.fn() }));

vi.mock("tesseract.js", () => ({
  createWorker: mocks.createWorker,
  PSM: { SINGLE_BLOCK: "6", SINGLE_LINE: "7" },
}));

vi.mock("./qr", () => ({ selectSlipQrPayload: mocks.selectSlipQrPayload }));

import { analyzeSlip } from "./analyze";

let image: Buffer;

function worker(texts: string[]) {
  return {
    recognize: vi.fn(async () => ({ data: { text: texts.shift() ?? "" } })),
    setParameters: vi.fn(async () => undefined),
    terminate: vi.fn(async () => undefined),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  mocks.selectSlipQrPayload.mockReturnValue({ payload: null, parsed: null, qrValid: false, ambiguous: false });
  mocks.createWorker
    .mockResolvedValueOnce(worker(["โอนเงินสำเร็จ ไปยัง นางสาว Wsws บุญสนิท จำนวนเงิน 9,730.00 16 ส.ค. 2569 - 08:40"]))
    .mockResolvedValueOnce(worker([
      "ไปยัง นางสาว พ่ธพร บุญสนิท XXX-XXX-8717",
      "ผู้รับ นางสาว พีรพ บุญสนก XXX-XXX-8717",
    ]));
});

describe("analyzeSlip", () => {
  it("recovers a configured Thai receiver after mixed OCR produces Wsws", async () => {
    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrReceiver).toBe("นางสาว พีรพร บุญสนิท");
    expect(mocks.createWorker).toHaveBeenNthCalledWith(1, ["eng", "tha"]);
    expect(mocks.createWorker).toHaveBeenNthCalledWith(2, ["tha"]);
  });

  it("adds SCB recipient crops when a valid slip QR identifies sender code 014", async () => {
    const thaiWorker = worker([
      "ไปยัง นางสาว พ่ธพร บุญสนิท XXX-XXX-8717",
      "ผู้รับ นางสาว พีรพ บุญสนก XXX-XXX-8717",
      "ไปยัง นางสาว พีรพร บุญสนิท XXX-XXX-8717",
      "ผู้รับ นางสาว พีรพร บุญสนิท XXX-XXX-8717",
    ]);
    mocks.createWorker
      .mockReset()
      .mockResolvedValueOnce(worker(["ไปยัง นางสาว Wsws บุญสนิท"]))
      .mockResolvedValueOnce(thaiWorker);
    mocks.selectSlipQrPayload.mockReturnValue({
      payload: "slip-qr",
      parsed: { valid: true, fields: {}, transactionReference: "TXN-100", sendingBankCode: "014", countryCode: "TH" },
      qrValid: true,
      ambiguous: false,
    });

    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrReceiver).toBe("นางสาว พีรพร บุญสนิท");
    expect(thaiWorker.recognize).toHaveBeenCalledTimes(4);
    expect(thaiWorker.setParameters).toHaveBeenCalledOnce();
  });
});

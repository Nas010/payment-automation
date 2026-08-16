import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({ createWorker: vi.fn(), selectSlipQrPayload: vi.fn() }));

vi.mock("tesseract.js", () => ({
  createWorker: mocks.createWorker,
  PSM: { SINGLE_BLOCK: "6", SINGLE_LINE: "7" },
}));

vi.mock("./qr", () => ({ selectSlipQrPayload: mocks.selectSlipQrPayload }));

import { analyzeSlip, normalizeOcrImage, preprocessOcrImage } from "./analyze";

let image: Buffer;

type RecognitionFixture = string | { text: string; blocks?: unknown[] | null };

function worker(fixtures: RecognitionFixture[]) {
  return {
    recognize: vi.fn(async () => {
      const fixture = fixtures.shift() ?? "";
      return { data: typeof fixture === "string" ? { text: fixture } : fixture };
    }),
    setParameters: vi.fn(async () => undefined),
    terminate: vi.fn(async () => undefined),
  };
}

function blocks(lines: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>) {
  return [{ paragraphs: [{ lines }] }];
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
  it("keeps normalized OCR variants dimension-stable and does not mutate source bytes", async () => {
    const source = await sharp({ create: { width: 24, height: 12, channels: 4, background: { r: 240, g: 220, b: 210, alpha: 0.5 } } }).png().toBuffer();
    const original = Buffer.from(source);
    const normalized = await normalizeOcrImage(source);
    const clahe = await preprocessOcrImage(normalized, "CLAHE");
    const sauvola = await preprocessOcrImage(normalized, "SAUVOLA");
    await expect(sharp(normalized).metadata()).resolves.toMatchObject({ width: 24, height: 12 });
    await expect(sharp(clahe).metadata()).resolves.toMatchObject({ width: 24, height: 12 });
    await expect(sharp(sauvola).metadata()).resolves.toMatchObject({ width: 24, height: 12 });
    expect(Buffer.compare(source, original)).toBe(0);
  });

  it("recovers a separately printed amount only when both field passes agree", async () => {
    const mixedWorker = worker([
      {
        text: "โอนเงินสำเร็จ\nไปยัง นางสาว พีรพร บุญสนิท\nจำนวน:\n5900.00 บาท\nค่าธรรมเนียม:\n0.00 บาท\n16 ส.ค. 69 09:51 น.",
        blocks: blocks([
          { text: "จำนวน:", confidence: 80, bbox: { x0: 70, y0: 900, x1: 250, y1: 955 } },
          { text: "5900.00 บาท", confidence: 58, bbox: { x0: 390, y0: 948, x1: 690, y1: 1010 } },
          { text: "ค่าธรรมเนียม:", confidence: 78, bbox: { x0: 70, y0: 1015, x1: 330, y1: 1070 } },
          { text: "0.00 บาท", confidence: 95, bbox: { x0: 500, y0: 1080, x1: 690, y1: 1135 } },
        ]),
      },
      "5900.00",
      "5,900.00",
    ]);
    mocks.createWorker.mockReset().mockResolvedValueOnce(mixedWorker);

    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrAmountSatang).toBe(590000);
    expect(mixedWorker.recognize).toHaveBeenCalledTimes(4);
    expect(mixedWorker.recognize.mock.calls[0]?.[2]).toMatchObject({ text: true, blocks: true });
    expect(mixedWorker.setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_char_whitelist: "0123456789,. ", tessedit_pageseg_mode: "6" }));
  });

  it("uses two agreeing numeric passes after a Thai amount label is slightly corrupted", async () => {
    const mixedWorker = worker([
      {
        text: "โอนเงินสำเร็จ\nนางสาว พีรพร บุญสนิท\nจ ้ า น ว น :\n6,600.00 บาท\nค่าธรรมเนียม 0.00 บาท\n10 ส.ค. 69 10:41 น.",
        blocks: blocks([
          { text: "จ ้ า น ว น :", confidence: 75, bbox: { x0: 70, y0: 900, x1: 250, y1: 955 } },
          { text: "6,600.00 บาท", confidence: 61, bbox: { x0: 390, y0: 948, x1: 690, y1: 1010 } },
          { text: "ค่าธรรมเนียม 0.00 บาท", confidence: 90, bbox: { x0: 70, y0: 1015, x1: 690, y1: 1070 } },
        ]),
      },
      "6600.00",
      "6,600.00",
    ]);
    mocks.createWorker.mockReset().mockResolvedValueOnce(mixedWorker);

    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrAmountSatang).toBe(660000);
    expect(mixedWorker.recognize).toHaveBeenCalledTimes(4);
  });

  it("rejects conflicting field passes instead of trusting the full receipt", async () => {
    const mixedWorker = worker([
      {
        text: "โอนเงินสำเร็จ\nไปยัง นางสาว พีรพร บุญสนิท\nจำนวน:\n5900.00 บาท",
        blocks: blocks([
          { text: "จำนวน:", confidence: 80, bbox: { x0: 70, y0: 900, x1: 250, y1: 955 } },
          { text: "5900.00 บาท", confidence: 58, bbox: { x0: 390, y0: 948, x1: 690, y1: 1010 } },
        ]),
      },
      "5900.00",
      "5800.00",
    ]);
    mocks.createWorker.mockReset().mockResolvedValueOnce(mixedWorker);

    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrAmountSatang).toBeNull();
    expect(result.reasons).toContain("OCR_AMOUNT_AMBIGUOUS");
  });

  it("keeps a one-pass labelled amount in review until an independent pass agrees", async () => {
    const mixedWorker = worker([{
      text: "โอนเงินสำเร็จ\nไปยัง นางสาว พีรพร บุญสนิท\nจำนวนเงิน 5,900.00 บาท",
      blocks: blocks([
        { text: "จำนวนเงิน 5,900.00 บาท", confidence: 77, bbox: { x0: 70, y0: 900, x1: 690, y1: 955 } },
      ]),
    }]);
    mocks.createWorker.mockReset().mockResolvedValueOnce(mixedWorker);

    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrAmountSatang).toBeNull();
    expect(result.reasons).toContain("OCR_AMOUNT_NO_CANDIDATE");
    expect(mixedWorker.recognize).toHaveBeenCalledTimes(4);
  });

  it("uses labelled two-pass text recovery when layout blocks are unavailable", async () => {
    const mixedWorker = worker([
      "โอนเงินสำเร็จ\nไปยัง นางสาว พีรพร บุญสนิท\nจำนวน: noise 5900.00 บาท\nค่าธรรมเนียม 0.00 บาท",
      "โอนเงินสำเร็จ\nจำนวนเงิน 5,900.00 บาท\nค่าธรรมเนียม 0.00 บาท",
    ]);
    mocks.createWorker.mockReset().mockResolvedValueOnce(mixedWorker);

    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrAmountSatang).toBe(590000);
    expect(result.reasons).toContain("OCR_LAYOUT_UNAVAILABLE");
    expect(mixedWorker.recognize).toHaveBeenCalledTimes(2);
  });

  it("retains QR authority and emits a fixed diagnostic when primary OCR fails", async () => {
    const failedWorker = {
      recognize: vi.fn(async () => { throw new Error("private OCR failure"); }),
      setParameters: vi.fn(async () => undefined),
      terminate: vi.fn(async () => undefined),
    };
    mocks.createWorker.mockReset().mockResolvedValueOnce(failedWorker);
    mocks.selectSlipQrPayload.mockReturnValue({
      payload: "slip-qr",
      parsed: { valid: true, fields: {}, transactionReference: "TXN-100", sendingBankCode: "004", countryCode: "TH" },
      qrValid: true,
      ambiguous: false,
    });

    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result).toMatchObject({ qrValid: true, transactionRef: "TXN-100", originatingBank: "004", ocrAmountSatang: null });
    expect(result.reasons).toContain("OCR_PASS_FAILED");
    expect(JSON.stringify(result.reasons)).not.toContain("private OCR failure");
    expect(failedWorker.terminate).toHaveBeenCalledOnce();
  });

  it("recovers a configured Thai receiver after mixed OCR produces Wsws", async () => {
    const result = await analyzeSlip(image, "image/png", ["นางสาว พีรพร บุญสนิท"]);

    expect(result.ocrReceiver).toBe("นางสาว พีรพร บุญสนิท");
    expect(mocks.createWorker).toHaveBeenNthCalledWith(1, ["eng", "tha"], undefined, expect.objectContaining({ langPath: expect.any(String), cacheMethod: "none" }));
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
    expect(thaiWorker.recognize).toHaveBeenCalledTimes(2);
    expect(thaiWorker.setParameters).toHaveBeenCalledOnce();
  });
});

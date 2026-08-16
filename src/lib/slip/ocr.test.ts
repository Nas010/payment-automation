import { describe, expect, it } from "vitest";
import {
  amountRegionFromOcrLines,
  amountFromLabelledOcrLines,
  extractCommonThaiSlipFields,
  recoverAmountFromOcrTexts,
  recoverLabelledAmountFromOcrTexts,
  recoverReceiverFromOcrTexts,
  receiverFromOcrText,
} from "./ocr";

describe("structured amount recovery", () => {
  it("accepts one unambiguous amount printed on its label line", () => {
    expect(amountFromLabelledOcrLines([
      { text: "จำนวนเงิน 5,900.00 บาท", confidence: 77, bbox: { x0: 70, y0: 900, x1: 690, y1: 955 } },
      { text: "ค่าธรรมเนียม 0.00 บาท", confidence: 95, bbox: { x0: 70, y0: 1015, x1: 690, y1: 1070 } },
    ])).toBe(590000);
  });

  it("bounds the amount region before the fee line", () => {
    const region = amountRegionFromOcrLines([
      { text: "เลขที่รายการ: 016228095101APP00991", confidence: 91, bbox: { x0: 70, y0: 760, x1: 650, y1: 820 } },
      { text: "จำนวน:", confidence: 80, bbox: { x0: 70, y0: 900, x1: 250, y1: 955 } },
      { text: "5,900.00 บาท", confidence: 58, bbox: { x0: 390, y0: 948, x1: 690, y1: 1010 } },
      { text: "ค่าธรรมเนียม:", confidence: 78, bbox: { x0: 70, y0: 1015, x1: 330, y1: 1070 } },
      { text: "0.00 บาท", confidence: 95, bbox: { x0: 500, y0: 1080, x1: 690, y1: 1135 } },
    ], 1100, 1400);

    expect(region).toEqual({ left: 62, top: 892, width: 636, height: 126 });
  });

  it("uses confidence only to choose between competing amount labels", () => {
    const region = amountRegionFromOcrLines([
      { text: "Amount", confidence: 22, bbox: { x0: 20, y0: 100, x1: 180, y1: 150 } },
      { text: "จำนวนเงิน", confidence: 88, bbox: { x0: 70, y0: 900, x1: 250, y1: 955 } },
      { text: "5,900.00 บาท", confidence: 58, bbox: { x0: 390, y0: 948, x1: 690, y1: 1010 } },
    ], 1100, 1400);

    expect(region).toEqual({ left: 62, top: 892, width: 636, height: 126 });
  });

  it.each([
    "จ ้ า น ว น :",
    "จ ํ า แว น บ",
    "ข ํ า น ว น เ ง ิ น",
  ])("finds amount regions after conservative Thai label OCR corruption: %s", (label) => {
    const region = amountRegionFromOcrLines([
      { text: label, confidence: 76, bbox: { x0: 70, y0: 900, x1: 250, y1: 955 } },
      { text: "6,600.00 บาท", confidence: 61, bbox: { x0: 390, y0: 948, x1: 690, y1: 1010 } },
      { text: "ค่าธรรมเนียม 0.00 บาท", confidence: 90, bbox: { x0: 70, y0: 1015, x1: 690, y1: 1070 } },
    ], 1100, 1400);

    expect(region).toEqual({ left: 62, top: 892, width: 636, height: 126 });
  });

  it("includes a money value whose larger text box begins slightly above its label", () => {
    const region = amountRegionFromOcrLines([
      { text: "4,000.00 บาท", confidence: 94, bbox: { x0: 390, y0: 892, x1: 690, y1: 960 } },
      { text: "จ ํ า น ว น เ ง ิ น", confidence: 92, bbox: { x0: 70, y0: 900, x1: 250, y1: 955 } },
      { text: "ค่าธรรมเนียม 0.00 บาท", confidence: 94, bbox: { x0: 70, y0: 1015, x1: 690, y1: 1070 } },
    ], 1100, 1400);

    expect(region).toEqual({ left: 62, top: 884, width: 636, height: 84 });
  });

  it("does not mistake unrelated Thai field labels for an amount label", () => {
    expect(amountRegionFromOcrLines([
      { text: "ค่าธรรมเนียม 0.00 บาท", confidence: 90, bbox: { x0: 70, y0: 900, x1: 690, y1: 955 } },
      { text: "เลขที่รายการ 016222104126APP12168", confidence: 90, bbox: { x0: 70, y0: 1015, x1: 690, y1: 1070 } },
    ], 1100, 1400)).toBeNull();
  });

  it.each([
    ["5,900.00", "5900.00", 590000],
    ["5900.00", "5,900.00", 590000],
    ["5 900.00", "5900.00", 590000],
    ["0\n3,900.00...", "3,900.00", 390000],
  ])("accepts matching Arabic money formats from two passes", (normal, thresholded, expected) => {
    expect(recoverAmountFromOcrTexts([normal, thresholded])).toEqual({ amountSatang: expected, status: "RECOVERED" });
  });

  it("rejects one-pass, conflicting, and multi-value recovery", () => {
    expect(recoverAmountFromOcrTexts(["5900.00", ""])).toEqual({ amountSatang: null, status: "NO_CANDIDATE" });
    expect(recoverAmountFromOcrTexts(["5900.00", "5,800.00"])).toEqual({ amountSatang: null, status: "AMBIGUOUS" });
    expect(recoverAmountFromOcrTexts(["5900.00 1,200.00", "5900.00"])).toEqual({ amountSatang: null, status: "AMBIGUOUS" });
  });

  it("requires matching labelled values when layout blocks are unavailable", () => {
    expect(recoverLabelledAmountFromOcrTexts([
      "เลขที่รายการ 016228095101APP00991\nจำนวน: noise 5900.00 บาท\nค่าธรรมเนียม 0.00 บาท",
      "เลขที่รายการ 016228095101APP00991\nจำนวนเงิน 5,900.00 บาท\nค่าธรรมเนียม 0.00 บาท",
    ])).toEqual({ amountSatang: 590000, status: "RECOVERED" });
    expect(recoverLabelledAmountFromOcrTexts([
      "จำนวน 5900.00 บาท",
      "จำนวน 5800.00 บาท",
    ])).toEqual({ amountSatang: null, status: "AMBIGUOUS" });
  });

  it("does not treat zero fees, references, dates, Thai digits, or continental decimals as recovered amounts", () => {
    expect(recoverAmountFromOcrTexts(["0.00", "0.00"])).toEqual({ amountSatang: null, status: "NO_CANDIDATE" });
    expect(recoverAmountFromOcrTexts(["016228095101APP00991", "016228095101APP00991"])).toEqual({ amountSatang: null, status: "NO_CANDIDATE" });
    expect(recoverAmountFromOcrTexts(["16.08.69", "16.08.69"])).toEqual({ amountSatang: null, status: "NO_CANDIDATE" });
    expect(recoverAmountFromOcrTexts(["๕๙๐๐.๐๐", "๕๙๐๐.๐๐"])).toEqual({ amountSatang: null, status: "NO_CANDIDATE" });
    expect(recoverAmountFromOcrTexts(["5.900,00", "5.900,00"])).toEqual({ amountSatang: null, status: "NO_CANDIDATE" });
  });
});

describe("receiverFromOcrText", () => {
  it("finds configured aliases despite whitespace and punctuation", () => {
    expect(receiverFromOcrText("TO: Nasreddine  Ouchene", ["Nasreddine Ouchene", "N. Ouchene"])).toBe("Nasreddine Ouchene");
  });

  it("extracts the shared fields found in Thai bank transfer slips", () => {
    const fields = extractCommonThaiSlipFields(`
      Krungthai
      โอนเงินสำเร็จ
      รหัสอ้างอิง: REF-EXAMPLE-001
      ไปยัง ผู้รับตัวอย่าง พร้อมเพย์ XXX-XXX-8717
      จำนวนเงิน 4,000.00 บาท
      28 ก.ค. 2569 - 18:29
    `);

    expect(fields).toMatchObject({
      bank: "Krungthai",
      success: true,
      reference: "REF-EXAMPLE-001",
      amountSatang: 400000,
      recipientProxySuffix: "8717",
      transactionDate: "2026-07-28T11:29:00.000Z",
    });
  });

  it("supports Make, K+, and SCB wording plus short Buddhist Era years", () => {
    const make = extractCommonThaiSlipFields("make by KBank โอนเงินสำเร็จ เลขที่รายการ: REF-MAKE-42 จำนวน 3,900.00 บาท XXX-XXX-8717 02 ส.ค. 2569 17:24");
    const kplus = extractCommonThaiSlipFields("K+ โอนเงินสำเร็จ เลขที่รายการ: REF-KPLUS-77 จำนวน: 6,600.00 บาท XXX-XXX-8717 10 ส.ค. 69 10:41 น.");
    const scb = extractCommonThaiSlipFields("SCB โอนเงินสำเร็จ รหัสอ้างอิง: REF-SCB-99 จำนวนเงิน 3,900.00 XXX-XXX-8717 20 ก.ค. 2569 - 16:23");

    expect(make).toMatchObject({ bank: "KBank", amountSatang: 390000, recipientProxySuffix: "8717", transactionDate: "2026-08-02T10:24:00.000Z" });
    expect(kplus).toMatchObject({ bank: "K+", amountSatang: 660000, recipientProxySuffix: "8717", transactionDate: "2026-08-10T03:41:00.000Z" });
    expect(scb).toMatchObject({ bank: "SCB", amountSatang: 390000, recipientProxySuffix: "8717", transactionDate: "2026-07-20T09:23:00.000Z" });
  });

  it.each([
    ["02 a.n. 2569 17:24", "2026-08-02T10:24:00.000Z"],
    ["วันที่ทำรายการ 28 n.A. 2569 - 18:29", "2026-07-28T11:29:00.000Z"],
  ])("normalizes constrained Latin-lookalike Thai month OCR: %s", (text, expected) => {
    expect(extractCommonThaiSlipFields(text).transactionDate).toBe(expected);
  });

  it("normalizes character-spaced Thai OCR without changing the monetary value", () => {
    const text = `
      โอ น เ ง ิ น ส ํ า เ ร ็ จ
      10 ส . ค . 69 14:34 น . K+
      ธ . ก ส ิ ก ร ไ ท ย
      น า ง ส า ว พ ิ ม พ ์ ใ จ ท ด ส อ บ
      ร ห ั ส พ ร ้ อ ม เ พ ย ์ XXX-XXX-8717
      เ ล ข ท ี ่ ร า ย ก า ร : REF-ROBUST-001
      จ ำ : OCR-NOISE น ว น : 1.00 บ า ท
      ค ่ า ธร ร ม เน ี ย ม : 0.00 บ า ท
    `;

    expect(extractCommonThaiSlipFields(text)).toMatchObject({
      bank: "K+",
      success: true,
      reference: "REF-ROBUST-001",
      amountSatang: 100,
      recipientProxySuffix: "8717",
      transactionDate: "2026-08-10T07:34:00.000Z",
    });
    expect(receiverFromOcrText(text, ["นางสาว พิมพ์ใจ ทดสอบ"])).toBe("นางสาว พิมพ์ใจ ทดสอบ");
  });

  it("extracts an ungrouped amount after a short OCR-noise gap without selecting the fee", () => {
    const fields = extractCommonThaiSlipFields(`
      โอ น เง ิ น ส ํ า เร ็ จ
      เล ข ท ี ่ ร า ย ก า ร : 016228095101APP00991
      จ ํ า น ว น : ระ โร
      5900.00 "no rE :
      ค ่ า ธร ร ม เน ี ย ม :
      0.00 บ า ท
      16 ส . ค . 69 09:51 น .
    `);

    expect(fields.amountSatang).toBe(590000);
  });

  it("recovers a configured Thai receiver from independent near-match OCR candidates", () => {
    expect(recoverReceiverFromOcrTexts([
      "ไปยัง นางสาว Wsws บุญสนิท XXX-XXX-8717",
      "ไปยัง นางสาว พ่ธพร บุญสนิท XXX-XXX-8717 จำนวนเงิน 9,730.00",
      "ผู้รับ นางสาว พีรพ บุญสนก XXX-XXX-8717",
    ], ["นางสาว พีรพร บุญสนิท"])).toBe("นางสาว พีรพร บุญสนิท");
  });

  it("matches a configured Thai receiver when the slip omits its title", () => {
    expect(receiverFromOcrText("พีรพร บุญสนิท", ["นางสาว พีรพร บุญสนิท"])).toBe("นางสาว พีรพร บุญสนิท");
  });

  it("recovers an unlabeled Thai receiver from two independent name lines", () => {
    expect(recoverReceiverFromOcrTexts([
      "โอนเงินสำเร็จ\nพรพร บุญสนิท\nXXX-XXX-8717",
      "โอนเงินสำเร็จ\nพฟิรพร บุญสนิท\nXXX-XXX-8717",
    ], ["นางสาว พีรพร บุญสนิท"])).toBe("นางสาว พีรพร บุญสนิท");
  });

  it("keeps close competing unlabeled Thai receiver aliases in review", () => {
    expect(recoverReceiverFromOcrTexts([
      "พีรพน บุญสนิท\nXXX-XXX-8717",
      "พีรพน บุญสนิท\nXXX-XXX-8717",
    ], ["นางสาว พีรพร บุญสนิท", "นางสาว พีรพน บุญสนิทท"])).toBeNull();
  });

  it("does not fuzzy-match an unlabeled Thai name without adjacent masked account evidence", () => {
    expect(recoverReceiverFromOcrTexts([
      "พรพร บุญสนิท\nโอนเงินสำเร็จ",
      "พฟิรพร บุญสนิท\nโอนเงินสำเร็จ",
    ], ["นางสาว พีรพร บุญสนิท"])).toBeNull();
  });

  it("does not recover a receiver from one weak Thai candidate or English-only text", () => {
    expect(recoverReceiverFromOcrTexts([
      "ไปยัง นางสาว กขคงจฉชซฌญ XXX-XXX-8717",
    ], ["นางสาว พีรพร บุญสนิท"])).toBeNull();
    expect(recoverReceiverFromOcrTexts([
      "to Nisa Exampel",
      "recipient Nisa Exampel",
    ], ["Nisa Example"])).toBeNull();
  });

  it("keeps close competing Thai aliases in review", () => {
    expect(recoverReceiverFromOcrTexts([
      "ไปยัง นางสาว พีรพน บุญสนิท XXX-XXX-8717",
      "ผู้รับ นางสาว พีรพน บุญสนิท XXX-XXX-8717",
    ], ["นางสาว พีรพร บุญสนิท", "นางสาว พีรพน บุญสนิทท"])).toBeNull();
  });
});

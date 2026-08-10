import { describe, expect, it } from "vitest";
import { extractCommonThaiSlipFields, receiverFromOcrText } from "./ocr";

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
});

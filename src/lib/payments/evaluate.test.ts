import { describe, expect, it } from "vitest";
import { evaluatePayment, sendToReviewForStorageFailure } from "./evaluate";

const payment = { paymentId: "pay_1", amountSatang: 300000, createdAt: "2026-08-01T00:00:00.000Z", receiverAliases: ["NAS O"], timezone: "Asia/Bangkok" };

describe("evaluatePayment", () => {
  it("auto-records a complete unique match", () => {
    expect(evaluatePayment(payment, { imageDuplicate: false, transactionDuplicate: false, qrValid: true, transactionRef: "TX1", amountSatang: 300000, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" }).decision).toBe("AUTO_RECORDED");
  });

  it("flags a transaction allocated to another payment", () => {
    expect(evaluatePayment(payment, { imageDuplicate: false, transactionDuplicate: true, qrValid: true, transactionRef: "TX1", amountSatang: 300000, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" }).decision).toBe("FLAGGED");
  });

  it.each([
    ["missing QR", { imageDuplicate: false, transactionDuplicate: false, qrValid: false, transactionRef: "TX1", amountSatang: 300000, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" }],
    ["uncertain recipient", { imageDuplicate: false, transactionDuplicate: false, qrValid: true, transactionRef: "TX1", amountSatang: 300000, receiver: null, transactionDate: "2026-08-10T04:00:00.000Z" }],
  ])("sends %s to review", (_label, signals) => {
    expect(evaluatePayment(payment, signals).decision).toBe("REVIEW");
  });

  it.each([
    ["different amount", { imageDuplicate: false, transactionDuplicate: false, qrValid: true, transactionRef: "TX1", amountSatang: 299900, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" }],
    ["duplicate image", { imageDuplicate: true, transactionDuplicate: false, qrValid: true, transactionRef: "TX1", amountSatang: 300000, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" }],
  ])("flags %s", (_label, signals) => {
    expect(evaluatePayment(payment, signals).decision).toBe("FLAGGED");
  });

  it("keeps a receipt actionable when private exception storage fails", () => {
    const original = evaluatePayment(payment, { imageDuplicate: false, transactionDuplicate: false, qrValid: true, transactionRef: "TX1", amountSatang: 300000, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" });
    expect(sendToReviewForStorageFailure(original)).toMatchObject({ decision: "REVIEW", reasons: expect.arrayContaining(["Private slip storage failed; manual review is required"]) });
  });
});

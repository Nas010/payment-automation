import { describe, expect, it } from "vitest";
import { evaluatePayment } from "./evaluate";

const payment = { paymentId: "pay_1", amountSatang: 300000, createdAt: "2026-08-01T00:00:00.000Z", receiverAliases: ["NAS O"], timezone: "Asia/Bangkok" };

describe("evaluatePayment", () => {
  it("auto-records a complete unique match", () => {
    expect(evaluatePayment(payment, { imageDuplicate: false, transactionDuplicate: false, qrValid: true, transactionRef: "TX1", amountSatang: 300000, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" }).decision).toBe("AUTO_RECORDED");
  });

  it("flags a transaction allocated to another payment", () => {
    expect(evaluatePayment(payment, { imageDuplicate: false, transactionDuplicate: true, qrValid: true, transactionRef: "TX1", amountSatang: 300000, receiver: "NAS O", transactionDate: "2026-08-10T04:00:00.000Z" }).decision).toBe("FLAGGED");
  });
});

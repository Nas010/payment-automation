import { describe, expect, it } from "vitest";
import { transitionPayment } from "./transition";

describe("transitionPayment", () => {
  it("marks linked schedule paid when a review payment is manually confirmed", () => {
    const result = transitionPayment({ paymentStatus: "REVIEW", scheduleStatus: "GENERATED", nextStatus: "MANUAL_CONFIRMED" });

    expect(result).toEqual({ paymentStatus: "MANUAL_CONFIRMED", scheduleStatus: "PAID" });
  });

  it("rejects a manual attempt to assign the system-only automatic status", () => {
    expect(() => transitionPayment({ paymentStatus: "REVIEW", scheduleStatus: "GENERATED", nextStatus: "AUTO_RECORDED", source: "ADMIN" })).toThrow("AUTO_RECORDED is system-only");
  });
});

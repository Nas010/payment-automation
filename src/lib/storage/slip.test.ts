import { describe, expect, it } from "vitest";
import { shouldRetainSlip } from "./slip";

describe("shouldRetainSlip", () => {
  it("retains exception evidence but not automatic receipts by default", () => {
    expect(shouldRetainSlip("REVIEW", 30)).toBe(true);
    expect(shouldRetainSlip("FLAGGED", 30)).toBe(true);
    expect(shouldRetainSlip("AUTO_RECORDED", 30)).toBe(false);
  });
});

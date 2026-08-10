import { describe, expect, it } from "vitest";
import { needsManualConfirmationAudit } from "./manual-confirmation";

describe("needsManualConfirmationAudit", () => {
  it("detects an unrecorded spreadsheet manual confirmation", () => {
    expect(needsManualConfirmationAudit({ status: "MANUAL_CONFIRMED", manual_confirmed_at: "" })).toBe(true);
    expect(needsManualConfirmationAudit({ status: "MANUAL_CONFIRMED", manual_confirmed_at: "2026-08-10T00:00:00Z" })).toBe(false);
  });
});

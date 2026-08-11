import { describe, expect, it } from "vitest";
import { formatClientDirectoryCount, formatPaymentProgress } from "./client-display";

describe("client display helpers", () => {
  it("formats directory count as a compact heading suffix", () => {
    expect(formatClientDirectoryCount(3)).toBe("(3)");
    expect(formatClientDirectoryCount(0)).toBe("(0)");
  });

  it("formats payment progress in plain language", () => {
    expect(formatPaymentProgress(0, 1)).toBe("0 of 1 paid");
    expect(formatPaymentProgress(2, 3)).toBe("2 of 3 paid");
  });
});

import { describe, expect, it } from "vitest";
import { formatRoundedThb, parseSatang } from "./money";

describe("parseSatang", () => {
  it.each([["฿3,000", 300000], ["3,000.00", 300000], ["3000", 300000], ["THB 3,000.00", 300000]])("normalizes %s", (input, expected) => {
    expect(parseSatang(input)).toBe(expected);
  });
});

describe("formatRoundedThb", () => {
  it("rounds satang to full Thai baht without decimals", () => {
    expect(formatRoundedThb(75_049)).toBe("฿750");
    expect(formatRoundedThb(75_050)).toBe("฿751");
  });
});

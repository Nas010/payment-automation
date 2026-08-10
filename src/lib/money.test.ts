import { describe, expect, it } from "vitest";
import { parseSatang } from "./money";

describe("parseSatang", () => {
  it.each([["฿3,000", 300000], ["3,000.00", 300000], ["3000", 300000], ["THB 3,000.00", 300000]])("normalizes %s", (input, expected) => {
    expect(parseSatang(input)).toBe(expected);
  });
});


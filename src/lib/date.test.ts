import { describe, expect, it } from "vitest";
import { parseThaiSlipDate } from "./date";

describe("parseThaiSlipDate", () => {
  it("converts Buddhist Era dates", () => {
    expect(parseThaiSlipDate("10/08/2569", "Asia/Bangkok")?.toISOString().slice(0, 10)).toBe("2026-08-09");
  });

  it("parses Thai month names and two-digit Buddhist Era years", () => {
    expect(parseThaiSlipDate("10 ส.ค. 69", "Asia/Bangkok")?.toISOString().slice(0, 10)).toBe("2026-08-09");
  });
});

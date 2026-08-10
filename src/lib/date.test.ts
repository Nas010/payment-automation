import { describe, expect, it } from "vitest";
import * as date from "./date";
import { parseThaiSlipDate } from "./date";

describe("parseThaiSlipDate", () => {
  it("converts Buddhist Era dates", () => {
    expect(parseThaiSlipDate("10/08/2569", "Asia/Bangkok")?.toISOString().slice(0, 10)).toBe("2026-08-09");
  });

  it("parses Thai month names and two-digit Buddhist Era years", () => {
    expect(parseThaiSlipDate("10 ส.ค. 69", "Asia/Bangkok")?.toISOString().slice(0, 10)).toBe("2026-08-09");
  });

  it("formats Bangkok calendar dates without UTC day drift", () => {
    const formatDate = (date as Record<string, unknown>).formatDate;
    expect(formatDate).toBeTypeOf("function");
    if (typeof formatDate !== "function") return;
    expect(formatDate("2026-08-10")).toBe("10 Aug 2026");
    expect(formatDate("2026-08-10T00:30:00.000Z")).toBe("10 Aug 2026");
  });

  it("formats timestamps in Bangkok time", () => {
    const formatDateTime = (date as Record<string, unknown>).formatDateTime;
    expect(formatDateTime).toBeTypeOf("function");
    if (typeof formatDateTime !== "function") return;
    expect(formatDateTime("2026-08-10T08:20:45.439Z")).toBe("10 Aug 2026, 15:20");
  });

  it("renders unavailable display dates as an em dash", () => {
    const formatDate = (date as Record<string, unknown>).formatDate;
    const formatDateTime = (date as Record<string, unknown>).formatDateTime;
    expect(formatDate).toBeTypeOf("function");
    expect(formatDateTime).toBeTypeOf("function");
    if (typeof formatDate !== "function" || typeof formatDateTime !== "function") return;
    expect(formatDate("")).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

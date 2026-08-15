import { describe, expect, it } from "vitest";
import { formatCardinalWord, formatOrdinalNumber, formatOrdinalWord } from "./installment-language";

describe("installment language", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"],
    [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [112, "112th"],
  ])("formats numeric ordinal %i", (value, expected) => {
    expect(formatOrdinalNumber(value)).toBe(expected);
  });

  it.each([
    [1, "one"], [12, "twelve"], [21, "twenty one"],
    [105, "one hundred five"], [1_002, "one thousand two"],
  ])("formats cardinal word %i", (value, expected) => {
    expect(formatCardinalWord(value)).toBe(expected);
  });

  it.each([
    [1, "first"], [2, "second"], [3, "third"], [12, "twelfth"],
    [21, "twenty first"], [100, "one hundredth"], [1_002, "one thousand second"],
  ])("formats ordinal word %i", (value, expected) => {
    expect(formatOrdinalWord(value)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid installment value %s", (value) => {
    expect(() => formatCardinalWord(value)).toThrow(/positive safe integer/i);
    expect(() => formatOrdinalWord(value)).toThrow(/positive safe integer/i);
    expect(() => formatOrdinalNumber(value)).toThrow(/positive safe integer/i);
  });
});

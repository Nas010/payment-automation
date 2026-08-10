import { describe, expect, it } from "vitest";
import { receiverFromOcrText } from "./ocr";

describe("receiverFromOcrText", () => {
  it("finds configured aliases despite whitespace and punctuation", () => {
    expect(receiverFromOcrText("TO: Nasreddine  Ouchene", ["Nasreddine Ouchene", "N. Ouchene"])).toBe("Nasreddine Ouchene");
  });
});

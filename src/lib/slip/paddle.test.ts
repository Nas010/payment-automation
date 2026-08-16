import { describe, expect, it } from "vitest";
import { mapPaddleResponse } from "./paddle";

describe("PaddleOCR response mapping", () => {
  it("maps bounded recognition text, scores, and boxes into shared evidence", () => {
    const lines = mapPaddleResponse({
      version: 1,
      variants: [
        { id: "PADDLE_COLOR", items: [{ text: "ไปยัง", score: 0.98, box: [10, 20, 100, 40] }] },
        { id: "PADDLE_CLAHE", items: [{ text: "5,900.00", score: 0.91, box: [300, 500, 500, 550] }] },
      ],
    });
    expect(lines).toEqual([
      expect.objectContaining({ text: "ไปยัง", confidence: 0.98, engine: "PADDLE", variant: "BASELINE", bbox: { x0: 10, y0: 20, x1: 100, y1: 40 } }),
      expect.objectContaining({ text: "5,900.00", confidence: 0.91, engine: "PADDLE", variant: "CLAHE" }),
    ]);
  });
});

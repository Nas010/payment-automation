import { describe, expect, it } from "vitest";
import { sha256 } from "./hash";

describe("sha256", () => {
  it("returns a stable non-image-specific duplicate identifier", () => {
    expect(sha256(new Uint8Array([1, 2, 3]))).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
  });
});

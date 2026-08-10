import { describe, expect, it } from "vitest";
import { validateImageUpload } from "./validate";

describe("validateImageUpload", () => {
  it("accepts valid PNG signatures", async () => {
    const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(validateImageUpload({ bytes: data, declaredType: "image/png", size: data.byteLength })).resolves.toMatchObject({ ok: true, type: "image/png" });
  });

  it("rejects a mismatched declared image type", async () => {
    const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(validateImageUpload({ bytes: data, declaredType: "image/jpeg", size: data.byteLength })).resolves.toMatchObject({ ok: false });
  });
});

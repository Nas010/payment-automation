import { describe, expect, it } from "vitest";
import { createPublicToken } from "./token";

describe("createPublicToken", () => {
  it("creates opaque 256-bit URL-safe tokens", () => {
    const token = createPublicToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

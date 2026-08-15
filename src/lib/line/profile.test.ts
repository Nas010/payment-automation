import { describe, expect, it } from "vitest";
import { normalizeLinePictureUrl } from "./profile";

describe("normalizeLinePictureUrl", () => {
  it("keeps HTTPS LINE profile CDN URLs", () => {
    expect(normalizeLinePictureUrl("https://profile.line-scdn.net/avatar/path?size=large")).toBe("https://profile.line-scdn.net/avatar/path?size=large");
  });

  it.each([
    undefined,
    "",
    "http://profile.line-scdn.net/avatar",
    "https://attacker.example/avatar",
    "not-a-url",
  ])("removes unsafe picture value %s", (value) => {
    expect(normalizeLinePictureUrl(value)).toBe("");
  });
});

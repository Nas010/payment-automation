import { describe, expect, it } from "vitest";
import { lineProfilePictureStatus, normalizeLinePictureUrl } from "./profile";

describe("normalizeLinePictureUrl", () => {
  it("keeps HTTPS picture URLs returned by LINE's authenticated profile API", () => {
    expect(normalizeLinePictureUrl("https://profile.line-scdn.net/avatar/path?size=large")).toBe("https://profile.line-scdn.net/avatar/path?size=large");
    expect(normalizeLinePictureUrl("https://obs.line-apps.com/avatar/path")).toBe("https://obs.line-apps.com/avatar/path");
    expect(normalizeLinePictureUrl("https://profile-cdn.example.test/avatar/path")).toBe("https://profile-cdn.example.test/avatar/path");
  });

  it.each([
    undefined,
    "",
    "http://profile.line-scdn.net/avatar",
    "ftp://profile.line-scdn.net/avatar",
    "not-a-url",
  ])("removes unsafe picture value %s", (value) => {
    expect(normalizeLinePictureUrl(value)).toBe("");
  });

  it("classifies absent and rejected images without returning their value", () => {
    expect(lineProfilePictureStatus(undefined)).toBe("missing");
    expect(lineProfilePictureStatus("ftp://profile.line-scdn.net/avatar")).toBe("rejected");
  });
});

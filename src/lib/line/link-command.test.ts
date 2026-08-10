import { describe, expect, it } from "vitest";
import { parseLineLinkCommand } from "./link-command";

describe("parseLineLinkCommand", () => {
  it("accepts only an exact LINK command and normalizes its code", () => {
    expect(parseLineLinkCommand("LINK abcdef0123")).toBe("ABCDEF0123");
  });

  it.each(["LINK", "LINK ABCDEF012", "LINK ABCDEF01234", "LINK ABCDEG0123", " link ABCDEF0123", "LINK  ABCDEF0123", "HELLO ABCDEF0123", "LINK ABCDEF0123 now", "LINK ABCDEF0123\n"])("rejects non-LINK or malformed commands: %j", (text) => {
    expect(parseLineLinkCommand(text)).toBeNull();
  });
});

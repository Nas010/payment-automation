import { describe, expect, it } from "vitest";
import { parseLineLinkCommand } from "./link-command";

describe("parseLineLinkCommand", () => {
  it("accepts case-insensitive LINK input with outer or command spacing and normalizes its code", () => {
    expect(parseLineLinkCommand("  link   abcdef0123  \n")).toBe("ABCDEF0123");
  });

  it.each(["LINK", "LINK ABCDEF012", "LINK ABCDEF01234", "LINK ABCDEG0123", "HELLO ABCDEF0123", "LINK ABCDEF0123 now", "LINK ABCDEF0123\nnow"])("rejects non-LINK or malformed commands: %j", (text) => {
    expect(parseLineLinkCommand(text)).toBeNull();
  });
});

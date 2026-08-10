import { describe, expect, it } from "vitest";
import { renderLineLinkInstruction } from "./link-message";

describe("renderLineLinkInstruction", () => {
  it("renders an exact copyable LINK command for the client", () => {
    expect(renderLineLinkInstruction({ clientName: "Nisa", code: "ABCDEF0123" })).toBe("Hi Nisa, reply with this exact message to link your LINE account:\nLINK ABCDEF0123");
  });
});

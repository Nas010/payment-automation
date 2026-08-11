import { describe, expect, it, vi } from "vitest";

const { randomBytes } = vi.hoisted(() => ({ randomBytes: vi.fn() }));
vi.mock("node:crypto", () => ({ randomBytes }));

import { createLineLinkCode, expiresAt } from "./link-code";

describe("LINE link code", () => {
  it("creates a cryptographically random uppercase ten-character hexadecimal code", () => {
    randomBytes.mockReturnValueOnce(Buffer.from([0xab, 0xcd, 0xef, 0x01, 0x23]));

    expect(createLineLinkCode()).toBe("ABCDEF0123");
    expect(randomBytes).toHaveBeenCalledWith(5);
  });

  it("expires exactly seven days after the supplied instant", () => {
    expect(expiresAt("2026-08-10T12:34:56.000Z")).toBe("2026-08-17T12:34:56.000Z");
  });
});

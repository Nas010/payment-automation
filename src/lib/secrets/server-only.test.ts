import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("secret server boundary", () => {
  it("rejects browser runtime imports", async () => {
    vi.stubGlobal("window", {});

    await expect(import("./server-only")).rejects.toThrow("Secret modules are server-only");
  });
});

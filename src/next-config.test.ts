import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadNextConfig() {
  vi.resetModules();
  return (await import("../next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Next build output", () => {
  it("keeps production builds in the default .next directory", async () => {
    expect((await loadNextConfig()).distDir).toBe(".next");
  });

  it("allows development to use an isolated output directory", async () => {
    vi.stubEnv("NEXT_DIST_DIR", ".next-dev");
    expect((await loadNextConfig()).distDir).toBe(".next-dev");
  });

  it("starts development with the isolated output directory", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts.dev).toBe("NEXT_DIST_DIR=.next-dev next dev");
  });
});

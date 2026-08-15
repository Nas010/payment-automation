import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGet, getInstallation } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getInstallation: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("@/lib/installation/repository", () => ({ getInstallation }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("ADMIN_SECRET", "secret-value");
});

describe("admin session backend failures", () => {
  it("propagates a Sheets quota error instead of treating the owner as logged out", async () => {
    const auth = await import("./admin-auth");
    cookieGet.mockReturnValue({ value: auth.createAdminSessionValue("secret-value", { googleSub: "google-sub-1", email: "owner@example.com" }) });
    getInstallation.mockRejectedValue(Object.assign(new Error("quota"), { response: { status: 429 } }));

    await expect(auth.getAdminSession()).rejects.toThrow("quota");
  });
});

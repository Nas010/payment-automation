import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import SettingsPage from "./page";

describe("SettingsPage", () => {
  it("redirects legacy Settings URL to Business settings", () => {
    SettingsPage();
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/settings/business");
  });
});

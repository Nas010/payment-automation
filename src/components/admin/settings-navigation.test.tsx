/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => createElement("a", { href, ...props }, children),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/settings/messages" }));

import { SettingsNavigation } from "./settings-navigation";

function renderNavigation() {
  return render(createElement(SidebarProvider, null, createElement(SettingsNavigation)));
}

describe("SettingsNavigation", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("marks current settings section and exposes every section route", () => {
    renderNavigation();

    expect(screen.getByRole("link", { name: "Messages" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Business & payments" }).getAttribute("href")).toBe("/admin/settings/business");
    expect(screen.getByRole("link", { name: "Workspace" }).getAttribute("href")).toBe("/admin/settings/workspace");
    expect(screen.getByRole("link", { name: "LINE channel" }).getAttribute("href")).toBe("/admin/settings/line");
    expect(screen.getByRole("link", { name: "Payment delivery" }).getAttribute("href")).toBe("/admin/settings/payment-delivery");
  });

  it("opens accessible mobile settings navigation", () => {
    renderNavigation();

    fireEvent.click(screen.getByRole("button", { name: "Open settings navigation" }));

    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText("Settings navigation")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Messages" })).toBeTruthy();
  });
});

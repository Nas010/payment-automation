/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/clients/new" }));
vi.mock("@/app/admin/login/actions", () => ({ logoutAction: vi.fn() }));

import { AdminShell } from "./admin-shell";

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

describe("AdminShell", () => {
  it("removes non-functional workspace and status chrome while keeping sign out", () => {
    render(createElement(AdminShell, null, createElement("p", null, "Page content")));

    expect(screen.queryByText("Admin workspace")).toBeNull();
    expect(screen.queryByText("Google Sheets · Connected")).toBeNull();
    expect(screen.queryByText("Admin session · Active")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

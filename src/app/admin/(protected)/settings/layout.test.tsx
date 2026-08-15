/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/admin/page-ui", () => ({
  PageHeader: ({ title }: { title: string }) => createElement("h1", null, title),
}));
vi.mock("@/components/admin/settings-navigation", () => ({
  SettingsNavigation: () => createElement("nav", { "aria-label": "Settings navigation" }),
}));
vi.mock("@/components/ui/separator", () => ({ Separator: () => createElement("hr") }));

import SettingsLayout from "./layout";

describe("SettingsLayout", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders child section content with the shared settings navigation", () => {
    render(createElement(SettingsLayout, null, createElement("p", null, "Business settings content")));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Settings navigation" })).toBeTruthy();
    expect(screen.getByText("Business settings content")).toBeTruthy();
  });
});

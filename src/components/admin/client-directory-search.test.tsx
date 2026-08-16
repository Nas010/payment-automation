/** @vitest-environment jsdom */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), pathname: "/admin/clients" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));

import { ClientDirectorySearch } from "./client-directory-search";

afterEach(() => {
  cleanup();
  mocks.replace.mockClear();
});

describe("ClientDirectorySearch", () => {
  it("updates the client query while typing without a submit button", () => {
    const { getByPlaceholderText, queryByRole } = render(<ClientDirectorySearch initialQuery="" />);

    fireEvent.change(getByPlaceholderText("Search name or LINE"), { target: { value: "nisa" } });

    expect(mocks.replace).toHaveBeenCalledWith("/admin/clients?q=nisa", { scroll: false });
    expect(queryByRole("button", { name: "Search" })).toBeNull();
  });

  it("removes the query parameter when search is cleared", () => {
    const { getByPlaceholderText } = render(<ClientDirectorySearch initialQuery="nisa" />);

    fireEvent.change(getByPlaceholderText("Search name or LINE"), { target: { value: "" } });

    expect(mocks.replace).toHaveBeenCalledWith("/admin/clients", { scroll: false });
  });
});

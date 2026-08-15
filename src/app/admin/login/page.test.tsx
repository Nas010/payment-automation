/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminLoginPage from "./page";

beforeEach(() => {
  vi.stubGlobal("React", React);
});

describe("admin login page", () => {
  it("offers Google ownership sign-in without a password field", async () => {
    render(await AdminLoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/admin/google-drive/connect?intent=login");
    expect(screen.queryByLabelText(/admin secret/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LineLinkActions } from "./line-link-actions";

const welcomeMessage = "Hi Nisa. Tap to connect: https://liff.line.me/1234567890-AbCdEf?token=secure-token";

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LineLinkActions", () => {
  it("copies the complete server-rendered welcome message without exposing a short code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { getByRole, queryByText } = render(createElement(LineLinkActions, { clientId: "client_1", status: "AWAITING", message: welcomeMessage, expiresAt: "2026-08-17T12:00:00.000Z", renewAction: vi.fn(), disconnectAction: vi.fn() }));

    fireEvent.click(getByRole("button", { name: "Copy welcome message" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(welcomeMessage));
    expect(getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(queryByText(/LINK [A-F0-9]{10}/)).toBeNull();
  });

  it("renders disconnect controls and linked profile details", () => {
    const { getByRole, getByText } = render(createElement(LineLinkActions, { clientId: "client_1", status: "LINKED", displayName: "Nisa LINE", linkedAt: "2026-08-10T12:00:00.000Z", renewAction: vi.fn(), disconnectAction: vi.fn() }));

    expect(getByText("Linked to Nisa LINE")).toBeTruthy();
    expect(getByRole("button", { name: "Disconnect LINE" })).toBeTruthy();
  });

  it("renders generation controls for unlinked and expired clients", () => {
    const { getByRole, rerender } = render(createElement(LineLinkActions, { clientId: "client_1", status: "UNLINKED", renewAction: vi.fn(), disconnectAction: vi.fn() }));
    expect(getByRole("button", { name: "Create new connection link" })).toBeTruthy();

    rerender(createElement(LineLinkActions, { clientId: "client_1", status: "EXPIRED", renewAction: vi.fn(), disconnectAction: vi.fn() }));
    expect(getByRole("button", { name: "Create new connection link" })).toBeTruthy();
  });

  it("renders a safe review state with renew and disconnect controls", () => {
    const { getByText, getByRole, queryByText } = render(createElement(LineLinkActions, { clientId: "client_1", status: "REVIEW", error: "LINE user conflict", renewAction: vi.fn(), disconnectAction: vi.fn() }));

    expect(getByText("LINE user conflict")).toBeTruthy();
    expect(getByRole("button", { name: "Create new connection link" })).toBeTruthy();
    expect(getByRole("button", { name: "Disconnect LINE" })).toBeTruthy();
    expect(queryByText("LINE access token")).toBeNull();
  });
});

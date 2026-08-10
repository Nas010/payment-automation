/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LineLinkActions } from "./line-link-actions";

const instruction = "Hi Nisa, reply with this exact message to link your LINE account:\nLINK ABCDEF0123";

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LineLinkActions", () => {
  it("copies the complete server-rendered linking instruction", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { getByRole } = render(createElement(LineLinkActions, { clientId: "client_1", status: "CODE_ACTIVE", instruction, expiresAt: "2026-08-17T12:00:00.000Z", renewAction: vi.fn(), disconnectAction: vi.fn() }));

    fireEvent.click(getByRole("button", { name: "Copy instructions" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(instruction));
    expect(getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("renders disconnect controls and linked profile details", () => {
    const { getByRole, getByText } = render(createElement(LineLinkActions, { clientId: "client_1", status: "LINKED", displayName: "Nisa LINE", linkedAt: "2026-08-10T12:00:00.000Z", renewAction: vi.fn(), disconnectAction: vi.fn() }));

    expect(getByText("Linked to Nisa LINE")).toBeTruthy();
    expect(getByRole("button", { name: "Disconnect LINE" })).toBeTruthy();
  });

  it("renders generation controls for unlinked and expired clients", () => {
    const { getByRole, rerender } = render(createElement(LineLinkActions, { clientId: "client_1", status: "UNLINKED", renewAction: vi.fn(), disconnectAction: vi.fn() }));
    expect(getByRole("button", { name: "Generate code" })).toBeTruthy();

    rerender(createElement(LineLinkActions, { clientId: "client_1", status: "EXPIRED", renewAction: vi.fn(), disconnectAction: vi.fn() }));
    expect(getByRole("button", { name: "Generate new code" })).toBeTruthy();
  });

  it("renders a safe review state with renew and disconnect controls", () => {
    const { getByText, getByRole, queryByText } = render(createElement(LineLinkActions, { clientId: "client_1", status: "REVIEW", error: "LINE user conflict", renewAction: vi.fn(), disconnectAction: vi.fn() }));

    expect(getByText("LINE user conflict")).toBeTruthy();
    expect(getByRole("button", { name: "Renew code" })).toBeTruthy();
    expect(getByRole("button", { name: "Disconnect LINE" })).toBeTruthy();
    expect(queryByText("LINE access token")).toBeNull();
  });
});

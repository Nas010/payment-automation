/** @vitest-environment jsdom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  isInClient: vi.fn(),
  isLoggedIn: vi.fn(),
  login: vi.fn(),
  getIDToken: vi.fn(),
  closeWindow: vi.fn(),
}));

vi.mock("@line/liff", () => ({ default: mocks }));

import { LineConnectClient } from "./line-connect-client";

const props = { liffId: "1234567890-AbCdEf", connectionToken: "A".repeat(43) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.init.mockResolvedValue(undefined);
  mocks.isInClient.mockReturnValue(true);
  mocks.isLoggedIn.mockReturnValue(true);
  mocks.getIDToken.mockReturnValue("raw.id.token");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success" }), { status: 200 })));
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LineConnectClient", () => {
  it("initializes LIFF, sends only raw ID token plus connection token, and offers Return to LINE", async () => {
    render(<LineConnectClient {...props} />);

    await screen.findByText("LINE account connected");
    expect(mocks.init).toHaveBeenCalledWith({ liffId: props.liffId });
    expect(fetch).toHaveBeenCalledWith("/api/line/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "raw.id.token", connectionToken: props.connectionToken }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Return to LINE" }));
    expect(mocks.closeWindow).toHaveBeenCalled();
  });

  it("starts LINE login outside LIFF when no login session exists", async () => {
    mocks.isLoggedIn.mockReturnValue(false);
    render(<LineConnectClient {...props} />);

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith({ redirectUri: window.location.href }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the restored LIFF URL token only after initialization completes", async () => {
    mocks.init.mockImplementationOnce(async () => {
      window.history.replaceState({}, "", `/?token=${props.connectionToken}`);
    });

    render(<LineConnectClient liffId={props.liffId} connectionToken="" />);

    await screen.findByText("LINE account connected");
    expect(mocks.init).toHaveBeenCalledWith({ liffId: props.liffId });
    expect(fetch).toHaveBeenCalledWith("/api/line/connect", expect.objectContaining({
      body: JSON.stringify({ idToken: "raw.id.token", connectionToken: props.connectionToken }),
    }));
  });

  it("closes back to LINE after an idempotent already-connected retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: "already_used" }), { status: 200 }));
    render(<LineConnectClient {...props} />);

    await screen.findByText("LINE account already connected");
    await waitFor(() => expect(mocks.closeWindow).toHaveBeenCalled(), { timeout: 1_200 });
  });

  it.each([
    ["already_used", "LINE account already connected"],
    ["expired", "Connection link expired"],
    ["conflict", "Connection needs review"],
    ["invalid", "Connection link is invalid"],
    ["temporary_failure", "Could not connect right now"],
  ])("renders %s API state", async (status, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status }), { status: status === "already_used" ? 200 : 400 }));
    render(<LineConnectClient {...props} />);

    await screen.findByText(message);
    expect(screen.getByRole("button", { name: "Return to LINE" })).toBeTruthy();
  });

  it("treats a missing ID token as invalid without calling backend", async () => {
    mocks.getIDToken.mockReturnValue(null);
    render(<LineConnectClient {...props} />);

    await screen.findByText("Connection link is invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports missing LIFF deployment configuration as a temporary failure", async () => {
    render(<LineConnectClient {...props} liffId="" />);

    await screen.findByText("Could not connect right now");
    expect(fetch).not.toHaveBeenCalled();
  });
});

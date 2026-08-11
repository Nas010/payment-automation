/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { GoogleDriveConnectionCard } from "./google-drive-connection-card";

const pickerLoad = vi.fn((_name: string, callback: () => void) => callback());
const pickerBuilder = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("gapi", { load: pickerLoad });
  vi.stubGlobal("google", { picker: { PickerBuilder: pickerBuilder, DocsView: vi.fn(), ViewId: { FOLDERS: "folders" }, Action: { PICKED: "picked", CANCEL: "cancel" } } });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accessToken: "picker-access", appId: "123456789", apiKey: "picker-key" }) });
  pickerBuilder.mockImplementation(() => ({
    setOAuthToken: vi.fn().mockReturnThis(),
    setDeveloperKey: vi.fn().mockReturnThis(),
    setAppId: vi.fn().mockReturnThis(),
    addView: vi.fn().mockReturnThis(),
    setCallback: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({ setVisible: vi.fn() }),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const props = (overrides: Record<string, unknown> = {}) => ({
  status: { connected: false },
  canConnect: true,
  autoOpenPicker: false,
  initialError: "",
  activateAction: vi.fn().mockResolvedValue({ ok: true, status: "CONNECTED", message: "Google Drive folder connected.", accountEmail: "coach@example.com", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" }),
  ...overrides,
});

describe("GoogleDriveConnectionCard", () => {
  it("shows simple Connect flow without service-account instructions", () => {
    render(createElement(GoogleDriveConnectionCard, props()));

    expect(screen.getByText("Connect Google Drive")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect Google Drive" })).toHaveAttribute("href", "/admin/google-drive/connect");
    expect(screen.queryByText(/service account/i)).toBeNull();
  });

  it("shows connected account and folder controls", () => {
    render(createElement(GoogleDriveConnectionCard, props({ status: { connected: true, accountEmail: "coach@example.com", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" } })));

    expect(screen.getByText("coach@example.com")).toBeTruthy();
    expect(screen.getByText("Private slips")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change folder" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reconnect account" })).toHaveAttribute("href", "/admin/google-drive/connect");
  });

  it("reports a failed activation without exposing identifiers", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Could not connect Google Drive. Try again." }) });
    render(createElement(GoogleDriveConnectionCard, props({ status: { connected: true, accountEmail: "coach@example.com", folderName: "Private slips", validatedAt: "2026-08-11T12:00:00.000Z" } })));
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/admin/google-drive/picker-token", expect.anything()));
    expect(screen.getByText("Could not connect Google Drive. Try again.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("picker-access");
  });

  it("shows callback setup errors safely", () => {
    render(createElement(GoogleDriveConnectionCard, props({ initialError: "Google Drive connection is not configured." })));

    expect(screen.getByText("Google Drive connection is not configured.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("client-secret");
  });
});

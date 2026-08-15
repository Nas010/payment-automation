/** @vitest-environment jsdom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), driveCard: vi.fn() }));

vi.mock("@/lib/workspace/connection", () => ({ getActiveWorkspaceConnection: mocks.connection }));
vi.mock("@/lib/config", () => ({ googleDriveConfig: () => ({ clientId: "google-client" }) }));
vi.mock("@/components/admin/google-drive-connection-card", () => ({ GoogleDriveConnectionCard: (props: unknown) => { mocks.driveCard(props); return null; } }));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: { children: React.ReactNode }) => children, CardContent: ({ children }: { children: React.ReactNode }) => children, CardDescription: ({ children }: { children: React.ReactNode }) => children, CardHeader: ({ children }: { children: React.ReactNode }) => children, CardTitle: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/app/admin/google-drive/actions", () => ({ activateGoogleDriveFolderAction: vi.fn() }));
vi.mock("../runtime-actions", () => ({ testWorkspaceConnectionAction: vi.fn() }));

import WorkspaceSettingsPage from "./page";

describe("WorkspaceSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("passes reconnect query state and Drive authorization error to its card", async () => {
    render(await WorkspaceSettingsPage({ searchParams: Promise.resolve({ workspace: "reconnect_pending", drive_error: "oauth_denied" }) }));

    expect(mocks.driveCard).toHaveBeenCalledWith(expect.objectContaining({ autoOpenPicker: true, initialError: "Google Drive authorization was canceled.", canConnect: true, status: { connected: false } }));
  });
});

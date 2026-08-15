/** @vitest-environment jsdom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ listOperationalSettings: vi.fn(), getSecretMetadata: vi.fn(), runtimeConfig: vi.fn(), form: vi.fn(), testForm: vi.fn() }));

vi.mock("@/lib/sheets/settings", () => ({
  listOperationalSettings: mocks.listOperationalSettings,
  resolveLineMessageTestProfile: (_settings: unknown, fallback: unknown) => ({ kind: "VALID", profile: fallback }),
}));
vi.mock("@/lib/secrets/service", () => ({ getSecretMetadata: mocks.getSecretMetadata }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/line/connection-token", () => ({ recoverLineConnectionToken: vi.fn(), buildLineConnectUrl: vi.fn() }));
vi.mock("@/components/admin/line-integration-form", () => ({ LineIntegrationForm: (props: unknown) => { mocks.form(props); return null; } }));
vi.mock("@/components/admin/line-message-test-form", () => ({ LineMessageTestForm: (props: unknown) => { mocks.testForm(props); return null; } }));
vi.mock("../line-actions", () => ({ saveAndTestLineCredentialsAction: vi.fn() }));
vi.mock("../line-test-actions", () => ({
  saveLineMessageTestProfileAction: vi.fn(), renewLineMessageTestConnectionAction: vi.fn(), disconnectLineMessageTestConnectionAction: vi.fn(), previewLineMessageTestAction: vi.fn(), sendLineMessageTestAction: vi.fn(),
}));

import LineSettingsPage from "./page";

describe("LineSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.listOperationalSettings.mockResolvedValue([{ key: "line_access_token_validation", value: JSON.stringify({ status: "VALID", validatedAt: "2026-08-15T00:00:00.000Z" }) }]);
    mocks.getSecretMetadata.mockResolvedValue([{ keyName: "line_channel_access_token", lastFour: "1234", updatedAt: "2026-08-15T00:00:00.000Z" }]);
    mocks.runtimeConfig.mockResolvedValue({ lineLiffId: "1234567890-Test", lineLinkingEnabled: true, lineMessagingEnabled: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("passes encrypted credential metadata and validation to LINE channel form", async () => {
    render(await LineSettingsPage());

    expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({
      validation: { status: "VALID", validatedAt: "2026-08-15T00:00:00.000Z" },
      credentials: expect.arrayContaining([expect.objectContaining({ keyName: "line_channel_access_token", configured: true, source: "encrypted" }), expect.objectContaining({ keyName: "line_channel_secret", configured: false, source: "unconfigured" })]),
    }));
  });

  it("passes redacted test profile and LINE flags from same settings read", async () => {
    render(await LineSettingsPage());

    expect(mocks.listOperationalSettings).toHaveBeenCalledOnce();
    expect(mocks.testForm).toHaveBeenCalledWith(expect.objectContaining({
      initialProfile: expect.objectContaining({ clientName: "LINE test recipient" }),
      initialConnectUrl: "",
      linkingEnabled: true,
      messagingEnabled: true,
      saveAction: expect.any(Function),
      sendAction: expect.any(Function),
    }));
    expect(JSON.stringify(mocks.testForm.mock.calls)).not.toContain("lineUserId");
  });
});

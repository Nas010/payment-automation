/** @vitest-environment jsdom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ runtimeConfig: vi.fn(), getSecretMetadata: vi.fn(), form: vi.fn() }));

vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/secrets/service", () => ({ getSecretMetadata: mocks.getSecretMetadata }));
vi.mock("@/components/admin/runtime-config-form", () => ({ RuntimeConfigForm: (props: unknown) => { mocks.form(props); return null; } }));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: { children: React.ReactNode }) => children, CardContent: ({ children }: { children: React.ReactNode }) => children, CardDescription: ({ children }: { children: React.ReactNode }) => children, CardHeader: ({ children }: { children: React.ReactNode }) => children, CardTitle: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../runtime-actions", () => ({ saveRuntimeConfigAction: vi.fn() }));

import BusinessSettingsPage from "./page";

describe("BusinessSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.runtimeConfig.mockResolvedValue({ publicBaseUrl: "https://pay.example" });
    mocks.getSecretMetadata.mockResolvedValue([
      { keyName: "line_channel_access_token", lastFour: "1234", updatedAt: "2026-08-15T00:00:00.000Z" },
      { keyName: "line_channel_secret", lastFour: "5678", updatedAt: "2026-08-15T00:00:00.000Z" },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("enables LINE runtime settings only when both encrypted credentials exist", async () => {
    render(await BusinessSettingsPage());

    expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({ allowLineFeatures: true, defaultBaseUrl: "https://pay.example", submitLabel: "Save settings" }));
  });
});

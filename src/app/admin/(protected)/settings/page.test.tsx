/** @vitest-environment jsdom */

import React, { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS, type ResolvedLineDueMessageProfiles } from "@/lib/line/message-profile";

const mocks = vi.hoisted(() => ({
  listOperationalSettings: vi.fn(),
  getSecretMetadata: vi.fn(),
  getActiveWorkspaceConnection: vi.fn(),
  runtimeConfig: vi.fn(),
  form: vi.fn(),
}));

vi.mock("@/lib/sheets/settings", () => ({
  listOperationalSettings: mocks.listOperationalSettings,
  saveLineTermsImageVersion: vi.fn(),
  resolveLineDueMessageProfiles: (settings: Array<{ key: string; value: string }>) => ({
    ONE_TIME: { kind: "VALID", profile: JSON.parse(settings.find((setting) => setting.key === LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME)?.value ?? JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME)) },
    INSTALLMENTS: { kind: "INVALID" },
  } satisfies ResolvedLineDueMessageProfiles),
  resolveLineInstallmentReminderConfig: () => ({ kind: "VALID", config: { version: 1, profiles: {
    T_MINUS_7_DAYS: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, T_MINUS_3_DAYS: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, T_MINUS_1_DAY: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, DUE_DATE: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, T_PLUS_1_DAY: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS,
  } } }),
}));
vi.mock("@/lib/secrets/service", () => ({ getSecretMetadata: mocks.getSecretMetadata }));
vi.mock("@/lib/workspace/connection", () => ({ getActiveWorkspaceConnection: mocks.getActiveWorkspaceConnection }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock("@/lib/config", () => ({ googleDriveConfig: () => undefined }));
vi.mock("@/components/admin/page-ui", () => ({ PageHeader: () => null }));
vi.mock("@/components/admin/line-integration-form", () => ({ LineIntegrationForm: () => null }));
vi.mock("@/components/admin/line-due-template-form", () => ({ LineDueTemplateForm: (props: unknown) => { mocks.form(props); return null; } }));
vi.mock("@/components/admin/line-welcome-template-form", () => ({ LineWelcomeTemplateForm: () => null }));
vi.mock("@/components/admin/google-drive-connection-card", () => ({ GoogleDriveConnectionCard: () => null }));
vi.mock("@/components/admin/runtime-config-form", () => ({ RuntimeConfigForm: () => null }));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: { children: ReactNode }) => children, CardContent: ({ children }: { children: ReactNode }) => children, CardDescription: ({ children }: { children: ReactNode }) => children, CardHeader: ({ children }: { children: ReactNode }) => children, CardTitle: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("./line-actions", () => ({
  previewLineDueMessageProfileAction: vi.fn(),
  previewLineWelcomeTemplateAction: vi.fn(),
  previewLineInstallmentReminderAction: vi.fn(),
  resetLineDueMessageProfileAction: vi.fn(),
  resetLineWelcomeTemplateAction: vi.fn(),
  resetLineInstallmentReminderConfigAction: vi.fn(),
  saveAndTestLineCredentialsAction: vi.fn(),
  saveLineDueMessageProfileAction: vi.fn(),
  saveLineWelcomeTemplateAction: vi.fn(),
  saveLineInstallmentReminderConfigAction: vi.fn(),
}));
vi.mock("@/app/admin/google-drive/actions", () => ({ activateGoogleDriveFolderAction: vi.fn() }));
vi.mock("./runtime-actions", () => ({ saveRuntimeConfigAction: vi.fn(), testWorkspaceConnectionAction: vi.fn() }));

import SettingsPage from "./page";

describe("SettingsPage LINE profile loading", () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.listOperationalSettings.mockResolvedValue([{ key: LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, value: JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME) }]);
    mocks.getSecretMetadata.mockResolvedValue([]);
    mocks.getActiveWorkspaceConnection.mockResolvedValue(undefined);
    mocks.runtimeConfig.mockResolvedValue({ publicBaseUrl: "https://pay.example", lineMessagingEnabled: true, lineChatPaymentsEnabled: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses one Settings read and passes independent valid and invalid profile states to the editor", async () => {
    render(await SettingsPage({}));

    expect(mocks.listOperationalSettings).toHaveBeenCalledOnce();
    expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({
      profiles: {
        ONE_TIME: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME },
        INSTALLMENTS: { kind: "INVALID" },
      },
    }));
  });
});

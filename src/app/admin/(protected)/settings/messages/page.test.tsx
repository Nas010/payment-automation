/** @vitest-environment jsdom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS, type ResolvedLineDueMessageProfiles } from "@/lib/line/message-profile";

const mocks = vi.hoisted(() => ({ listOperationalSettings: vi.fn(), dueForm: vi.fn(), welcomeForm: vi.fn() }));

vi.mock("@/lib/sheets/settings", () => ({
  listOperationalSettings: mocks.listOperationalSettings,
  resolveLineDueMessageProfiles: (settings: Array<{ key: string; value: string }>) => ({
    ONE_TIME: { kind: "VALID", profile: JSON.parse(settings.find((setting) => setting.key === LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME)?.value ?? JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME)) },
    INSTALLMENTS: { kind: "INVALID" },
  } satisfies ResolvedLineDueMessageProfiles),
}));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig: vi.fn().mockResolvedValue({ lineMessagingEnabled: true, lineChatPaymentsEnabled: true }) }));
vi.mock("@/components/admin/line-due-template-form", () => ({ LineDueTemplateForm: (props: unknown) => { mocks.dueForm(props); return null; } }));
vi.mock("@/components/admin/line-welcome-template-form", () => ({ LineWelcomeTemplateForm: (props: unknown) => { mocks.welcomeForm(props); return null; } }));
vi.mock("../line-actions", () => ({ previewLineDueMessageProfileAction: vi.fn(), previewLineWelcomeTemplateAction: vi.fn(), resetLineDueMessageProfileAction: vi.fn(), resetLineWelcomeTemplateAction: vi.fn(), saveLineDueMessageProfileAction: vi.fn(), saveLineWelcomeTemplateAction: vi.fn() }));

import MessagesSettingsPage from "./page";

describe("MessagesSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.listOperationalSettings.mockResolvedValue([{ key: LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, value: JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME) }]);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses one Settings read and passes independent due profile states", async () => {
    render(await MessagesSettingsPage());

    expect(mocks.listOperationalSettings).toHaveBeenCalledOnce();
    expect(mocks.dueForm).toHaveBeenCalledWith(expect.objectContaining({ profiles: { ONE_TIME: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME }, INSTALLMENTS: { kind: "INVALID" } } }));
  });
});

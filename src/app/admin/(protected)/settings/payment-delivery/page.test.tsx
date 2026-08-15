/** @vitest-environment jsdom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ listOperationalSettings: vi.fn(), connection: vi.fn(), form: vi.fn() }));

vi.mock("@/lib/sheets/settings", () => ({ listOperationalSettings: mocks.listOperationalSettings }));
vi.mock("@/lib/workspace/connection", () => ({ getActiveWorkspaceConnection: mocks.connection }));
vi.mock("@/lib/line/terms-image", () => ({ activeLineTermsImageVersion: vi.fn(), lineTermsImagePath: vi.fn(), parseLineTermsImageState: () => { throw new Error("corrupt"); } }));
vi.mock("@/components/admin/line-terms-image-form", () => ({ LineTermsImageForm: (props: unknown) => { mocks.form(props); return null; } }));
vi.mock("../terms-image-actions", () => ({ uploadLineTermsImageAction: vi.fn() }));

import PaymentDeliverySettingsPage from "./page";

describe("PaymentDeliverySettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.listOperationalSettings.mockResolvedValue([]);
    mocks.connection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("contains corrupt terms-image state as a safe delivery-page error", async () => {
    render(await PaymentDeliverySettingsPage());

    expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({ image: null, driveConnected: false, error: "T&S image configuration needs attention." }));
  });
});

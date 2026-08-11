/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LineIntegrationForm } from "./line-integration-form";

const rawAccessToken = "line-access-token-value-1234567890";

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(() => {
  cleanup();
});

describe("LineIntegrationForm", () => {
  it("uses blank password fields and renders metadata without raw secrets", () => {
    const { container } = render(createElement(LineIntegrationForm, {
      action: vi.fn(),
      credentials: [
        { keyName: "line_channel_access_token", configured: true, source: "encrypted", lastFour: "7890", updatedAt: "2026-08-10T12:00:00.000Z" },
        { keyName: "line_channel_secret", configured: true, source: "environment" },
      ],
    }));

    const accessToken = screen.getByLabelText("Channel access token") as HTMLInputElement;
    const channelSecret = screen.getByLabelText("Channel secret") as HTMLInputElement;
    expect(accessToken).toHaveAttribute("type", "password");
    expect(channelSecret).toHaveAttribute("type", "password");
    expect(accessToken.value).toBe("");
    expect(channelSecret.value).toBe("");
    expect(screen.getByText(/Configured ••••7890/)).toBeTruthy();
    expect(screen.getByText("Configured via environment")).toBeTruthy();
    expect(container.textContent).not.toContain(rawAccessToken);
  });

  it("clears submitted values and reports only a safe validation outcome", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, status: "FAILED", validatedAt: "2026-08-10T12:00:00.000Z" });
    render(createElement(LineIntegrationForm, { action, credentials: [] }));
    const token = screen.getByLabelText("Channel access token") as HTMLInputElement;
    fireEvent.change(token, { target: { value: rawAccessToken } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Test" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("LINE validation failed. Check credentials and try again.")).toBeTruthy());
    expect(token.value).toBe("");
    expect(document.body.textContent).not.toContain(rawAccessToken);
  });
});

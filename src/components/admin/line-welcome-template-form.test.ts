/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LineWelcomeTemplateForm } from "./line-welcome-template-form";

const template = "Hi {{client_name}} from {{business_name}}: {{line_connect_url}}";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LineWelcomeTemplateForm", () => {
  it("previews, saves, and restores global welcome message", async () => {
    const previewAction = vi.fn().mockResolvedValue({ ok: true, preview: "Preview" });
    const saveAction = vi.fn().mockResolvedValue({ ok: true, preview: "Saved" });
    const resetAction = vi.fn().mockResolvedValue({ ok: true, template: "Default {{line_connect_url}}", preview: "Default preview" });
    render(createElement(LineWelcomeTemplateForm, { template, previewAction, saveAction, resetAction }));

    const input = screen.getByLabelText("Welcome message template") as HTMLTextAreaElement;
    expect(screen.getByText(/client_name, business_name, and line_connect_url/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
    await screen.findByText("Preview");

    fireEvent.change(input, { target: { value: "Connect {{line_connect_url}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
    expect((saveAction.mock.calls[0]?.[0] as FormData).get("template")).toBe("Connect {{line_connect_url}}");
    await screen.findByText("Saved");

    const restoreButton = screen.getByRole("button", { name: "Restore default" }) as HTMLButtonElement;
    await waitFor(() => expect(restoreButton.disabled).toBe(false));
    fireEvent.click(restoreButton);
    await waitFor(() => expect(resetAction).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("Default {{line_connect_url}}");
    expect(screen.getByText("Default preview")).toBeTruthy();
  });
});

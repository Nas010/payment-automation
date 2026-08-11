/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LineDueTemplateForm } from "./line-due-template-form";

const template = "Hi {{client_name}}. {{amount}} due {{due_date}}: {{payment_url}}";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LineDueTemplateForm", () => {
  it("shows server-provided feature state and server preview", async () => {
    const previewAction = vi.fn().mockResolvedValue({ ok: true, preview: "Hi Nisa. ฿1,500.00 due 2026-08-15: https://pay.example/p/sample" });
    render(createElement(LineDueTemplateForm, {
      template,
      messagingEnabled: true,
      chatPaymentsEnabled: false,
      previewAction,
      saveAction: vi.fn(),
      resetAction: vi.fn(),
    }));

    expect(screen.getByText("LINE messaging enabled")).toBeTruthy();
    expect(screen.getByText("LINE chat payments disabled")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview message" }));

    await waitFor(() => expect(previewAction).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Hi Nisa. ฿1,500.00 due 2026-08-15: https://pay.example/p/sample")).toBeTruthy();
  });

  it("submits edited template and can restore documented default", async () => {
    const saveAction = vi.fn().mockResolvedValue({ ok: true, preview: "Saved" });
    const resetAction = vi.fn().mockResolvedValue({ ok: true, template: "Default template", preview: "Default preview" });
    render(createElement(LineDueTemplateForm, {
      template,
      messagingEnabled: false,
      chatPaymentsEnabled: true,
      previewAction: vi.fn(),
      saveAction,
      resetAction,
    }));

    const input = screen.getByLabelText("Due-payment message template") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Pay {{amount}} by {{due_date}}: {{payment_url}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
    expect((saveAction.mock.calls[0]?.[0] as FormData).get("template")).toBe("Pay {{amount}} by {{due_date}}: {{payment_url}}");
    await screen.findByText("Saved");

    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));
    await waitFor(() => expect(resetAction).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("Default template");
    expect(screen.getByText("Default preview")).toBeTruthy();
  });
});

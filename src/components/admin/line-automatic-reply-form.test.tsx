/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG } from "@/lib/line/reply-config";
import { LineAutomaticReplyForm } from "./line-automatic-reply-form";

const valid = { kind: "VALID" as const, config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG };

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LineAutomaticReplyForm", () => {
  it("shows one client-facing payment-slip reply", () => {
    render(createElement(LineAutomaticReplyForm, {
      resolved: valid,
      saveAction: vi.fn(),
      resetAction: vi.fn(),
    }));

    expect(screen.getByText("Automatic replies")).toBeTruthy();
    expect((screen.getByLabelText("Payment slip received message") as HTMLTextAreaElement).value).toBe(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip.received);
    expect(screen.queryByLabelText("Payment needs review")).toBeNull();
    expect(screen.queryByLabelText("Payment flagged")).toBeNull();
    expect(screen.queryByRole("tab", { name: "LINE connection replies" })).toBeNull();
  });

  it("saves one complete edited configuration", async () => {
    const saveAction = vi.fn().mockResolvedValue({
      ok: true,
      config: {
        ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
        slip: { received: "Custom received reply" },
      },
    });
    render(createElement(LineAutomaticReplyForm, { resolved: valid, saveAction, resetAction: vi.fn() }));

    fireEvent.change(screen.getByLabelText("Payment slip received message"), { target: { value: "Custom received reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Save automatic replies" }));

    await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
    const submitted = JSON.parse(String((saveAction.mock.calls[0]?.[0] as FormData).get("config")));
    expect(submitted).toEqual({
      ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
      slip: { received: "Custom received reply" },
    });
    expect(await screen.findByText("Automatic replies saved.")).toBeTruthy();
  });

  it("keeps an edited draft after a save failure and can restore documented defaults", async () => {
    const saveAction = vi.fn().mockRejectedValue(new Error("Could not save automatic replies."));
    const resetAction = vi.fn().mockResolvedValue({ ok: true, config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG });
    render(createElement(LineAutomaticReplyForm, { resolved: valid, saveAction, resetAction }));

    const received = screen.getByLabelText("Payment slip received message") as HTMLTextAreaElement;
    fireEvent.change(received, { target: { value: "Unsaved received reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Save automatic replies" }));
    expect(await screen.findByText("Could not save automatic replies.")).toBeTruthy();
    expect(received.value).toBe("Unsaved received reply");

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    await waitFor(() => expect(resetAction).toHaveBeenCalledOnce());
    expect(received.value).toBe(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip.received);
    expect(screen.getByText("Documented defaults restored.")).toBeTruthy();
  });

  it("warns when saved config is invalid while defaults remain editable", () => {
    render(createElement(LineAutomaticReplyForm, {
      resolved: { kind: "INVALID", config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG },
      saveAction: vi.fn(),
      resetAction: vi.fn(),
    }));

    expect(screen.getByText("Saved automatic replies are invalid. Defaults are active until you save or restore them.")).toBeTruthy();
  });
});

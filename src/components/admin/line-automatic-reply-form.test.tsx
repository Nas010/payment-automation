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
  it("groups all seven automatic replies in Settings → Messages", () => {
    render(createElement(LineAutomaticReplyForm, {
      resolved: valid,
      saveAction: vi.fn(),
      resetAction: vi.fn(),
    }));

    expect(screen.getByText("Automatic replies")).toBeTruthy();
    expect(screen.getByText("Payment slip replies")).toBeTruthy();
    expect(screen.getByText("LINE connection replies")).toBeTruthy();
    expect((screen.getByLabelText("Payment recorded automatically") as HTMLTextAreaElement).value).toBe(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip.autoRecorded);
    expect(screen.getByLabelText("Payment needs review")).toBeTruthy();
    expect(screen.getByLabelText("Payment flagged")).toBeTruthy();
    expect(screen.getByLabelText("Connected successfully")).toBeTruthy();
    expect(screen.getByLabelText("Already connected")).toBeTruthy();
    expect(screen.getByLabelText("Invalid, expired, or inactive")).toBeTruthy();
    expect(screen.getByLabelText("Connection conflict")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(7);
  });

  it("saves one complete edited configuration", async () => {
    const saveAction = vi.fn().mockResolvedValue({
      ok: true,
      config: {
        ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
        slip: { ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip, review: "Custom review reply" },
        connection: { ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.connection, conflict: "Custom conflict reply" },
      },
    });
    render(createElement(LineAutomaticReplyForm, { resolved: valid, saveAction, resetAction: vi.fn() }));

    fireEvent.change(screen.getByLabelText("Payment needs review"), { target: { value: "Custom review reply" } });
    fireEvent.change(screen.getByLabelText("Connection conflict"), { target: { value: "Custom conflict reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Save automatic replies" }));

    await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
    const submitted = JSON.parse(String((saveAction.mock.calls[0]?.[0] as FormData).get("config")));
    expect(submitted).toEqual({
      ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG,
      slip: { ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip, review: "Custom review reply" },
      connection: { ...DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.connection, conflict: "Custom conflict reply" },
    });
    expect(await screen.findByText("Automatic replies saved.")).toBeTruthy();
  });

  it("keeps an edited draft after a save failure and can restore documented defaults", async () => {
    const saveAction = vi.fn().mockRejectedValue(new Error("Could not save automatic replies."));
    const resetAction = vi.fn().mockResolvedValue({ ok: true, config: DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG });
    render(createElement(LineAutomaticReplyForm, { resolved: valid, saveAction, resetAction }));

    const review = screen.getByLabelText("Payment needs review") as HTMLTextAreaElement;
    fireEvent.change(review, { target: { value: "Unsaved review reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Save automatic replies" }));
    expect(await screen.findByText("Could not save automatic replies.")).toBeTruthy();
    expect(review.value).toBe("Unsaved review reply");

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    await waitFor(() => expect(resetAction).toHaveBeenCalledOnce());
    expect(review.value).toBe(DEFAULT_LINE_AUTOMATIC_REPLY_CONFIG.slip.review);
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

/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
  type LineInstallmentReminderConfig,
  type ReminderSlot,
} from "@/lib/line/message-profile";
import { LineInstallmentReminderForm } from "./line-installment-reminder-form";

type Result = {
  ok: true;
  slot: ReminderSlot;
  config: LineInstallmentReminderConfig;
  preview: string;
};

type RenderOptions = {
  config?: LineInstallmentReminderConfig;
  previewAction?: ReturnType<typeof vi.fn>;
  saveAction?: ReturnType<typeof vi.fn>;
  resetAction?: ReturnType<typeof vi.fn>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function renderReminderForm(options: RenderOptions = {}) {
  const initial = structuredClone(options.config ?? DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  const previewAction = options.previewAction ?? vi.fn().mockImplementation(async (formData: FormData): Promise<Result> => {
    const slot = String(formData.get("slot")) as ReminderSlot;
    const profile = JSON.parse(String(formData.get("profile")));
    return {
      ok: true,
      slot,
      config: { ...initial, profiles: { ...initial.profiles, [slot]: profile } },
      preview: `Preview for ${slot}`,
    };
  });
  const saveAction = options.saveAction ?? vi.fn().mockImplementation(async (formData: FormData): Promise<Result> => {
    const config = JSON.parse(String(formData.get("config")));
    return { ok: true, slot: "DUE_DATE", config, preview: "Saved due-date preview" };
  });
  const resetAction = options.resetAction ?? vi.fn().mockResolvedValue({
    ok: true,
    slot: "DUE_DATE",
    config: structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG),
    preview: "Default due-date preview",
  });

  render(createElement(LineInstallmentReminderForm, {
    resolved: { kind: "VALID", config: initial },
    previewAction,
    saveAction,
    resetAction,
  }));
  return { previewAction, saveAction, resetAction };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LineInstallmentReminderForm", () => {
  it("submits only the selected profile for preview and shows slot-local output", async () => {
    const { previewAction } = renderReminderForm();

    fireEvent.click(screen.getByRole("button", { name: "Preview T−3 days message" }));

    await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());
    const data = previewAction.mock.calls[0][0] as FormData;
    expect(data.get("slot")).toBe("T_MINUS_3_DAYS");
    expect(JSON.parse(String(data.get("profile")))).toEqual(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.T_MINUS_3_DAYS);
    expect(data.get("config")).toBeNull();
    expect(await screen.findByText("Preview for T_MINUS_3_DAYS")).toBeTruthy();
  });

  it("shows a rejected validation message beside the affected slot", async () => {
    renderReminderForm({
      previewAction: vi.fn().mockRejectedValue(new Error("Unsupported LINE placeholder: payment_label")),
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview T−7 days message" }));

    expect(await screen.findByText("Unsupported LINE placeholder: payment_label")).toBeTruthy();
  });

  it("defines and inserts payment_label in one reminder slot", async () => {
    renderReminderForm();
    fireEvent.click(screen.getByRole("button", { name: "Add placeholder to T−7 days" }));
    fireEvent.change(screen.getByLabelText("T−7 days placeholder name custom_1"), { target: { value: "payment_label" } });
    fireEvent.change(screen.getByLabelText("T−7 days placeholder content payment_label"), {
      target: { value: "{{installment_ordinal}} payment for {{package_name}}" },
    });

    const editor = screen.getByRole("group", { name: "T−7 days message editor" });
    fireEvent.click(within(editor).getByRole("button", { name: "Insert {{payment_label}}" }));

    await waitFor(() => expect((screen.getByLabelText("T−7 days message") as HTMLTextAreaElement).value).toContain("{{payment_label}}"));
  });

  it("saves all five profiles atomically and shows confirmation", async () => {
    const { saveAction } = renderReminderForm();
    fireEvent.change(screen.getByLabelText("T+1 day message"), { target: { value: "Friendly late reminder" } });

    fireEvent.click(screen.getByRole("button", { name: "Save reminder templates" }));

    await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
    const data = saveAction.mock.calls[0][0] as FormData;
    const saved = JSON.parse(String(data.get("config"))) as LineInstallmentReminderConfig;
    expect(Object.keys(saved.profiles)).toHaveLength(5);
    expect(saved.profiles.T_PLUS_1_DAY.message).toBe("Friendly late reminder");
    expect(await screen.findByText("Reminder templates saved.")).toBeTruthy();
  });

  it("blocks overlapping actions and preserves edits made during preview", async () => {
    const response = deferred<Result>();
    const previewAction = vi.fn().mockReturnValue(response.promise);
    const { saveAction } = renderReminderForm({ previewAction });
    const message = screen.getByLabelText("T−7 days message") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "Preview T−7 days message" }));
    await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());
    expect((screen.getByRole("button", { name: "Save reminder templates" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save reminder templates" }));
    expect(saveAction).not.toHaveBeenCalled();

    fireEvent.change(message, { target: { value: "Edited while previewing" } });
    response.resolve({
      ok: true,
      slot: "T_MINUS_7_DAYS",
      config: structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG),
      preview: "Preview complete",
    });

    expect(await screen.findByText("Preview complete")).toBeTruthy();
    expect(message.value).toBe("Edited while previewing");
  });

  it("preserves edits made while an atomic save is pending", async () => {
    const response = deferred<Result>();
    const saveAction = vi.fn().mockReturnValue(response.promise);
    renderReminderForm({ saveAction });
    const message = screen.getByLabelText("T−3 days message") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "Save reminder templates" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
    fireEvent.change(message, { target: { value: "Edited while saving" } });
    response.resolve({
      ok: true,
      slot: "DUE_DATE",
      config: structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG),
      preview: "Saved preview",
    });

    expect(await screen.findByText("Reminder templates saved.")).toBeTruthy();
    expect(message.value).toBe("Edited while saving");
  });

  it("restores every default and displays reset preview", async () => {
    renderReminderForm();
    const message = screen.getByLabelText("T+1 day message") as HTMLTextAreaElement;
    fireEvent.change(message, { target: { value: "Changed" } });

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    await waitFor(() => expect(message.value).toBe(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.T_PLUS_1_DAY.message));
    expect(screen.getByText("Default due-date preview")).toBeTruthy();
    expect(screen.getByText("Documented defaults restored.")).toBeTruthy();
  });
});

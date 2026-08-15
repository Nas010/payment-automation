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

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks }));

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

const reminderNames = [
  "7 days before due date",
  "3 days before due date",
  "1 day before due date",
  "On due date",
  "1 day after due date",
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function result(config: LineInstallmentReminderConfig, slot: ReminderSlot = "DUE_DATE", preview = "Preview") : Result {
  return { ok: true, slot, config, preview };
}

function renderReminderForm(options: RenderOptions = {}) {
  const initial = structuredClone(options.config ?? DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
  const previewAction = options.previewAction ?? vi.fn().mockImplementation(async (formData: FormData): Promise<Result> => {
    const slot = String(formData.get("slot")) as ReminderSlot;
    const profile = JSON.parse(String(formData.get("profile")));
    return result({ ...initial, profiles: { ...initial.profiles, [slot]: profile } }, slot, `Preview for ${slot}`);
  });
  const saveAction = options.saveAction ?? vi.fn().mockImplementation(async (formData: FormData): Promise<Result> => {
    const config = JSON.parse(String(formData.get("config")));
    return result(config, "DUE_DATE", "Saved due-date preview");
  });
  const resetAction = options.resetAction ?? vi.fn().mockResolvedValue(
    result(structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG), "DUE_DATE", "Default due-date preview"),
  );

  render(createElement(LineInstallmentReminderForm, {
    resolved: { kind: "VALID", config: initial },
    previewAction,
    saveAction,
    resetAction,
  }));
  return { previewAction, saveAction, resetAction };
}

function openEditor(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LineInstallmentReminderForm", () => {
  it("shows five compact reminder-name triggers and independent switches", () => {
    renderReminderForm();

    for (const name of reminderNames) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
      expect(screen.getByRole("switch", { name: `Send ${name} reminder` })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByText(/enabled|paused/i)).toBeNull();
    expect(screen.queryByLabelText("T−7 days message")).toBeNull();
  });

  it("opens selected reminder editor from name", () => {
    renderReminderForm();
    openEditor("3 days before due date");

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit 3 days before due date" })).toBeTruthy();
    expect(screen.getByLabelText("3 days before due date message")).toBeTruthy();
  });

  it("persists only selected reminder switch", async () => {
    const { saveAction } = renderReminderForm();
    fireEvent.click(screen.getByRole("switch", { name: "Send 3 days before due date reminder" }));

    await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
    const saved = JSON.parse(String((saveAction.mock.calls[0][0] as FormData).get("config"))) as LineInstallmentReminderConfig;
    expect(saved).toEqual({
      ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG,
      enabled: { ...DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.enabled, T_MINUS_3_DAYS: false },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Send 3 days before due date reminder" }).getAttribute("aria-checked")).toBe("false"));
    expect(toastMocks.success).toHaveBeenCalledWith("Reminder updated.");
  });

  it("rolls back a rejected reminder switch and announces error", async () => {
    renderReminderForm({ saveAction: vi.fn().mockRejectedValue(new Error("Workbook unavailable")) });
    fireEvent.click(screen.getByRole("switch", { name: "Send 3 days before due date reminder" }));

    await waitFor(() => expect(screen.getByRole("switch", { name: "Send 3 days before due date reminder" }).getAttribute("aria-checked")).toBe("true"));
    expect(toastMocks.error).toHaveBeenCalledWith("Workbook unavailable");
  });

  it("discards a cancelled message draft", () => {
    renderReminderForm();
    openEditor("7 days before due date");
    fireEvent.change(screen.getByLabelText("7 days before due date message"), { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openEditor("7 days before due date");

    expect((screen.getByLabelText("7 days before due date message") as HTMLTextAreaElement).value)
      .toBe(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.T_MINUS_7_DAYS.message);
  });

  it("puts placeholder buttons before main message textarea", () => {
    renderReminderForm();
    openEditor("7 days before due date");
    const editor = screen.getByRole("group", { name: "7 days before due date message editor" });
    const insert = within(editor).getByRole("button", { name: "Insert {{client_name}}" });
    const textarea = screen.getByLabelText("7 days before due date message");

    expect(insert.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("previews only selected draft profile", async () => {
    const { previewAction } = renderReminderForm();
    openEditor("3 days before due date");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());
    const data = previewAction.mock.calls[0][0] as FormData;
    expect(data.get("slot")).toBe("T_MINUS_3_DAYS");
    expect(JSON.parse(String(data.get("profile")))).toEqual(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.T_MINUS_3_DAYS);
    expect(data.get("config")).toBeNull();
    expect(await screen.findByText("Preview for T_MINUS_3_DAYS")).toBeTruthy();
  });

  it("saves only active message draft in full configuration", async () => {
    const { saveAction } = renderReminderForm();
    openEditor("1 day after due date");
    fireEvent.change(screen.getByLabelText("1 day after due date message"), { target: { value: "Friendly late reminder" } });
    fireEvent.click(screen.getByRole("button", { name: "Save message" }));

    await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
    const saved = JSON.parse(String((saveAction.mock.calls[0][0] as FormData).get("config"))) as LineInstallmentReminderConfig;
    expect(saved.profiles.T_PLUS_1_DAY.message).toBe("Friendly late reminder");
    expect(saved.profiles.T_MINUS_7_DAYS).toEqual(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG.profiles.T_MINUS_7_DAYS);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toastMocks.success).toHaveBeenCalledWith("Reminder message saved.");
  });

  it("keeps rejected message draft open with inline error", async () => {
    renderReminderForm({ saveAction: vi.fn().mockRejectedValue(new Error("Unsupported LINE placeholder: payment_label")) });
    openEditor("7 days before due date");
    fireEvent.change(screen.getByLabelText("7 days before due date message"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save message" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Unsupported LINE placeholder: payment_label");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("7 days before due date message") as HTMLTextAreaElement).value).toBe("Keep this draft");
  });

  it("defines and inserts profile-local custom placeholder", async () => {
    renderReminderForm();
    openEditor("7 days before due date");
    fireEvent.click(screen.getByRole("button", { name: "Add placeholder to 7 days before due date" }));
    fireEvent.change(screen.getByLabelText("7 days before due date placeholder name custom_1"), { target: { value: "payment_label" } });
    fireEvent.change(screen.getByLabelText("7 days before due date placeholder content payment_label"), {
      target: { value: "{{installment_ordinal}} payment for {{package_name}}" },
    });
    const editor = screen.getByRole("group", { name: "7 days before due date message editor" });
    fireEvent.click(within(editor).getByRole("button", { name: "Insert {{payment_label}}" }));
    fireEvent.click(screen.getByRole("button", { name: "Save message" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    openEditor("7 days before due date");
    expect((screen.getByLabelText("7 days before due date message") as HTMLTextAreaElement).value).toContain("{{payment_label}}");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openEditor("3 days before due date");
    expect(screen.queryByLabelText(/3 days before due date placeholder name payment_label/)).toBeNull();
  });

  it("disables all controls while request pending", async () => {
    const response = deferred<Result>();
    const { previewAction } = renderReminderForm({ previewAction: vi.fn().mockReturnValue(response.promise) });
    openEditor("7 days before due date");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());

    for (const name of reminderNames) {
      expect((screen.getByRole("button", { name, hidden: true }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByRole("switch", { name: `Send ${name} reminder`, hidden: true }).getAttribute("data-disabled")).not.toBeNull();
    }
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save message" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Restore defaults" }) as HTMLButtonElement).disabled).toBe(true);

    response.resolve(result(structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG), "T_MINUS_7_DAYS", "Preview complete"));
    expect(await screen.findByText("Preview complete")).toBeTruthy();
  });

  it("restores all default switches, closes editor, and reports success", async () => {
    const config = structuredClone(DEFAULT_LINE_INSTALLMENT_REMINDER_CONFIG);
    config.enabled.T_MINUS_3_DAYS = false;
    config.profiles.T_MINUS_7_DAYS.message = "Changed";
    const { resetAction } = renderReminderForm({ config });
    openEditor("7 days before due date");
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    await waitFor(() => expect(resetAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const name of reminderNames) {
      expect(screen.getByRole("switch", { name: `Send ${name} reminder` }).getAttribute("aria-checked")).toBe("true");
    }
    expect(toastMocks.success).toHaveBeenCalledWith("Reminder defaults restored.");
  });
});

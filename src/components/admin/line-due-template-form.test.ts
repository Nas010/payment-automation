/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_LINE_DUE_PROFILES, type ResolvedLineDueMessageProfiles } from "@/lib/line/message-profile";
import { LineDueTemplateForm } from "./line-due-template-form";

type RenderOptions = {
  oneTimeMessage?: string;
  previewAction?: ReturnType<typeof vi.fn>;
  saveAction?: ReturnType<typeof vi.fn>;
  resetAction?: ReturnType<typeof vi.fn>;
  profiles?: typeof DEFAULT_LINE_DUE_PROFILES;
  resolved?: ResolvedLineDueMessageProfiles;
};

function resolvedProfiles(profiles: typeof DEFAULT_LINE_DUE_PROFILES): ResolvedLineDueMessageProfiles {
  return {
    ONE_TIME: { kind: "VALID", profile: profiles.ONE_TIME },
    INSTALLMENTS: { kind: "VALID", profile: profiles.INSTALLMENTS },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function renderProfileForm(options: RenderOptions = {}) {
  const profiles = structuredClone(options.profiles ?? DEFAULT_LINE_DUE_PROFILES);
  if (options.oneTimeMessage !== undefined) profiles.ONE_TIME.message = options.oneTimeMessage;
  const previewAction = options.previewAction ?? vi.fn().mockResolvedValue({ ok: true, paymentType: "ONE_TIME", profile: profiles.ONE_TIME, preview: "Preview" });
  const saveAction = options.saveAction ?? vi.fn().mockImplementation(async (formData: FormData) => {
    const paymentType = String(formData.get("payment_type")) as "ONE_TIME" | "INSTALLMENTS";
    const profile = JSON.parse(String(formData.get("profile")));
    return { ok: true, paymentType, profile, preview: "Saved preview" };
  });
  const resetAction = options.resetAction ?? vi.fn().mockImplementation(async (formData: FormData) => {
    const paymentType = String(formData.get("payment_type")) as "ONE_TIME" | "INSTALLMENTS";
    return { ok: true, paymentType, profile: DEFAULT_LINE_DUE_PROFILES[paymentType], preview: "Default preview" };
  });
  render(createElement(LineDueTemplateForm, {
    profiles: options.resolved ?? resolvedProfiles(profiles),
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

describe("LineDueTemplateForm", () => {
  it("inserts a system placeholder at the current message caret and restores focus", async () => {
    renderProfileForm();
    const textarea = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
    const editor = screen.getByRole("group", { name: "One-time payment message editor" });
    fireEvent.change(textarea, { target: { value: "Pay  now" } });
    textarea.focus();
    textarea.setSelectionRange(4, 4);
    fireEvent.click(within(editor).getByRole("button", { name: "Insert {{amount}}" }));
    await waitFor(() => {
      expect(textarea.value).toBe("Pay {{amount}} now");
      expect(textarea.selectionStart).toBe("Pay {{amount}}".length);
      expect(document.activeElement).toBe(textarea);
    });
  });

  it("replaces selected text with a custom placeholder", () => {
    renderProfileForm({ oneTimeMessage: "Hello old text" });
    const textarea = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 14);
    fireEvent.click(screen.getByRole("button", { name: "Insert {{payment_label}}" }));
    expect(textarea.value).toBe("Hello {{payment_label}}");
  });

  it("supports insertion at start, end, and repeated caret positions", async () => {
    renderProfileForm({ oneTimeMessage: "Pay" });
    const textarea = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
    const editor = screen.getByRole("group", { name: "One-time payment message editor" });
    textarea.setSelectionRange(0, 0);
    fireEvent.click(within(editor).getByRole("button", { name: "Insert {{client_name}}" }));
    await waitFor(() => expect(textarea.value).toBe("{{client_name}}Pay"));
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.click(within(editor).getByRole("button", { name: "Insert {{amount}}" }));
    await waitFor(() => expect(textarea.value).toBe("{{client_name}}Pay{{amount}}"));
    fireEvent.click(within(editor).getByRole("button", { name: "Insert {{amount}}" }));
    await waitFor(() => expect(textarea.value).toBe("{{client_name}}Pay{{amount}}{{amount}}"));
  });

  it("shows installment word buttons only in installment tab", () => {
    renderProfileForm();
    expect(screen.queryByRole("button", { name: "Insert {{installment_ordinal_word}}" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Installments" }));
    const editor = screen.getByRole("group", { name: "Installment payment message editor" });
    expect(within(editor).getByRole("button", { name: "Insert {{installment_ordinal_word}}" })).toBeTruthy();
  });

  it("renders custom placeholders as pills and opens one to edit", () => {
    renderProfileForm();

    expect(screen.getByRole("button", { name: "Edit placeholder payment_label" })).toBeTruthy();
    expect(screen.queryByLabelText("Placeholder name payment_label")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit placeholder payment_label" }));

    expect(screen.getByText("Edit placeholder")).toBeTruthy();
    expect(screen.getByLabelText("Placeholder name payment_label")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove payment_label" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview placeholder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel placeholder edits" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save placeholder" })).toBeTruthy();
  });

  it("adds a custom placeholder from the pill list and inserts it into the active profile message", () => {
    renderProfileForm();
    fireEvent.click(screen.getByRole("button", { name: "Add placeholder" }));
    fireEvent.change(screen.getByLabelText("Placeholder name custom_1"), { target: { value: "greeting" } });
    fireEvent.change(screen.getByLabelText("Placeholder content greeting"), { target: { value: "Hi {{client_name}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save placeholder" }));
    expect(screen.getByRole("button", { name: "Insert {{greeting}}" })).toBeTruthy();
  });

  it("blocks rename and removal while the custom placeholder is referenced", () => {
    renderProfileForm({ oneTimeMessage: "{{payment_label}} {{amount}} {{due_date}} {{payment_url}}" });
    fireEvent.click(screen.getByRole("button", { name: "Edit placeholder payment_label" }));
    expect((screen.getByLabelText("Placeholder name payment_label") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove payment_label" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/remove it from the message before renaming or deleting/i)).toBeNull();
  });

  it("confirms before removing an unused custom placeholder", () => {
    renderProfileForm({ oneTimeMessage: "{{amount}} {{due_date}} {{payment_url}}" });
    fireEvent.click(screen.getByRole("button", { name: "Edit placeholder payment_label" }));
    fireEvent.change(screen.getByLabelText("Placeholder name payment_label"), { target: { value: "summary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save placeholder" }));
    expect(screen.getByRole("button", { name: "Edit placeholder summary" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove summary" }));

    expect(screen.getByText("Remove summary?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove placeholder" }));

    expect(screen.queryByRole("button", { name: "Edit placeholder summary" })).toBeNull();
  });

  it("keeps a placeholder when removal is cancelled", () => {
    renderProfileForm({ oneTimeMessage: "{{amount}} {{due_date}} {{payment_url}}" });
    fireEvent.click(screen.getByRole("button", { name: "Remove payment_label" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Edit placeholder payment_label" })).toBeTruthy();
  });

  it("cancels an unsaved custom placeholder edit", () => {
    renderProfileForm();
    fireEvent.click(screen.getByRole("button", { name: "Edit placeholder payment_label" }));
    fireEvent.change(screen.getByLabelText("Placeholder content payment_label"), { target: { value: "Unsaved content" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel placeholder edits" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit placeholder payment_label" }));

    expect((screen.getByLabelText("Placeholder content payment_label") as HTMLTextAreaElement).value).not.toBe("Unsaved content");
  });

  it("submits only the active profile as JSON and applies server preview", async () => {
    const previewAction = vi.fn().mockResolvedValue({ ok: true, paymentType: "INSTALLMENTS", profile: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, preview: "Second payment preview" });
    renderProfileForm({ previewAction });
    fireEvent.click(screen.getByRole("tab", { name: "Installments" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
    await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());
    const submitted = previewAction.mock.calls[0][0] as FormData;
    expect(submitted.get("payment_type")).toBe("INSTALLMENTS");
    expect(JSON.parse(String(submitted.get("profile")))).toEqual(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS);
    await waitFor(() => expect(screen.getByText("Second payment preview")).toBeTruthy());
  });

  it("disables profile actions for the full request and blocks overlapping actions", async () => {
    const response = deferred<{ ok: true; paymentType: "ONE_TIME"; profile: typeof DEFAULT_LINE_DUE_PROFILES.ONE_TIME; preview: string }>();
    const previewAction = vi.fn().mockReturnValue(response.promise);
    const { saveAction, resetAction } = renderProfileForm({ previewAction });

    fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
    await waitFor(() => expect(previewAction).toHaveBeenCalledOnce());
    expect((screen.getByRole("button", { name: "Preview message" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Restore default" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));
    expect(saveAction).not.toHaveBeenCalled();
    expect(resetAction).not.toHaveBeenCalled();

    response.resolve({ ok: true, paymentType: "ONE_TIME", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME, preview: "Preview complete" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Preview message" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("Preview complete")).toBeTruthy();
  });

  it("keeps edits made while preview is pending when the preview response arrives", async () => {
    const response = deferred<{ ok: true; paymentType: "ONE_TIME"; profile: typeof DEFAULT_LINE_DUE_PROFILES.ONE_TIME; preview: string }>();
    renderProfileForm({ previewAction: vi.fn().mockReturnValue(response.promise) });
    const message = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
    fireEvent.change(message, { target: { value: "Edited during preview {{amount}} {{due_date}} {{payment_url}}" } });
    response.resolve({ ok: true, paymentType: "ONE_TIME", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME, preview: "Preview complete" });

    await waitFor(() => expect(screen.getByText("Preview complete")).toBeTruthy());
    expect(message.value).toContain("Edited during preview");
  });

  it("keeps edits made while save is pending when the save response arrives", async () => {
    const response = deferred<{ ok: true; paymentType: "ONE_TIME"; profile: typeof DEFAULT_LINE_DUE_PROFILES.ONE_TIME; preview: string }>();
    renderProfileForm({ saveAction: vi.fn().mockReturnValue(response.promise) });
    const message = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    fireEvent.change(message, { target: { value: "Edited during save {{amount}} {{due_date}} {{payment_url}}" } });
    response.resolve({ ok: true, paymentType: "ONE_TIME", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME, preview: "Saved preview" });

    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeTruthy());
    expect(message.value).toContain("Edited during save");
  });

  it("caps a profile at twenty custom placeholders", () => {
    const profiles = structuredClone(DEFAULT_LINE_DUE_PROFILES);
    profiles.ONE_TIME.customPlaceholders = Array.from({ length: 20 }, (_, index) => ({ name: `custom_${index + 1}`, template: "Text" }));
    renderProfileForm({ profiles });

    expect((screen.getByRole("button", { name: "Add placeholder" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers only system placeholders in custom-definition editors", () => {
    renderProfileForm();
    fireEvent.click(screen.getByRole("button", { name: "Edit placeholder payment_label" }));
    const editor = screen.getByRole("group", { name: "Placeholder content payment_label editor" });

    expect(within(editor).getByRole("button", { name: "Insert {{amount}}" })).toBeTruthy();
    expect(within(editor).queryByRole("button", { name: "Insert {{payment_label}}" })).toBeNull();
  });

  it("shows a corrupt profile as resettable while valid other type stays editable", async () => {
    const resetAction = vi.fn().mockResolvedValue({ ok: true, paymentType: "INSTALLMENTS", profile: DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS, preview: "Default preview" });
    renderProfileForm({
      resetAction,
      resolved: {
        ONE_TIME: { kind: "VALID", profile: DEFAULT_LINE_DUE_PROFILES.ONE_TIME },
        INSTALLMENTS: { kind: "INVALID" },
      },
    });

    expect((screen.getByLabelText("One-time payment message") as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Installments" }));
    expect(screen.getByRole("alert").textContent).toMatch(/stored profile is invalid/i);
    expect((screen.getByLabelText("Installment payment message") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Preview message" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));

    await waitFor(() => {
      expect(resetAction).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("keeps unsaved edits independent while saving or resetting the other tab", async () => {
    const { saveAction, resetAction } = renderProfileForm();
    const oneTime = screen.getByLabelText("One-time payment message") as HTMLTextAreaElement;
    fireEvent.change(oneTime, { target: { value: "One-time draft {{amount}} {{due_date}} {{payment_url}}" } });
    fireEvent.click(screen.getByRole("tab", { name: "Installments" }));
    const installment = screen.getByLabelText("Installment payment message") as HTMLTextAreaElement;
    fireEvent.change(installment, { target: { value: "Installment draft {{amount}} {{due_date}} {{payment_url}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalledOnce());
    expect((saveAction.mock.calls[0][0] as FormData).get("payment_type")).toBe("INSTALLMENTS");
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));
    await waitFor(() => expect(resetAction).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("tab", { name: "One-time payment" }));
    expect((screen.getByLabelText("One-time payment message") as HTMLTextAreaElement).value).toContain("One-time draft");
  });
});

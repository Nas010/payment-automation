/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DriveStorageForm } from "./drive-storage-form";

const serviceAccountEmail = "payments@example.iam.gserviceaccount.com";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriveStorageForm", () => {
  it("shows safe connection metadata and copies the service-account email", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(createElement(DriveStorageForm, {
      action: vi.fn(),
      serviceAccountEmail,
      source: "workbook",
      folderName: "Private payment slips",
      validatedAt: "2026-08-11T12:00:00.000Z",
    }));

    expect(screen.getByText(serviceAccountEmail)).toBeTruthy();
    expect(screen.getByText(/Workbook · Private payment slips/)).toBeTruthy();
    expect((screen.getByLabelText("Drive folder URL or ID") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Copy email" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(serviceAccountEmail));
    expect(container.textContent).not.toContain("private_key");
  });

  it("clears a successful switch and preserves a failed submission for correction", async () => {
    const action = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: "FAILED", message: "Service account needs Editor access to this folder.", validatedAt: "2026-08-11T12:00:00.000Z" })
      .mockResolvedValueOnce({ ok: true, status: "VALID", message: "Google Drive folder connected.", folderName: "New folder", validatedAt: "2026-08-11T12:01:00.000Z" });
    render(createElement(DriveStorageForm, { action, serviceAccountEmail, source: "environment" }));
    const input = screen.getByLabelText("Drive folder URL or ID") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "folder-12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Test" }));

    await waitFor(() => expect(screen.getByText("Service account needs Editor access to this folder.")).toBeTruthy());
    expect(input.value).toBe("folder-12345");

    fireEvent.click(screen.getByRole("button", { name: "Save & Test" }));
    await waitFor(() => expect(screen.getByText("Google Drive folder connected.")).toBeTruthy());
    expect(input.value).toBe("");
  });

  it("reports a safe error when the server action rejects", async () => {
    const action = vi.fn().mockRejectedValue(new Error("private server failure"));
    render(createElement(DriveStorageForm, { action, serviceAccountEmail, source: "unconfigured" }));
    const input = screen.getByLabelText("Drive folder URL or ID") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "folder-12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Test" }));

    await waitFor(() => expect(screen.getByText("Could not connect Google Drive. Try again.")).toBeTruthy());
    expect(input.value).toBe("folder-12345");
    expect(document.body.textContent).not.toContain("private server failure");
  });
});

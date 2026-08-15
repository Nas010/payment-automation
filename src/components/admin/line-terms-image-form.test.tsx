/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/image", () => ({
  default: (imageProps: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    const { unoptimized, ...props } = imageProps;
    void unoptimized;
    return React.createElement("img", props);
  },
}));

import { LineTermsImageForm } from "./line-terms-image-form";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows upload guidance and disables upload without configured Drive", () => {
  render(createElement(LineTermsImageForm, { image: null, driveConnected: false, action: vi.fn() }));
  expect(screen.getByText(/same connected Google Drive folder/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Upload T&S image" })).toBeDisabled();
});

it("shows corrupt stored configuration safely", () => {
  render(createElement(LineTermsImageForm, { image: null, driveConnected: true, error: "T&S image configuration needs attention.", action: vi.fn() }));
  expect(screen.getByText("T&S image configuration needs attention.")).toBeTruthy();
});

it("shows current preview and submits a replacement file", async () => {
  const action = vi.fn().mockResolvedValue({ ok: true, status: "SAVED", message: "T&S image saved." });
  render(createElement(LineTermsImageForm, {
    image: { previewUrl: "/api/line/terms-image/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", uploadedAt: "2026-08-15T01:00:00.000Z" },
    driveConnected: true,
    action,
  }));
  expect(screen.getByRole("img", { name: "Current terms and conditions" })).toBeTruthy();
  const file = new File([new Uint8Array([255, 216, 255])], "replacement.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("T&S image"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Replace T&S image" }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  const submitted = (action.mock.calls[0][0] as FormData).get("terms_image");
  expect(submitted).toBeInstanceOf(File);
  expect((submitted as File).name).toBe("replacement.jpg");
  expect((submitted as File).type).toBe("image/jpeg");
  expect(screen.getByText("T&S image saved.")).toBeTruthy();
});

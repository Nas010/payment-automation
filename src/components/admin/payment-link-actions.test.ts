/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PaymentLinkActions } from "./payment-link-actions";

vi.stubGlobal("React", React);

const paymentUrl = "https://payments.example/p/secure-token";
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
});

describe("PaymentLinkActions", () => {
  it("renders a safe new-tab link to the public payment page", () => {
    const { getByRole } = render(createElement(PaymentLinkActions, { paymentUrl }));

    const openLink = getByRole("link", { name: "Open payment page" });
    expect(openLink).toHaveAttribute("href", paymentUrl);
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(openLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("copies the public payment URL and confirms success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { getByRole } = render(createElement(PaymentLinkActions, { paymentUrl }));

    fireEvent.click(getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(paymentUrl));
    expect(getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("reports clipboard failure without removing the open link", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const { getByRole } = render(createElement(PaymentLinkActions, { paymentUrl }));

    fireEvent.click(getByRole("button", { name: "Copy link" }));

    expect(await waitFor(() => getByRole("button", { name: "Copy failed" }))).toBeTruthy();
    expect(getByRole("link", { name: "Open payment page" })).toHaveAttribute("href", paymentUrl);
  });

  it("shows an unavailable state when no payment URL exists", () => {
    const { getByText, queryByRole } = render(createElement(PaymentLinkActions, { paymentUrl: "" }));

    expect(getByText("Link unavailable")).toBeTruthy();
    expect(queryByRole("link")).toBeNull();
    expect(queryByRole("button")).toBeNull();
  });
});

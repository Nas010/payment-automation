/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toDataURL } = vi.hoisted(() => ({ toDataURL: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toDataURL } }));

import { RuntimeConfigForm } from "./runtime-config-form";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  toDataURL.mockResolvedValue("data:image/png;base64,qr-preview");
});

describe("RuntimeConfigForm", () => {
  it("gates completion until the PromptPay identifier produces a real payload preview", async () => {
    render(<RuntimeConfigForm action={vi.fn()} defaultBaseUrl="https://pay.example" />);
    const finish = screen.getByRole("button", { name: "Run checks and finish setup" });
    expect(finish).toBeDisabled();

    fireEvent.change(screen.getByLabelText("PromptPay identifier"), { target: { value: "123" } });
    expect(await screen.findByText("PromptPay phone number must contain 10 Thai digits")).toBeTruthy();
    expect(finish).toBeDisabled();

    fireEvent.change(screen.getByLabelText("PromptPay identifier"), { target: { value: "0812345678" } });
    await waitFor(() => expect(screen.getByAltText("PromptPay QR preview")).toHaveAttribute("src", "data:image/png;base64,qr-preview"));
    expect(finish).toBeEnabled();
  });
});

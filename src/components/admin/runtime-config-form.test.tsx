/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toDataURL } = vi.hoisted(() => ({ toDataURL: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toDataURL } }));

import { RuntimeConfigForm } from "./runtime-config-form";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  toDataURL.mockResolvedValue("data:image/png;base64,qr-preview");
});

afterEach(() => {
  cleanup();
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

  it("shows saved public LINE app identifiers in dashboard settings", () => {
    render(<RuntimeConfigForm
      action={vi.fn()}
      defaultBaseUrl="https://pay.example"
      allowLineFeatures
      submitLabel="Save settings"
      initial={{
        businessDisplayName: "Coach Bee",
        promptPayType: "phone",
        promptPayIdentifier: "0812345678",
        recipientNameEn: "Bee Example",
        recipientNameTh: "บี",
        recipientAliases: ["Coach Bee"],
        publicBaseUrl: "https://pay.example",
        slipRetentionDays: 30,
        ocrEnabled: true,
        lineLiffId: "1234567890-AbCdEf",
        lineLoginChannelId: "1234567890",
        lineLinkingEnabled: true,
        lineMessagingEnabled: false,
        lineChatPaymentsEnabled: false,
      }}
    />);

    expect(screen.getByLabelText("LIFF ID")).toHaveValue("1234567890-AbCdEf");
    expect(screen.getByLabelText("LINE Login channel ID")).toHaveValue("1234567890");
    expect(screen.getByText("These are public identifiers, not LINE credentials.")).toBeTruthy();
  });
});

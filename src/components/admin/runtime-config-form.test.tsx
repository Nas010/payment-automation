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
    expect(screen.getByRole("button", { name: "About LIFF ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About LINE Login channel ID" })).toBeInTheDocument();
    expect(screen.queryByText("These are public identifiers, not LINE credentials.")).not.toBeInTheDocument();
    expect(screen.queryByText("From the LIFF app configured for /line/connect.")).not.toBeInTheDocument();
    expect(screen.queryByText("The numeric channel ID that owns the LIFF app.")).not.toBeInTheDocument();
    expect(screen.queryByText("A valid identifier produces a ฿1 QR preview.")).not.toBeInTheDocument();
  });

  it("turns comma-separated recipient aliases into removable pills", () => {
    render(<RuntimeConfigForm
      action={vi.fn()}
      defaultBaseUrl="https://pay.example"
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
        lineLiffId: "",
        lineLoginChannelId: "",
        lineLinkingEnabled: false,
        lineMessagingEnabled: false,
        lineChatPaymentsEnabled: false,
      }}
    />);

    const aliases = screen.getByRole("textbox", { name: "Recipient aliases" });
    fireEvent.change(aliases, { target: { value: "Bee Example, Bee Coaching" } });
    expect(screen.getByText("Coach Bee")).toBeInTheDocument();
    expect(screen.getByText("Bee Example")).toBeInTheDocument();

    fireEvent.keyDown(aliases, { key: "Enter" });
    expect(screen.getByText("Bee Coaching")).toBeInTheDocument();
    expect(document.querySelector('input[name="recipient_aliases"]')).toHaveValue("Coach Bee, Bee Example, Bee Coaching");

    fireEvent.click(screen.getByRole("button", { name: "Remove Bee Example" }));
    expect(screen.queryByText("Bee Example")).not.toBeInTheDocument();
    expect(document.querySelector('input[name="recipient_aliases"]')).toHaveValue("Coach Bee, Bee Coaching");
  });
});

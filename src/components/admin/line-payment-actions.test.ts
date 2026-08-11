/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinePaymentActions } from "./line-payment-actions";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LinePaymentActions", () => {
  it("sends one payment request and stops awaiting a LINE slip", async () => {
    const sendAction = vi.fn().mockResolvedValue({ outcome: "SENT" });
    const stopAwaitingAction = vi.fn().mockResolvedValue(true);
    render(createElement(LinePaymentActions, {
      paymentId: "pay_1",
      messageStatus: "FAILED_RETRYABLE",
      slipExpected: true,
      slipProcessingStatus: "AWAITING",
      sendAction,
      stopAwaitingAction,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Send LINE payment request" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledWith("pay_1"));
    await screen.findByText("LINE payment request sent.");
    fireEvent.click(screen.getByRole("button", { name: "Stop awaiting LINE slip" }));
    await waitFor(() => expect(stopAwaitingAction).toHaveBeenCalledWith("pay_1"));
    expect(screen.getByText("Stopped awaiting a LINE slip.")).toBeTruthy();
  });

  it("refuses an already accepted request instead of exposing resend control", () => {
    render(createElement(LinePaymentActions, {
      paymentId: "pay_1",
      messageStatus: "ACCEPTED",
      slipExpected: false,
      slipProcessingStatus: "",
      sendAction: vi.fn(),
      stopAwaitingAction: vi.fn(),
    }));

    expect(screen.getByText("LINE accepted this payment request.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send LINE payment request" })).toBeNull();
  });
});

/** @vitest-environment jsdom */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MessagesSettingsWorkspace } from "./messages-settings-workspace";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MessagesSettingsWorkspace", () => {
  it("shows one message editor at a time", () => {
    render(<MessagesSettingsWorkspace
      welcome={<p>Welcome editor</p>}
      automaticReplies={<p>Replies editor</p>}
      paymentMessages={<p>Payment editor</p>}
      reminders={<p>Reminder editor</p>}
    />);

    expect(screen.getByRole("tab", { name: /Welcome message/ })).toHaveAttribute("data-active", "");
    expect(screen.getByText("Welcome editor")).toBeInTheDocument();
    expect(screen.queryByText("Payment editor")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Payment messages/ }));

    expect(screen.getByText("Payment editor")).toBeInTheDocument();
    expect(screen.queryByText("Welcome editor")).not.toBeInTheDocument();
  });
});

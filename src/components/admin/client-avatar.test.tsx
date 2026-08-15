/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => React.createElement("img", props),
}));

import { ClientAvatar } from "./client-avatar";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => cleanup());

describe("ClientAvatar", () => {
  it("renders a LINE profile picture with client-identifying alt text", () => {
    render(<ClientAvatar clientName="Nisa" lineDisplayName="Nisa LINE" pictureUrl="https://profile.line-scdn.net/avatar/path" />);

    expect(screen.getByRole("img", { name: "LINE profile picture for Nisa" })).toHaveAttribute("src", "https://profile.line-scdn.net/avatar/path");
  });

  it("uses LINE-name initials when no picture is available", () => {
    render(<ClientAvatar clientName="Nisa" lineDisplayName="Nisa LINE" pictureUrl="" />);

    expect(screen.getByText("NL")).toBeInTheDocument();
  });

  it("falls back to client initials when the remote picture fails", () => {
    render(<ClientAvatar clientName="Nisa" lineDisplayName="" pictureUrl="https://profile.line-scdn.net/avatar/path" />);

    fireEvent.error(screen.getByRole("img", { name: "LINE profile picture for Nisa" }));
    expect(screen.getByText("N")).toBeInTheDocument();
  });
});

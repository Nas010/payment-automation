/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PackageActiveToggle } from "./package-active-toggle";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("PointerEvent", MouseEvent);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PackageActiveToggle", () => {
  it("persists an enabled package being disabled", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(createElement(PackageActiveToggle, { rowNumber: 4, active: true, action }));

    fireEvent.click(screen.getByRole("switch", { name: "Package active" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const formData = action.mock.calls[0][0] as FormData;
    expect(formData.get("package_row")).toBe("4");
    expect(formData.get("active")).toBe("FALSE");
  });
});

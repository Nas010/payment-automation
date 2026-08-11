import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminWorkbookError from "./error";

describe("AdminWorkbookError", () => {
  it("explains transient quota recovery without claiming a write was rolled back", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(React.createElement(AdminWorkbookError, { error: new Error("quota"), reset: vi.fn() }));

    expect(html).toContain("temporarily unavailable");
    expect(html).toContain("rate-limited");
    expect(html).toContain("previous change may already have been saved");
    expect(html).not.toContain("No workbook data has been changed");
    expect(html).not.toContain("Set server-side Sheets credentials");
  });
});

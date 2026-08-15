import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MessageTestPage from "./page";

beforeEach(() => vi.stubGlobal("React", React));

describe("LINE message test page", () => {
  it("renders a data-free non-payment warning", async () => {
    const html = renderToStaticMarkup(await MessageTestPage());

    expect(html).toContain("Test message only");
    expect(html).toContain("No payment is due");
    expect(html).not.toContain("form");
    expect(html).not.toContain("promptpay");
  });
});

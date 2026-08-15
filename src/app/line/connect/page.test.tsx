import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runtimeConfig } = vi.hoisted(() => ({ runtimeConfig: vi.fn() }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfig }));

import LineConnectPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
});

describe("LineConnectPage", () => {
  it("initializes the client with the dashboard-managed LIFF ID", async () => {
    runtimeConfig.mockResolvedValue({ lineLiffId: "1234567890-Dashboard" });

    const page = await LineConnectPage({ searchParams: Promise.resolve({ token: "connection-token" }) });
    const client = page.props.children;

    expect(client.props).toMatchObject({
      liffId: "1234567890-Dashboard",
      connectionToken: "connection-token",
    });
  });

  it("keeps the existing safe failure state when runtime settings cannot load", async () => {
    runtimeConfig.mockRejectedValue(new Error("workspace unavailable"));

    const page = await LineConnectPage({ searchParams: Promise.resolve({ token: "connection-token" }) });

    expect(page.props.children.props.liffId).toBe("");
  });
});

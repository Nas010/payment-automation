import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverConfig: vi.fn(),
  listClients: vi.fn(),
  upsertOperationalSetting: vi.fn(),
  bangkokDateKey: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ serverConfig: mocks.serverConfig }));
vi.mock("@/lib/sheets/clients", () => ({ listClients: mocks.listClients }));
vi.mock("@/lib/sheets/settings", () => ({ upsertOperationalSetting: mocks.upsertOperationalSetting }));
vi.mock("@/lib/date", () => ({ bangkokDateKey: mocks.bangkokDateKey }));

async function loadRoute() {
  try {
    return await import("./route");
  } catch {
    return null;
  }
}

function request(authorized = true): NextRequest {
  return new NextRequest("https://app.test/api/cron/dashboard-metrics", { headers: authorized ? { authorization: "Bearer cron-secret" } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverConfig.mockReturnValue({ cronSecret: "cron-secret" });
  mocks.bangkokDateKey.mockReturnValue("2026-08-01");
  mocks.listClients.mockResolvedValue([{ active: "TRUE" }, { active: "FALSE" }, { active: "true" }]);
  mocks.upsertOperationalSetting.mockResolvedValue(undefined);
});

describe("GET /api/cron/dashboard-metrics", () => {
  it("rejects requests without its bearer secret before any workbook read", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;

    await expect(route.GET(request(false))).resolves.toMatchObject({ status: 401 });
    expect(mocks.listClients).not.toHaveBeenCalled();
    expect(mocks.upsertOperationalSetting).not.toHaveBeenCalled();
  });

  it("does not access Sheets outside the Bangkok first-day snapshot window", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;
    mocks.bangkokDateKey.mockReturnValue("2026-08-15");

    const response = await route.GET(request());

    await expect(response.json()).resolves.toEqual({ skipped: true });
    expect(mocks.listClients).not.toHaveBeenCalled();
    expect(mocks.upsertOperationalSetting).not.toHaveBeenCalled();
  });

  it("stores the completed month's active-client count", async () => {
    const route = await loadRoute();
    expect(route).not.toBeNull();
    if (!route) return;

    const response = await route.GET(request());

    await expect(response.json()).resolves.toEqual({ month: "2026-07", activeClients: 2 });
    expect(mocks.upsertOperationalSetting).toHaveBeenCalledWith("dashboard_active_clients_2026-07", "2");
  });
});

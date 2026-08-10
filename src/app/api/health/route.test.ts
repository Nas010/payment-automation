import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("health route", () => {
  it("reports safe configuration state", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, status: "needs_configuration" });
  });
});

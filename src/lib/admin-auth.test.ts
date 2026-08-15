import { describe, expect, it } from "vitest";
import { adminSessionCookieOptions, createAdminSessionValue, decodeAdminSession, isValidAdminSession } from "./admin-auth";

const owner = { googleSub: "google-sub-1", email: "owner@example.com" };

describe("admin session values", () => {
  it("uses lax cookies so OAuth callbacks keep the admin session", () => {
    expect(adminSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/admin",
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  it("keeps a session valid for 30 days", () => {
    const now = Date.parse("2026-08-15T00:00:00.000Z");
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const value = createAdminSessionValue("secret-value", owner, now);

    expect(decodeAdminSession(value, "secret-value", now + thirtyDays - 1_000)).not.toBeNull();
    expect(decodeAdminSession(value, "secret-value", now + thirtyDays)).toBeNull();
  });

  it("accepts a session signed with the configured admin secret", () => {
    const value = createAdminSessionValue("secret-value", owner);

    expect(isValidAdminSession(value, "secret-value", owner)).toBe(true);
    expect(decodeAdminSession(value, "secret-value")).toMatchObject({ sub: owner.googleSub, email: owner.email });
  });

  it("rejects a session after either its cookie or configured secret changes", () => {
    const value = createAdminSessionValue("secret-value", owner);

    expect(isValidAdminSession(`${value}x`, "secret-value", owner)).toBe(false);
    expect(isValidAdminSession(value, "another-secret", owner)).toBe(false);
  });

  it("rejects a validly signed session belonging to a different Google owner", () => {
    const value = createAdminSessionValue("secret-value", owner);

    expect(isValidAdminSession(value, "secret-value", { googleSub: "other-sub", email: "other@example.com" })).toBe(false);
  });
});

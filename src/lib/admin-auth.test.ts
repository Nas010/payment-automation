import { describe, expect, it } from "vitest";
import { adminSessionCookieOptions, createAdminSessionValue, isValidAdminSession } from "./admin-auth";

describe("admin session values", () => {
  it("uses lax cookies so OAuth callbacks keep the admin session", () => {
    expect(adminSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/admin",
      maxAge: 60 * 60 * 8,
    });
  });

  it("accepts a session signed with the configured admin secret", () => {
    const value = createAdminSessionValue("secret-value");

    expect(isValidAdminSession(value, "secret-value")).toBe(true);
  });

  it("rejects a session after either its cookie or configured secret changes", () => {
    const value = createAdminSessionValue("secret-value");

    expect(isValidAdminSession(`${value}x`, "secret-value")).toBe(false);
    expect(isValidAdminSession(value, "another-secret")).toBe(false);
  });
});

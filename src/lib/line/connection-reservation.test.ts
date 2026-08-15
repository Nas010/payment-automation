import { describe, expect, it } from "vitest";
import { isLineReservationConflict, lineReservationName } from "./connection-reservation";

describe("LINE connection reservations", () => {
  it("uses one hashed namespace across client and test claims", () => {
    expect(lineReservationName("user", "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .toMatch(/^line_link_user_[a-f0-9]{64}$/);
    expect(lineReservationName("token", "a".repeat(64)))
      .toBe(lineReservationName("token", "a".repeat(64)));
  });

  it("recognizes only Sheets duplicate named-range conflicts", () => {
    expect(isLineReservationConflict(Object.assign(new Error("Named range already exists"), { response: { status: 400 } }))).toBe(true);
    expect(isLineReservationConflict(new Error("network failure"))).toBe(false);
  });
});

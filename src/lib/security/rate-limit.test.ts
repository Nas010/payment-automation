import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("rejects sixth submission in its window", () => {
    const limiter = new RateLimiter(5, 60_000);
    for (let index = 0; index < 5; index += 1) expect(limiter.allow("token:ip", 1000)).toBe(true);
    expect(limiter.allow("token:ip", 1000)).toBe(false);
  });
});

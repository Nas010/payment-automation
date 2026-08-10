export class RateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.requests.get(key) ?? []).filter((time) => time > now - this.windowMs);
    if (recent.length >= this.limit) return false;
    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}

export const paymentSubmissionLimiter = new RateLimiter(5, 60 * 60 * 1000);

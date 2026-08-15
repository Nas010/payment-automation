# LINE Profile Refresh Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-safe Vercel diagnostics for automatic LINE profile refreshes.

**Architecture:** Keep profile refresh best-effort inside the existing webhook handler. Split lookup and persistence failure boundaries only to emit fixed outcome labels, then preserve the existing HTTP 200 acknowledgement behavior.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest, Vercel runtime logs.

## Global Constraints

- Log fixed outcome labels plus `image=present|missing` only; never log LINE IDs, profile URLs, tokens, message content, spreadsheet data, or raw errors.
- Keep signed-webhook acknowledgement and all payment/slip behavior unchanged.
- Use test-first regression coverage before route changes.

---

### Task 1: Log profile-refresh outcomes safely

**Files:**
- Modify: `src/app/api/line/webhook/route.test.ts`
- Modify: `src/app/api/line/webhook/route.ts`

**Interfaces:**
- Consumes: `processProfileEvent({ lineUserId })` for signed direct-user follow/message events.
- Produces: Vercel-visible `[line-webhook] profile_refresh outcome=<label>` logs.

- [ ] **Step 1: Write failing tests**

```ts
const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
await POST(signedRequest({ events: [event({ message: { type: "text", text: "hello" } })] }));
expect(info).toHaveBeenCalledWith("[line-webhook] profile_refresh outcome=updated");

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
await POST(signedRequest({ events: [event({ message: { type: "text", text: "hello" } })] }));
expect(warn).toHaveBeenCalledWith("[line-webhook] profile_refresh outcome=profile_lookup_failed");
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/app/api/line/webhook/route.test.ts`

Expected: FAIL because the route emits no profile-refresh outcome logs.

- [ ] **Step 3: Write minimal implementation**

```ts
console.info("[line-webhook] profile_refresh outcome=updated");
console.warn("[line-webhook] profile_refresh outcome=profile_lookup_failed");
console.warn("[line-webhook] profile_refresh outcome=persistence_failed");
```

Use only these fixed strings; do not interpolate event or error values.

- [ ] **Step 4: Run focused tests to verify pass**

Run: `npx vitest run src/app/api/line/webhook/route.test.ts`

Expected: PASS with existing webhook behavior unchanged.

- [ ] **Step 5: Run full validation**

Run: `npm run lint && npm test && npm run build`

Expected: all commands exit 0; existing unrelated `<img>` warnings may remain.

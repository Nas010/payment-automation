# LINE Avatar Reconnect Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist trusted LINE profile image data when an already-linked user revisits their connection link.

**Architecture:** Keep `createLineConnectionService.claim` as the only behavior boundary. Its idempotent same-user path will write profile display fields through its existing optimistic Sheets update dependency, then preserve the existing `ALREADY_LINKED` result.

**Tech Stack:** Next.js, TypeScript, Vitest, Google Sheets client abstraction.

## Global Constraints

- Accept only server-verified `displayName` and `pictureUrl` passed into the service.
- Do not alter LINE user ownership, link status, link-token fields, or payment delivery behavior.
- Use a focused TDD regression test and run the project validation commands before handoff.

---

### Task 1: Refresh profile fields on idempotent connection

**Files:**
- Modify: `src/lib/line/connection.test.ts`
- Modify: `src/lib/line/connection.ts`

**Interfaces:**
- Consumes: `createLineConnectionService(dependencies).claim({ token, lineUserId, displayName, pictureUrl, now })`
- Produces: `{ status: "ALREADY_LINKED", clientId }` after an optimistic profile-field update.

- [ ] **Step 1: Write failing test**

```ts
await expect(service.claim({ token: tokenA, lineUserId: userA, displayName: "Nisa Updated", pictureUrl, now }))
  .resolves.toEqual({ status: "ALREADY_LINKED", clientId: "client_1" });
expect(deps.updateLineLinkClient).toHaveBeenCalledWith(expect.objectContaining({
  client: expect.objectContaining({
    line_user_id: userA,
    line_display_name: "Nisa Updated",
    line_picture_url: pictureUrl,
    line_link_status: "LINKED",
  }),
}));
expect(deps.claimLineConnection).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/lib/line/connection.test.ts`

Expected: FAIL because the idempotent branch does not call `updateLineLinkClient`.

- [ ] **Step 3: Write minimal implementation**

```ts
if (target.line_user_id === lineUserId) {
  await dependencies.updateLineLinkClient({
    client: { ...target, line_display_name: sheetSafeDisplayName(displayName), line_picture_url: pictureUrl, updated_at: nowIso(now) },
    expectedClient: target,
  });
  return { status: "ALREADY_LINKED", clientId: target.client_id };
}
```

- [ ] **Step 4: Run focused test to verify pass**

Run: `npx vitest run src/lib/line/connection.test.ts`

Expected: PASS with the new idempotent profile-refresh test and existing connection tests.

- [ ] **Step 5: Run full validation**

Run: `npm run lint && npm test && npm run build`

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/line/connection.ts src/lib/line/connection.test.ts docs/superpowers/specs/2026-08-16-line-avatar-reconnect-design.md docs/superpowers/plans/2026-08-16-line-avatar-reconnect-refresh.md
git commit -m "fix: refresh LINE avatar on reconnect"
```

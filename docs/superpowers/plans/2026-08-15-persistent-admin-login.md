# Persistent Admin Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep verified admin sessions valid for 30 days and force Google to show its account chooser for every authorization flow.

**Architecture:** Retain the existing stateless HMAC-signed admin cookie and change its one shared lifetime constant, keeping browser `maxAge` and signed `exp` aligned. Retain the existing OAuth route and add `select_account` to its space-delimited Google prompt while preserving explicit consent and all owner checks.

**Tech Stack:** Next.js 15 App Router, strict TypeScript, `google-auth-library`, Vitest.

## Global Constraints

- Session lifetime is an absolute 30 days, not sliding.
- Preserve `HttpOnly`, production `Secure`, `SameSite=Lax`, and `/admin` cookie scope.
- Preserve HMAC signing with `ADMIN_SECRET` and installation-owner `sub`/email validation.
- Preserve manual Sign out and secret-rotation invalidation.
- Use `prompt: "consent select_account"` for every Google authorization request.
- Selecting a non-owner account must remain rejected by the existing callback.
- Add no dependencies or vendor configuration.
- Preserve all pre-existing uncommitted work; do not stage or commit overlapping user changes.

---

## File Map

- `src/lib/admin-auth.ts` — creates and validates the stateless admin session and owns its lifetime.
- `src/lib/admin-auth.test.ts` — verifies cookie attributes, signed identity, and exact expiry boundary.
- `src/app/admin/google-drive/connect/route.ts` — creates Google authorization URLs.
- `src/app/admin/google-drive/connect/route.test.ts` — verifies authorization parameters and OAuth flow cookies.
- `README.md` — documents production admin-session lifetime.

### Task 1: Thirty-Day Admin Session

**Files:**
- Modify: `src/lib/admin-auth.test.ts:6-35`
- Modify: `src/lib/admin-auth.ts:7-24`
- Modify: `README.md:20`

**Interfaces:**
- Consumes: `createAdminSessionValue(secret: string, identity: GoogleOwnerIdentity, now?: number): string`
- Consumes: `decodeAdminSession(value: string | undefined, secret: string, now?: number): SessionPayload | null`
- Produces: unchanged interfaces with a 30-day signed expiry and cookie `maxAge`

- [ ] **Step 1: Write failing cookie-lifetime assertion**

Change the existing option assertion in `src/lib/admin-auth.test.ts`:

```ts
expect(adminSessionCookieOptions()).toMatchObject({
  httpOnly: true,
  sameSite: "lax",
  path: "/admin",
  maxAge: 60 * 60 * 24 * 30,
});
```

- [ ] **Step 2: Write failing signed-expiry boundary test**

Add inside `describe("admin session values", ...)`:

```ts
it("keeps a session valid for 30 days", () => {
  const now = Date.parse("2026-08-15T00:00:00.000Z");
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const value = createAdminSessionValue("secret-value", owner, now);

  expect(decodeAdminSession(value, "secret-value", now + thirtyDays - 1_000)).not.toBeNull();
  expect(decodeAdminSession(value, "secret-value", now + thirtyDays)).toBeNull();
});
```

- [ ] **Step 3: Run focused test and verify RED**

Run:

```bash
npx vitest run src/lib/admin-auth.test.ts
```

Expected: FAIL because cookie `maxAge` and signed `exp` are still eight hours.

- [ ] **Step 4: Change shared session lifetime**

In `src/lib/admin-auth.ts`, replace the lifetime constant with:

```ts
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
```

Do not change cookie flags, payload fields, signature generation, owner validation, or logout behavior.

- [ ] **Step 5: Update lifetime documentation**

In `README.md`, change the `ADMIN_SECRET` entry to:

```markdown
- `ADMIN_SECRET` — signs 30-day owner sessions.
```

- [ ] **Step 6: Run focused test and verify GREEN**

Run:

```bash
npx vitest run src/lib/admin-auth.test.ts
```

Expected: PASS with both cookie and signed-payload lifetime tests green.

### Task 2: Forced Google Account Picker

**Files:**
- Modify: `src/app/admin/google-drive/connect/route.test.ts:57-82`
- Modify: `src/app/admin/google-drive/connect/route.ts:42-55`

**Interfaces:**
- Consumes: `OAuth2Client.generateAuthUrl(opts: GenerateAuthUrlOpts): string`
- Produces: Google authorization options containing `prompt: "consent select_account"`

- [ ] **Step 1: Write failing OAuth prompt assertion**

In the existing authorization-options expectation, change:

```ts
prompt: "consent select_account",
```

Keep assertions for `access_type`, scopes, state, nonce, and PKCE unchanged.

- [ ] **Step 2: Run focused route test and verify RED**

Run:

```bash
npx vitest run src/app/admin/google-drive/connect/route.test.ts
```

Expected: FAIL showing received prompt `"consent"` instead of `"consent select_account"`.

- [ ] **Step 3: Add account selection to Google prompt**

In `src/app/admin/google-drive/connect/route.ts`, set:

```ts
prompt: "consent select_account",
```

Do not change intent parsing, reconnect authorization, state, nonce, PKCE, scopes, or flow-cookie settings.

- [ ] **Step 4: Run focused route test and verify GREEN**

Run:

```bash
npx vitest run src/app/admin/google-drive/connect/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run combined regression tests**

Run:

```bash
npx vitest run src/lib/admin-auth.test.ts src/lib/admin-auth-backend-errors.test.ts src/app/admin/google-drive/connect/route.test.ts src/app/admin/google-drive/callback/route.test.ts src/app/admin/login/page.test.tsx
```

Expected: PASS. Existing non-owner rejection, OAuth error handling, login UI, and backend-error behavior remain green.

### Task 3: Full Verification

**Files:**
- Verify only; no production changes expected.

**Interfaces:**
- Consumes: completed Tasks 1 and 2
- Produces: fresh lint, test, and production-build evidence

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: exit 0 with no ESLint errors.

- [ ] **Step 2: Run complete test suite**

Run:

```bash
npm test
```

Expected: exit 0 with zero failing Vitest tests.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: exit 0 with a successful Next.js production build.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff -- README.md src/lib/admin-auth.ts src/lib/admin-auth.test.ts src/app/admin/google-drive/connect/route.ts src/app/admin/google-drive/connect/route.test.ts
```

Expected: requested changes are limited to 30-day session lifetime, exact expiry tests, forced account selection, and matching README wording. Pre-existing changes remain intact and unstaged.

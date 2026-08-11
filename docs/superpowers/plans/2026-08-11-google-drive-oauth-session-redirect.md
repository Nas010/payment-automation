# Google Drive OAuth Session Redirect Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the authenticated admin session across Google’s cross-site OAuth callback so folder selection returns to Settings instead of the login page.

**Architecture:** Keep the existing signed admin session and OAuth state/PKCE flow. Change only the admin session cookie’s SameSite policy from Strict to Lax, which permits the top-level OAuth callback while still excluding the cookie from cross-site POST requests. Add a cookie-option regression test, run the full verification suite, then deploy the merged main branch.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Vercel.

## Global Constraints

- Do not log or expose admin secrets, OAuth tokens, refresh tokens, or private Drive data.
- Preserve signed session validation and existing cookie path, TTL, secure, and HttpOnly settings.
- Verify with fresh tests, lint, and production build before claiming completion.

### Task 1: Add regression coverage

**Files:**
- Modify: `src/lib/admin-auth.test.ts`
- Modify: `src/lib/admin-auth.ts`

**Interfaces:**
- Produce a testable `adminSessionCookieOptions()` helper returning the existing session cookie attributes with `sameSite: "lax"`.

- [ ] **Step 1: Write the failing test**

  Add a test that imports `adminSessionCookieOptions` and expects `sameSite` to equal `"lax"`, while preserving `httpOnly`, `/admin`, and the eight-hour max age.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- src/lib/admin-auth.test.ts`

  Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the minimal cookie-option helper**

  Extract the options currently passed to `cookieStore.set` into `adminSessionCookieOptions()` and change only `sameSite` from `"strict"` to `"lax"`.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `npm test -- src/lib/admin-auth.test.ts`

  Expected: PASS.

### Task 2: Verify and ship

**Files:**
- No additional source files.

- [ ] **Step 1: Run project verification**

  Run: `npm run lint && npm test && npm run build`

  Expected: all commands exit 0.

- [ ] **Step 2: Commit the fix**

  Run: `git add src/lib/admin-auth.ts src/lib/admin-auth.test.ts docs/superpowers/plans/2026-08-11-google-drive-oauth-session-redirect.md && git commit -m "fix: preserve admin session through drive oauth"`

- [ ] **Step 3: Merge into main and push**

  Fast-forward the clean main checkout to the commit and push `origin/main` so Vercel deploys the fix.

- [ ] **Step 4: Retest hosted flow**

  From hosted Settings, click Connect Google Drive, approve access, and confirm callback returns to Settings with folder picker available instead of `/admin/login`.

# Google Self-Setup Main Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the verified Google owner login and self-setup production flow durable on `main` without including committed configurable-LINE-placeholder branch work.

**Architecture:** Use the current workspace's uncommitted Google self-setup snapshot commit as the feature source and cherry-pick it onto an isolated branch rooted at `main`. Resolve overlaps in favor of `main`'s shipped LINE/slip fixes plus the snapshot's bootstrap/owner/workspace/runtime-config architecture, then validate and push the resulting commit directly to `main` for Vercel Git deployment.

**Tech Stack:** Next.js 15 App Router, strict TypeScript, Google OAuth/Drive/Sheets APIs, Vitest, Vercel.

## Global Constraints

- Preserve Google owner login, resumable setup wizard, OAuth state/PKCE/nonce verification, operational workbook creation, private slip-folder setup, runtime settings, and safe health states from the verified production artifact.
- Preserve all commits already on `main`, including LINE slip processing and Sheets read-quota fixes.
- Exclude commits `221d293..8030cce` from the configurable-LINE-placeholder branch; only the uncommitted snapshot diff is eligible.
- Do not commit `.env*` secrets, Google tokens, service-account JSON, payment data, or Vercel credentials.
- Run focused Google tests, complete lint/test/build, production smoke health, and hosted route checks before completion.

---

### Task 1: Establish Clean Main Baseline

**Files:** Verify only.

- [ ] Run `npm ci` in the isolated worktree.
- [ ] Run `npm test` and record passing test/file counts for unmodified `main`.
- [ ] Confirm `git status --short --branch` is clean and based on `8a79bff`.

### Task 2: Apply Google Self-Setup Snapshot

**Files:** Apply snapshot `d21e5cc378da6b2ac77a31a86a8afa86cd2f2ebd`.

- [ ] Cherry-pick snapshot without committing.
- [ ] Resolve every conflict by retaining `main` production behavior and adding the snapshot's Google bootstrap/installation/workspace behavior.
- [ ] Confirm configurable LINE profile modules and commits are absent.
- [ ] Inspect staged names for secrets and unrelated files.

### Task 3: Verify Google Behavior

**Files:** Existing Google/self-setup tests supplied by snapshot.

- [ ] Run `npx vitest run src/app/admin/login/page.test.tsx src/lib/admin-auth.test.ts src/lib/admin-auth-backend-errors.test.ts src/app/admin/google-drive/connect/route.test.ts src/app/admin/google-drive/callback/route.test.ts src/lib/installation/repository.test.ts src/lib/workspace/setup.test.ts src/lib/workspace/workbook.test.ts src/app/api/health/route.test.ts`.
- [ ] Run `npm run lint` and require zero errors.
- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run build` and require exit 0.
- [ ] Inspect final staged diff and commit with `feat: add Google workspace self-setup`.

### Task 4: Ship and Verify Production

**Files:** Git/Vercel operations only.

- [ ] Push verified integration commit to `origin/main`.
- [ ] Wait for Vercel production deployment tied to exact pushed SHA to reach `READY`.
- [ ] Verify `/admin/login` returns `Continue with Google`, `/admin/setup` resolves, and `/api/health` returns ready checks.
- [ ] Run repository smoke health and scan Vercel runtime errors after deployment.

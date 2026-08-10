# Sheets Admin MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Sheets-backed protected payment-admin MVP.

**Architecture:** Strongly typed Sheets repositories expose physical rows. Pure plan/status services own financial rules. App Router server pages and actions compose a responsive shadcn UI while preserving public payment URLs.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind, shadcn/ui, Zod, Vitest, Google Sheets API.

## Global Constraints

- Keep Google credentials server-only.
- Preserve public `/p/[token]` workflow.
- Use physical sheet rows for updates.
- Amount math uses satang.

---

### Task 1: Data and domain foundation

**Files:** records/repositories/payment services/tests.

- [ ] Write failing unit tests for schedule split/date clamp, physical-row updates, due generation, and status transition.
- [ ] Implement typed repositories and pure domain services.
- [ ] Run focused tests, then full tests.

### Task 2: Protected admin application

**Files:** admin layout/routes/actions/components/UI dependencies.

- [ ] Add shadcn/Tailwind dependencies and base components.
- [ ] Implement admin session, shared layout, tables/forms and all specified pages.
- [ ] Connect create/generate/review/package/settings flows to domain services.
- [ ] Run lint, tests, production build, and browser smoke check.

# Automated PromptPay Coaching Payment Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy trusted-client PromptPay payment collection with private Google Sheets admin workbook and local slip heuristics.

**Architecture:** Next.js App Router implements server-only Sheets/Drive access plus public token pages. Pure domain modules decode/normalize/evaluate slip signals before an adapter persists a status and audit row to the new workbook.

**Tech Stack:** Next.js, TypeScript, Google APIs, Zod, qrcode, PromptPay EMV encoder, @zxing/library, sharp, tesseract.js, Vitest, Playwright, Vercel.

## Global Constraints

- Create a fresh private workbook named `Coaching Payments - Automated`; never reuse/migrate existing data.
- Create exactly six tabs: Dashboard, Clients, Payments, Review Queue, Settings, Audit Log.
- Spreadsheet is primary system of record; no database or paid verifier/bank automation.
- Auto outcomes only `AUTO_RECORDED`, `REVIEW`, `FLAGGED`, `MANUAL_CONFIRMED`; never call results bank verified.
- All money comparisons use integer satang, timezone is `Asia/Bangkok`, token entropy ≥256 bits.

---

### Task 1: Bootstrap Project and Exact Domain Contracts

**Files:** Create `package.json`, TypeScript/Next/Vitest configuration, `.env.example`, `README.md`, `src/lib/schema.ts`, `src/lib/config.ts`, `src/lib/money.ts`, `src/lib/date.ts`; tests beside modules.

- [ ] Write a failing test for exact six workbook tab names, required Settings rows, satang conversion (`฿3,000`, `3,000.00`, `THB 3,000.00` -> `300000`), Buddhist `2569` -> `2026`, and missing config.
- [ ] Run `npm test -- --run src/lib/{schema,money,date,config}.test.ts`; confirm expected missing-module failure.
- [ ] Implement smallest typed schema/config/money/date modules; include only server config checks.
- [ ] Re-run focused suite; confirm green before proceeding.

### Task 2: Fresh Workbook Builder and Sheets Repository

**Files:** Create `src/lib/sheets/{auth,bootstrap,repository,formulas,audit}.ts`; tests with Google API fake.

- [ ] Write failing tests proving builder calls spreadsheet create, never Drive search/list, creates six ordered tabs, writes headers/settings/validations/formulas/styles, and verifies read/write test row.
- [ ] Run `npm test -- --run src/lib/sheets`; observe expected failure.
- [ ] Implement create-once builder, fixed column mappers, Sheets CRUD, append-only audit, Dashboard/Review Queue formulas, row validation and manual-confirm detection.
- [ ] Re-run tests; then create actual new workbook with connected Google Sheets integration and record URL/ID securely.

### Task 3: Payment Generation and PromptPay QR

**Files:** Create `src/lib/payments/{create,token,status}.ts`, `src/lib/promptpay/generate.ts`, `src/app/api/admin/generate/route.ts`, `src/app/api/cron/generate/route.ts`; tests.

- [ ] Write failing tests for 256-bit token length, client-period idempotency, Bangkok monthly due date, line message, PromptPay identifier/amount encoding, and CRC test vectors.
- [ ] Run focused test command; confirm red state.
- [ ] Implement cryptographic token/payment creation, deterministic idempotency, EMV PromptPay builder, QR renderer, protected admin/cron routes.
- [ ] Re-run focused tests; verify one payment row and one payment URL per client/period.

### Task 4: Local Image, QR, OCR, and Evaluation Pipeline

**Files:** Create `src/lib/slip/{validate,hash,qr,ocr,normalize}.ts`, `src/lib/payments/evaluate.ts`, `src/lib/storage/slip.ts`; pure and adapter tests.

- [ ] Write failing tests for JPEG/PNG/WebP signature/size/dimension rejection, SHA duplication same-vs-other payment, malformed/CRC-invalid/multiple QR candidates, Thai/English amount/receiver/date normalization, Buddhist dates, and decision gates.
- [ ] Run test suite; ensure failure caused by absent behavior.
- [ ] Implement safe decode/preprocess/hash, QR candidate parser, QR hash/ref/bank extraction, local Thai+English OCR, fuzzy receiver aliases, and explicit evaluator output.
- [ ] Re-run tests; `AUTO_RECORDED` requires all gates; incomplete stays `REVIEW`; contradiction/duplicate is `FLAGGED`.

### Task 5: Public Mobile Payment Page and Submission Endpoint

**Files:** Create `src/app/p/[token]/page.tsx`, `src/app/api/payment/[token]/route.ts`, `src/app/api/payment/[token]/submit/route.ts`, public components/styles; API/component/Playwright tests.

- [ ] Write failing tests for opaque-token record isolation, already-recorded screen, accessible QR/download/upload/preview/progress controls, response language, invalid files/rate limits, idempotent same submission, status/audit row persistence.
- [ ] Run tests to establish red state.
- [ ] Implement server-side lookup, responsive payment page, QR download, server image pipeline, private exception storage, decision persistence/audit, non-bank-verification copy.
- [ ] Re-run tests and Playwright viewport test; all public route behavior covered.

### Task 6: Deploy Configuration, Documentation, and Production Validation

**Files:** Create `vercel.json`, `scripts/bootstrap-production.ts`, `scripts/smoke-production.ts`; update README/.env example.

- [ ] Write failing smoke assertions for health config state, private spreadsheet headers/tabs/settings, client/payment creation, public page, controlled submission, payment/audit/dashboard/review result.
- [ ] Run smoke locally with fake adapter; confirm red state first.
- [ ] Implement cron env guard, Vercel configuration, deployment scripts, operator setup/deployment/retention docs.
- [ ] Run `npm run lint && npm test && npm run build`; inspect full output.
- [ ] Create GitHub repository/commit/push, deploy Vercel, set all non-personal configuration, run production smoke test, inspect Vercel build/runtime logs, fix failures.

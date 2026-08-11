# Repository Guidelines

## Project Structure & Module Organization

The Next.js application lives in `src/`. Pages and API handlers are in `src/app/`; UI is in `src/components/`, with admin UI under `src/components/admin/`. Put business logic in `src/lib/`, grouped by domains such as `payments/`, `sheets/`, `slip/`, and `security/`. Keep tests beside their subject files, for example `src/lib/payments/generate.test.ts`.

`apps-script/Code.gs` is Google Apps Script for the coach workbook; its tests live in `src/apps-script/`. Design notes and plans belong in `docs/superpowers/`.

## Build, Test, and Development Commands

- `npm run dev` — start local server using `.next-dev`.
- `npm run lint` — run Next.js and TypeScript ESLint rules.
- `npm test` — run all Vitest tests once.
- `npm run test:watch` — keep Vitest running while developing.
- `npm run build` — create production build and catch build/type failures.
- `npm run smoke` — check deployed health after secure configuration.

Run `npm run lint && npm test && npm run build` before opening a pull request. Use `npm start` only after a successful production build.

## Coding Style & Naming Conventions

Write strict TypeScript and use the `@/` alias for `src/` imports. Follow surrounding two-space indentation and semicolons. Name React components in PascalCase (`ClientForm`), functions and variables in camelCase (`generateDuePaymentLinks`), and files in lowercase kebab case (`payment-link-actions.tsx`). Keep domain logic independent of routes and components. No formatter is configured; follow nearby code and ESLint.

## Testing Guidelines

Vitest discovers `src/**/*.test.ts`. Use `describe`/`it`/`expect` with behavioral names, such as `it("marks a generated schedule row")`. Mock Google Sheets, storage, and OCR boundaries with `vi.mock`; unit tests must not call live services. DOM tests begin with `/** @vitest-environment jsdom */`. Add or update tests for every behavior change.

## Commit & Pull Request Guidelines

History uses concise Conventional Commit prefixes: `feat: add payment link actions`, `fix: simplify new client page chrome`, and `docs: specify ...`. Use lowercase imperative summaries and one logical change per commit.

PRs state user-visible change, testing, and environment/configuration impact. Link relevant issues and include screenshots for admin or payment-page UI changes.

## Security & Configuration

Never commit `.env*`, PromptPay identifiers, service-account JSON, admin/cron secrets, or private slip data. Google Sheets is the admin system of record; keep slip review data private. Use a dedicated payment token for production smoke checks.

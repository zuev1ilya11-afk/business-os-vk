# Contact journal and finance expenses

> Execute inline with superpowers:executing-plans. The attached specification explicitly authorizes implementation, migration, publication, PR, merge and production verification.

**Goal:** Finish the existing contact journal and add company expenses to the existing finance workspace.
**Spec:** User attachment `Вставленный текст(5).txt` (2026-10-04).
**Architecture:** Extend authenticated mini-app-api with expense CRUD using the existing owner/manager finance capability. Separate finance_expenses table with denied public access; frontend pure expense projection and compact editor inside finance-page.js. Existing background refresh event loads expenses without replacing the page.
**Stack:** Classic JavaScript, Deno/Supabase, node:test, Playwright, GitHub Pages.

## Global constraints
- Preserve auth, RBAC, roles, payroll, Hands, 60/40, reports and workflow stage order.
- PR #263 is already merged at cd81edf; continue current main in one new PR.
- Expense author is server-derived. Masters and dispatchers currently lack finance access.
- Unknown company income remains unknown, including net profit.
- All 13 specified categories; Other requires a description. Amount positive, at most two decimal places, maximum 999999999.99; date is a strict calendar date; comment max 500.
- Optional city/order/employee links support existing filters. Unallocated expenses are not invented allocations to a particular master/source/work/city; explain filtered totals in UI.

## Review focus
- Retry after a lost response must not duplicate an expense; edits/deletes must detect stale versions.
- Period and account changes while requests are in flight must never show stale private data.
- Expenses without orders still contribute to period summaries; missing company income cannot become zero.
- Two phone numbers and delayed results must retain their original attempt number and latest contact summary.
- Background refresh must retain form drafts, focus, scroll, filters and original payroll.

## Task 1: Contact regression and completion
- [ ] Run existing baseline server/contact/browser tests.
- [ ] Add server regression for all agreement-blocking results, callback time, max 50, ownership and exact immutable attempt number; fix only demonstrated gaps.
- [ ] Run contact tests; commit.

## Task 2: Expense entity and API
**Files:** finance-expenses.js; mini-app-api/index.ts; migration finance_expenses; tests/finance-expenses.test.cjs; tests/helpers/edge.cjs.
**Interfaces:** listExpenses({start,end}) -> expenses/categories; createExpense({id,...fields}); updateExpense/deleteExpense({id,updated_at,...fields}). Shared BOS_FINANCE_EXPENSES exposes categories, validate, select, summary, periodGroups.
- [ ] Write failing tests for CRUD, roles, validation, server authorship, date filtering, retries, conflicts and unchanged orders.
- [ ] Implement migration and API; verify node tests pass; commit.

## Task 3: Finance UI
**Files:** finance-page.js, finance styles, lazy asset configuration, tests/finance-expenses.spec.js.
- [ ] Add failing browser tests for CRUD, period/category totals, net profit, comparison, drafts/scroll, denied roles, errors and mobile 320/360/390/430.
- [ ] Implement expense tab/editor and summary KPIs using shared projection; reuse API transport and background refresh events.
- [ ] Build with npm run build; run targeted browser tests; commit.

## Task 4: Verify and publish
- [ ] npm run build:check, Deno checks, npm run test:server, complete Playwright; no pageerror.
- [ ] Fresh whole-branch review and fix any important findings with regression tests.
- [ ] Compare production function sources/schema; apply only required migration; Security Advisor before/after; deploy affected functions.
- [ ] Push PR; green CI; merge exact checked HEAD; Pages deployment and production build/UI/API smoke.
- [ ] Report precise versions, SHAs, checks, limitations, and unchanged contracts.

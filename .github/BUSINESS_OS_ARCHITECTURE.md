# Business OS — Architecture Map

## Purpose

This document is the working architecture map for AI Workstation / Developer Agent. It describes the current production structure before consolidation so changes can be made without breaking live behavior.

## Current production entry point

`index.html` is the production bootstrap. It loads the application as a long ordered chain of scripts. The order is significant because many later files wrap or override functions defined by earlier files.

### Bootstrap and base layer
- `vk-init.js` — VK Bridge bootstrap.
- `config.js` — runtime configuration.
- `app-public.js` — base application state, navigation and core pages.

### Authentication / session layer
- `vk-auth-patch.js`
- `auth-ui-patch.js`
- `auth-api-session-v41.js`
- `mandatory-auth-v29.js`
- `launch-fix.js`
- `production-role-patch.js`
- `owner-role-patch.js`
- `team-roles-fix-v31.js`

This is a critical dependency chain. Recent production fixes show that changing load order or replacing `window.api` can break the authenticated API or role-specific dashboards.

### Orders and dispatcher layer
- `dispatcher-workspace-v6.js`
- `dispatcher-orders-calendar-v7.js`
- `dispatcher-header-v8.js`
- `dispatcher-close-v19.js`
- `dispatcher-report-patch.js`
- `dispatcher-preview-patch.js`
- `order-create-fields-patch.js`
- `order-filters-v22.js`
- `status-visual-patch.js`
- `claims-patch.js`
- `claims-runtime-patch.js`
- `reclamation-status-v18.js`

### Master workspace layer
- `master-calendar-patch.js`
- `master-report-patch.js`
- `master-profile-v4.js`
- `master-profile-clean-v11.js`
- `master-report-ui-v12.js`
- `master-nav-fix-v14.js`
- `master-profile-edit-v15.js`
- `master-schedule-presets-v17.js`
- `master-memo-v20.js`
- `master-memo-runtime-v21.js`
- `master-order-flags-patch.js`
- `master-simple-patch.js`
- `master-ui-contract-v42.js` (present in repository; verify whether it is intentionally loaded separately before changing the contract)

### Owner / manager layer
- `owner-dashboard-v9.js`
- `owner-calendar-team-v10.js`
- `owner-tools-v13.js`
- `owner-dispatcher-dashboard-patch.js`
- `manager-preview-v28.js`
- `role-preview-patch.js`

### Team / employees
- `employee-profile-patch.js`
- `employee-form-v16.js`
- `staff-link-patch.js` (present; verify active load path before editing)
- `team-calendar-patch.js`
- `team-roles-fix-v31.js`

### Finance and reports
- `finance-patch.js`
- `extra-work-patch.js`
- `report-supabase-patch.js`
- `report-review-patch.js`
- `report-review-runtime-v30.js`
- `report-chunk-upload-v23.js`
- `report-upload-fix-v27.js`

### Integrations
- `api-integrations-v26.js`
- `avito-messages-v25.js`
- `google-apps-script/`
- `supabase/`

### Presentation / UI
- `styles.css`
- `ui-v2.css`
- `report-review.css`
- `master-simple.css`
- `form-mobile-fix.css`
- `visual-polish.js`
- `ui-v2-patch.js`
- `business-os-custom-v3.js`
- `astra-schedule-ui-v5.js`

## Main architectural risk

The application currently uses a patch-stack architecture. Multiple scripts replace or wrap shared globals such as `pages.home`, `window.api`, navigation handlers and role-dependent rendering.

This makes the application functional but creates four risks:

1. **Load-order coupling** — moving one script can silently change behavior.
2. **Wrapper accumulation** — the same page/function can be wrapped several times.
3. **Hidden contracts** — later scripts depend on globals introduced by earlier files without explicit imports.
4. **Regression amplification** — a small auth or dashboard change can affect multiple roles.

A recent production fix explicitly had to preserve the authenticated API while restoring the master dashboard because older feature patches wrap `pages.home`. This confirms the patch stack is now the primary technical-debt hotspot.

## Protected production contracts

Developer Agent must preserve these until covered by tests and deliberately migrated:

- authenticated API session propagation;
- mandatory auth gate behavior;
- owner / manager / dispatcher / master role separation;
- `pages.home` role-specific output;
- order creation and assignment;
- dispatcher schedule/calendar;
- master own-order visibility;
- master payout / salary summary;
- reports and extra-work amounts;
- mobile launch/auth recovery;
- VK Mini App launch compatibility.

## Existing verification layer

The repository already contains Playwright tests including:

- `tests/smoke.spec.js`
- `tests/master-mobile.spec.js`
- `tests/mobile-auth-fallback.spec.js`
- `tests/mobile-auth-launch-recovery.spec.js`
- `tests/phone-registration.spec.js`
- Google Apps Script health checks.

Before consolidating a production module, Developer Agent should expand tests around the affected role and then change code.

## Consolidation strategy

Do not rewrite the application from scratch. Consolidate incrementally.

### Phase A — Freeze behavior
1. Treat current `main` as production reference.
2. Add tests for critical role-specific scenarios not already covered.
3. Record shared globals and wrappers for each domain.

### Phase B — Consolidate by domain
Target domains in this order:

1. Authentication/session bootstrap.
2. Role resolution and previews.
3. Master dashboard/profile/calendar.
4. Dispatcher workspace/calendar/orders.
5. Owner dashboard/team tools.
6. Finance/reports.
7. Integrations.

For each domain:
- create one canonical module;
- migrate behavior from patch files into it;
- keep compatibility shims only where necessary;
- run tests;
- remove obsolete scripts from `index.html` only after parity is confirmed.

### Phase C — Explicit application contracts
Replace implicit global coupling with explicit namespaces such as:

- `BOS.auth`
- `BOS.api`
- `BOS.roles`
- `BOS.orders`
- `BOS.dispatch`
- `BOS.master`
- `BOS.finance`
- `BOS.reports`
- `BOS.integrations`

This can be done in plain JavaScript first; a framework migration is not required to improve maintainability.

## First recommended consolidation target

**Authentication/session bootstrap** should be first.

Reason: it is loaded early, affects every role and API call, and recent commits show regressions around auth gate, role bootstrap and authenticated API session. Stabilizing this layer reduces risk for all later consolidation.

Initial target module proposal:

`core/auth-session.js`

Responsibilities:
- session storage/read;
- authenticated API wrapper;
- auth gate lifecycle;
- role bootstrap readiness;
- compatibility signals currently exposed on `window`;
- no dashboard rendering or salary logic.

Important: the master dashboard compatibility logic currently living inside `auth-api-session-v41.js` must be moved out of auth during consolidation rather than deleted. It belongs in the master UI domain.

## Developer Agent rule

Do not add a new numbered patch unless a production emergency requires it. For normal development, prefer canonical domain modules and migrate existing behavior into them incrementally.

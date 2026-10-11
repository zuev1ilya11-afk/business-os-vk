# Task 4 contract coverage

Each row is a role/screen contract, not a PNG count. Finance fields retain the existing financial model. Synthetic captures use only local fixtures.

| Role | Screen | Status | Renderer | Capture widths |
|---|---|---|---|---|
| dispatcher | review | implemented | report-review-patch.js; report-review-runtime-v30.js | 390, 1440 |
| dispatcher | review-reject | implemented | report-review-patch.js; report-review-runtime-v30.js | 390, 1440 |
| manager | dashboard | implemented | owner-dashboard-v9.js; order-control.js | 360, 390, 430, 768, 1440 |
| manager | orders | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | reports | implemented | owner-dashboard-v9.js; original report review queue | 390, 1440 |
| manager | team | implemented | team-roles-fix-v31.js; employee-profile-patch.js; staff-permissions-calendar-v43.js | 360, 390, 430, 768, 1440 |
| manager | team-member | implemented | team-roles-fix-v31.js; employee-profile-patch.js; staff-permissions-calendar-v43.js | 390, 1440 |
| manager | finance-overview | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| manager | finance-expenses | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| manager | finance-masters | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| manager | finance-orders | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| manager | finance-sources | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| manager | finance-works | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| manager | finance-periods | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| manager | finance-period | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| manager | finance-filters | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| manager | expense-new | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| manager | expense-edit | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| manager | finance-master | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| manager | more | implemented | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | profile | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 360, 390, 430, 768, 1440 |
| owner | dashboard | implemented | owner-dashboard-v9.js; order-control.js | 360, 390, 430, 768, 1440 |
| owner | orders-new | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | orders-active | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | orders-reports | reused-and-role-verified | owner-dashboard-v9.js; original report review queue | 390, 1440 |
| owner | orders-archive | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | team | implemented | team-roles-fix-v31.js; employee-profile-patch.js; staff-permissions-calendar-v43.js | 360, 390, 430, 768, 1440 |
| owner | invite | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| owner | admin | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| owner | memo-edit | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| owner | finance-overview | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| owner | profile | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 360, 390, 430, 768, 1440 |
| owner | settings-proposal | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | loading | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | empty | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | error | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | offline | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | file-viewer | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| dispatcher | control | implemented | order-control.js; unchanged order-control-tasks.js | 390, 1440 |
| dispatcher | control-task | implemented | order-control.js; unchanged order-control-tasks.js | 390, 1440 |
| manager | staff-access | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| manager | memo-edit | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| manager | manual-complete | implemented | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | order-delete | implemented | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | employee-edit | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| owner | staff-invite | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| owner | api-integrations | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | api-create | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | api-mapping | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | hands-settings | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | auth-login | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | auth-invite | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | auth-expired | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | finance-overview-unknown | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| owner | role-preview | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | expense-delete | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| manager | workspace | reused-and-role-verified | owner-dashboard-v9.js; order-control.js | 390, 1440 |
| manager | attention | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | order-detail | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | order-create | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | order-edit | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | assign | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | reschedule | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | schedule | reused-and-role-verified | unchanged unified-schedule-v102.js / dispatcher-mobile-dispatch-v107.js; Stage 3 composition | 360, 390, 430, 768, 1440 |
| manager | schedule-month | reused-and-role-verified | unchanged unified-schedule-v102.js / dispatcher-mobile-dispatch-v107.js; Stage 3 composition | 390, 1440 |
| manager | day-detail | reused-and-role-verified | unchanged unified-schedule-v102.js / dispatcher-mobile-dispatch-v107.js; Stage 3 composition | 390, 1440 |
| manager | control | implemented | order-control.js; unchanged order-control-tasks.js | 360, 390, 430, 768, 1440 |
| manager | control-task | implemented | order-control.js; unchanged order-control-tasks.js | 390, 1440 |
| manager | free-slots | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | slot-assign | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | order-cancel | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | claims | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | claim-detail | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | claim-create | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | review | implemented | report-review-patch.js; report-review-runtime-v30.js | 360, 390, 430, 768, 1440 |
| manager | review-reject | implemented | report-review-patch.js; report-review-runtime-v30.js | 390, 1440 |
| manager | avito | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | avito-thread | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | avito-lead | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | avito-settings | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | hands-sync | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | hands-order | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | hands-settings | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | notifications | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | filters | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| manager | file-viewer | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | photo-error | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | push | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | login-settings | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | personal | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | help | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | about | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | auth-login | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | auth-invite | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| manager | auth-expired | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | workspace | reused-and-role-verified | owner-dashboard-v9.js; order-control.js | 390, 1440 |
| owner | attention | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | order-detail | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | order-create | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | order-edit | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | assign | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | reschedule | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | schedule | reused-and-role-verified | unchanged unified-schedule-v102.js / dispatcher-mobile-dispatch-v107.js; Stage 3 composition | 360, 390, 430, 768, 1440 |
| owner | schedule-month | reused-and-role-verified | unchanged unified-schedule-v102.js / dispatcher-mobile-dispatch-v107.js; Stage 3 composition | 390, 1440 |
| owner | day-detail | reused-and-role-verified | unchanged unified-schedule-v102.js / dispatcher-mobile-dispatch-v107.js; Stage 3 composition | 390, 1440 |
| owner | control | implemented | order-control.js; unchanged order-control-tasks.js | 360, 390, 430, 768, 1440 |
| owner | control-task | implemented | order-control.js; unchanged order-control-tasks.js | 390, 1440 |
| owner | free-slots | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | slot-assign | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | order-cancel | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | order-delete | implemented | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | manual-complete | implemented | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | claims | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | claim-detail | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | claim-create | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | reports | implemented | owner-dashboard-v9.js; original report review queue | 390, 1440 |
| owner | review | implemented | report-review-patch.js; report-review-runtime-v30.js | 360, 390, 430, 768, 1440 |
| owner | review-reject | implemented | report-review-patch.js; report-review-runtime-v30.js | 390, 1440 |
| owner | avito | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | avito-thread | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | avito-lead | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | avito-settings | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | hands-sync | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | hands-order | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | notifications | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | filters | reused-and-role-verified | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | photo-error | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | push | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | login-settings | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | personal | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | help | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | about | deferred-to-task-5 | existing renderer retained; Task 5 integration/shared-state work | Task 5 |
| owner | more | implemented | unchanged Stage 3 shared operational renderer; approved-operations-ui.css | 390, 1440 |
| owner | staff-access | implemented | existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css | 390, 1440 |
| owner | team-member | implemented | team-roles-fix-v31.js; employee-profile-patch.js; staff-permissions-calendar-v43.js | 390, 1440 |
| owner | finance-expenses | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| owner | finance-masters | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| owner | finance-orders | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| owner | finance-sources | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| owner | finance-works | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| owner | finance-periods | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 360, 390, 430, 768, 1440 |
| owner | finance-period | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| owner | finance-filters | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| owner | expense-new | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| owner | expense-edit | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| owner | expense-delete | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| owner | finance-master | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |
| owner | finance-overview-unknown | implemented | finance-page.js; unchanged finance-data.js / finance-expenses.js | 390, 1440 |

# Dispatcher stage 3 coverage

19 owned operational surfaces are composed or retain existing safe controls. All 45 dispatcher contract rows are mapped below. Later-stage rows are not claimed implemented by shared styling.

Screenshots are synthetic local fixtures at 360, 390, 430, 768 and 1440 px. Capture manifest records the real runtime build per image. The final targeted recaptures supersede old rows for changed Orders, Filters and Schedule; untouched surfaces retain their actual earlier build provenance. No live-data or real-iPhone claim.

| Screen | Status | Active presentation | Evidence / limits |
|---|---|---|---|
| workspace | implemented | dispatcher-workspace-v6.js | Queue / schedule / detail desktop; queue / schedule tablet; attention summary and original routes. [390 fixture](dispatcher/workspace-fixture-390.png) |
| attention | implemented | dispatcher-attention-v123.js | Operational priority filters and exact existing destination predicates. [390 fixture](dispatcher/attention-fixture-390.png) |
| orders | implemented | order-filters-v22.js | Saved visit time, address, works, contact, one Open; original action host kept under persistent disclosure. [390 fixture](dispatcher/orders-fixture-390.png) |
| order-detail | implemented | management-order-compact-v82.js | Order title precedes Client heading for Hands; Client / Works / Visit labels preserve all saved fields and original save. [390 fixture](dispatcher/order-detail-fixture-390.png) |
| order-create | implemented | new-order-card-v104.js | Four labeled sections, original input nodes, multiwork / multiphone and reachable original submit. [390 fixture](dispatcher/order-create-fixture-390.png) |
| order-edit | implemented | new-order-card-v104.js | Same sectioned edit with original values, original save and error / retry behavior. [390 fixture](dispatcher/order-edit-fixture-390.png) |
| assign | implemented | dispatcher-smart-assign-v119.js | Context and master search; original ranked candidates, conflicts, assignment handler and payload. [390 fixture](dispatcher/assign-fixture-390.png) |
| reschedule | implemented | dispatcher-reschedule-v91.js | Labeled visit context and existing date / time controls; original update. [390 fixture](dispatcher/reschedule-fixture-390.png) |
| schedule | implemented | dispatcher-mobile-dispatch-v107.js | Mobile selected-master timeline; desktop / tablet time grid. Completed read-only; untimed separate. Unknown duration is a labeled start point. [390 fixture](dispatcher/schedule-fixture-390.png) |
| team | implemented | staff-permissions-calendar-v43.js | Master identity / saved schedule / saved upcoming visits; original card actions and guards. [390 fixture](dispatcher/team-fixture-390.png) |
| master-detail | implemented | staff-permissions-calendar-v43.js | Readonly nearest future saved visits sorted chronologically; original profile / permissions controls. [390 fixture](dispatcher/master-detail-fixture-390.png) |
| reports | deferred-manager | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| review | deferred-manager | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| review-reject | deferred-manager | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| avito | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| avito-thread | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| hands-sync | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| more | foundation-existing | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| profile | implemented | dispatcher-workspace-v6.js | Readonly identity and real existing salary summary composed after late profile wrappers; original profile actions retained. [390 fixture](dispatcher/profile-fixture-390.png) |
| notifications | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| filters | implemented | order-filters-v22.js | Modal clones only filter controls; Cancel preserves values; Apply invokes original onchange on original IDs; reopened selection persists. [390 fixture](dispatcher/filters-fixture-390.png) |
| control | deferred-manager | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| control-task | deferred-manager | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| free-slots | implemented | dispatcher-free-slots-v120.js | Separate opsFreeSlots page; saved day / master history and existing load / conflict information. No invented exact capacity. [390 fixture](dispatcher/free-slots-fixture-390.png) |
| order-cancel | implemented-existing-safe-controls | dispatcher-order-workflow-v114.js (existing) | Existing warning, order context and original confirmation retained; new reason persistence unsupported. [390 fixture](dispatcher/order-cancel-fixture-390.png) |
| claims | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| claim-create | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| schedule-month | implemented | unified-schedule-v102.js | Separate opsScheduleMonth page, real Schedule navigation / history, existing team calendar, shared desktop containment. [390 fixture](dispatcher/schedule-month-fixture-390.png) |
| day-detail | implemented-existing-safe-controls | unified-schedule-v102.js (existing) | Existing master-day list / details and saved schedule data, bounded shared presentation. [390 fixture](dispatcher/day-detail-fixture-390.png) |
| avito-lead | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| avito-settings | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| hands-order | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| master-report | implemented | dispatcher-report-patch.js | Existing report under operational heading; same payroll calculation and data semantics. [390 fixture](dispatcher/master-report-fixture-390.png) |
| slot-assign | implemented-existing-safe-controls | dispatcher-free-slots-v120.js (existing) | Existing eligible order list and assignment controls retained; same assignment payload / confirm flow. [390 fixture](dispatcher/slot-assign-fixture-390.png) |
| claim-detail | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| personal | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| help | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| about | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| push | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| login-settings | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| file-viewer | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| photo-error | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| auth-login | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| auth-invite | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |
| auth-expired | deferred-owner | Later stage | Deferred composition; no implementation claim based on global CSS.  |

## Visual review

Compared captured desktop workspace and tablet two-column workspace with canonical workspace images; compared mobile Orders with canonical orders-390, and inspected all owned mobile surfaces in contact sheets. Final Orders heading leads, time is 20px and nowrap, Open is blue, queue follows rows, and the operational shortcuts remain. Profile composition now renders after the late manager-preview wrapper. Details/forms preserve existing modals and operational controls, so these are not pixel-identical copies of static proposed pages.

## Dependencies and retained behavior

Cancellation uses the existing warning / confirm and does not persist a new reason. Slot assignment retains the existing immediate confirmation flow rather than introducing a new draft confirmation API. Free-slot availability uses existing saved schedule / conflict information and is not an exact capacity guarantee. Existing real salary and report calculations remain; no fake payment history or recalculation. Report/control and integrations remain for manager/owner stages.

## Verification

88 unique UI scenarios have passing latest observed outcomes across scoped completed runs and narrow failure reruns; see targeted-test-evidence.json. This is not a full suite or a single final-build run. Protected comparisons: 106, zero changed. Node scoped checks: initial 32/33, then the changed heading assertion rerun 3/3; no remaining scoped failure. See controller restoration report for exact commands and logs.

Controller visual review caught tall syllable-wrapped schedule cards. The grid now uses bounded 108px cards with fully readable start time, ellipsis for compact secondary labels, full accessible label / tooltip and the existing open action for all context. Unknown duration uses a transparent start-point marker and legend rather than a painted occupied range. Tested red (height failed) then green (height, full start-time width and full detail opening); saved spans and mobile timeline remained green. Canonical schedule-1440 compared visually.

Task3 review round1 I1: hour header and visit body now use the same half-hour grid, gap and padding; each hour label occupies its matching pair of columns. Geometry tests verify first / middle / last hours and a 15:30 start at 768 and 1440px (red 2/2 failures before fix, green 6/6 covering schedule tests after fix). Schedule images at 768/1440 were recaptured on actual build b6d695216206634a3a16; earlier-width captures retain historical build provenance. Minor density/output-noise findings deferred.

# Stage 1 — shared foundation and navigation

Build `619c5c3b88403d85fab1`. Stage 1 implements the approved shared tokens, controls, shell, mobile More composition and permitted desktop/tablet destinations. Existing business-screen compositions in these shell captures remain the responsibility of subsequent stages; these screenshots do not claim completion of master, dispatcher, management or financial screens.

## Approved comparison

The implementation was inspected against the original approved `proposed/system/design-system-{390,1440}.png`, `proposed/system/navigation-{390,1440}.png`, `proposed/dispatcher/more-390.png` and the desktop shell in `proposed/owner/dashboard-1440.png`, in the canonical artifact referenced by ../README.md. It was also checked against `specimen.css`/`specimen.js`, rather than treating new screenshots as the design reference.

| Surface | Renderer / styles | Captured evidence | Comparison and scope |
| --- | --- | --- | --- |
| Master shell | `syncRoleChrome` / `approved-ui.css` | [390](master-390-shell.png), [1440](master-1440-shell.png) | Four destinations; existing `team` route remains the master profile. No More, team administration, Avito or finance exposure. Existing master-home content is unchanged. |
| Dispatcher shell | Same | [390](dispatcher-390-shell.png), [1440](dispatcher-1440-shell.png) | Mobile Home / Orders / Schedule / More; sidebar Team, Avito, Profile. Existing operational dashboard remains unchanged. |
| Manager shell | Same | [390](manager-390-shell.png), [1440](manager-1440-shell.png) | Same primary navigation; existing capability permits finance. No owner tools. Existing dashboard remains unchanged. |
| Owner shell | Same | [390](owner-390-shell.png), [1440](owner-1440-shell.png) | Permitted sidebar destinations plus separate owner tools. Existing dashboard remains unchanged. |
| Mobile More | `pages.more` / `.bosMore` | [dispatcher](dispatcher-390-more.png), [manager](manager-390-more.png), [owner](owner-390-more.png) | Actual sectioned menu with symbols, primary labels, context and separators, matching the approved composition. Owner administration is separate from personal profile. Every menu control invokes its original existing action. |
| Tablet / intermediate sidebar | Existing shell / responsive shared rules | [dispatcher 900](dispatcher-900-shell.png), [manager 900](manager-900-shell.png), [owner 900](owner-900-shell.png), browser geometry assertions | Exact approved boundaries: mobile through 600px; 76px icon sidebar through 850px; 190px sidebar through 1190px; 222px beyond. 768px is checked with all permitted destinations accessible. |

The palette matches the approved contract: `#0e141c`, `#151d28`, `#1b2634`, `#2a3543`, `#edf2f8`, `#a3b1c3`, `#91bfff`, `#a8ceff`, `#10223b`, `#88d1b1`, `#efc282`, `#f4a5ac`. Shared controls retain 44px minimum main touch targets; mobile text inputs use 16px. Main radius is 16px; button/input radii are 10px/9px. Mobile More heading, spacing, row hierarchy and 74px bottom navigation were visually compared with the approved dispatcher More PNG. Sidebar width, ordering, brand, identity and selection were compared with the approved desktop shell.

Runtime install, refresh, notification, profile and owner tools controls remain available in the header; the proposal-only badge and synthetic counts from the design artifact were not added. Existing navigation icons are retained, with meaningful explicit accessible labels. The live role preview return remains available, including on narrow screens.

Visual follow-ups: the legacy master-home `Ожидание` tab wraps its last letter at 390px; Task 2 owns that tab composition. Some existing emoji glyphs, including the notification header icon, appear as missing-glyph boxes in the Linux browser fixture; shared/profile polish should replace or validate their presentation without treating this fixture as evidence of a production device font defect.

## Verification

`tests/approved-ui-foundation.spec.js` uses actual bundled startup and existing role modules with an isolated in-memory API fixture; unmatched external requests are aborted. Fifteen foundation cases cover four roles at 390/1440, palette, 44px navigation targets, overflow, sidebar identity/brand, meaningful accessible labels, denied finance capability, master preview/exit, real More actions, granted-capability delegation, 360/390/430 equal mobile quarters, exact 600/850/1190 breakpoint geometry and mobile form styling/value retention.

TDD: the initial ten foundation cases failed on original shell/absent More. Subsequent sidebar, accessible-name, narrow header and tablet checks were observed failing for their missing behavior before the corresponding implementation.

- Targeted browser suites: **49/49 passed**, covering foundation, Avito navigation and keyboard/back flow, role sweep, responsive geometry, owner preview/profile return, finance transitions/filters/revocation, desktop auth, PWA and renewal/logout.
- Existing form/profile and owner dashboard suites: **22/22 passed**. Intentional mobile Team navigation was updated to use More; original employee/order/profile assertions remain.
- Separate final screenshot capture: **12/12 foundation cases passed**; all eleven screenshots above were inspected.
- Node/server suite: **714/714 passed** after the stage changes.
- `npm run build`, `npm run build:check`, `git diff --check`: passed.

## Navigation cascade review fix

The initial stage captures exposed five mobile grid tracks for dispatcher and six for owner/manager: legacy Avito/finance `:has` selectors matched their hidden entries and overrode the new shell. Scoped overrides now retain exactly four equal quarters across the available navigation width, with 7px side padding. The original Avito entry uses the same row direction, 14px label, 13px gap, padding and height as adjacent entries at 851/900/1023px. At 601/850px, the 76px sidebar keeps icon-only controls. Original Profile navigation remains visible and opens its original modal throughout the sidebar range. Avito selected-state color/background remain consistent with its neighboring entries.

TDD review checks failed before their fixes: six role cases reproduced 5/6 grid tracks or column-oriented Avito, three Profile cases reproduced the hidden original control, and one selection-style assertion caught an overly broad override during iteration. Final focused run: **29/29 passed**, retries0 (`approved-ui-foundation.spec.js`15, `avito-navigation.spec.js`11, `dark-business-os-responsive.spec.js`3). Build/build-check and diff checks passed. The eleven existing role shell/More PNGs were refreshed and three 900px sidebar captures added. Mobile More was compared with the original approved dispatcher More PNG; the sidebar was compared with approved navigation/desktop references. The prior server and broader targeted results above are historical Task 1 evidence; those suites were not rerun for this CSS-only review fix.

## Preserved interfaces and dependencies

Existing `data-page="home|orders|dispatch|team|finance"`, `#bosAvitoNav`, `#profileBtn` and `#ownerToolsBtn` controls/handlers remain authoritative. More calls those controls rather than duplicating business actions. Original button order remains compatible with the classic role scripts; new More/profile/tool entries are links, and desktop order is presentation-only. Navigation synchronization handles later role scripts and content refreshes without modifying form content. Future stages consume `--bos-ui-*` and the `bos-approved-ui` scope.

Finance visibility uses the existing `BOS_PERMISSIONS.isFinanceWorkspaceActive(state.user,state.settings.permissions)` decision plus the presence of the original permitted nav control. No owner shortcut or additional hardcoded dispatcher exclusion is introduced. Normal dispatcher/master fixtures deny finance; owner/manager actual finance rendering and revocation pass. Master/dispatcher preview restrictions remain those of the existing helper.

A hypothetical server-granted live dispatcher exposed an existing lazy-load defect: original `finance-page.js` captures an undefined data dependency, and clicking its original finance handler throws `Cannot read properties of undefined (reading 'valid')`. This was independently reproduced on untouched main `a639db4dea71e605446c166ec96ca5af8abacc1a` with the same granted-bootstrap fixture and original nav click. Stage 1 verifies capability visibility and exactly one invocation of that real handler with `state.page === 'finance'`; full finance rendering for this currently unsupported grant remains blocked by that original dependency. No protected finance or loader code was changed.

The root's frozen whole-browser baseline passed **595/597**, with the existing `background-refresh.spec.js:50` missing-card defect and a `calendar-timezone.spec.js:3` hardcoded-port harness failure. Two external GAS health files were excluded and remain unverified. Stage 1 does not claim a green whole-browser suite or verified external-service health; release verification and complete screen coverage remain later stages.

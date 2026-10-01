# Mobile Avito inbox — approved mockup

Baseline: main d1f5a42c295f2dc622041e7a4f70cb9d898d8629, after the smart-assignment layout release.

## Change

At widths below 768px the inbox uses normal page scrolling instead of a short, height-constrained inner list. Search, all loaded conversation cards, the loaded-data notice and pagination are in one flow. The footer has room for the measured bottom navigation, including its safe-area padding. The company header is compact only while Avito is open; all existing quick actions retain at least 44px targets. On the narrowest screens the redundant logo is hidden to keep the company name and actions readable.

Cards expose client, category, message preview, full date/time, unread count and linked order badge. Dates have their own grid cell rather than a clipped 52px column. Counts still come from loaded provider data; no decorative/mock totals are introduced. Provider errors appear above search rather than below a long list.

Opening a chat switches the existing inline pane to a viewport-fitted conversation. Returning restores the selected row's focus and prior page scroll without focusing the search keyboard. In-app message/lead drafts and filters use the existing workspace state. The minimum desktop height does not force a short mobile composer underneath navigation. This is not new offline draft persistence.

## Unchanged boundaries

The existing polling interval, provider transport, cooldown/retry behavior, message sending, image URL validation/viewer, read actions, creation idempotency and server responses remain unchanged. No backend/database/auth/financial calculation changes, no provider reconnect, no new dependencies or extra request loop. Tablet/desktop keep the inline split-pane workspace. Mobile header rules stop applying on other app tabs.

## Verification scope

The new responsive regression checks 320/375/390/430px operations roles, page-scrolling pagination, untruncated timestamps, touch targets, long-list return, search/draft retention, inline lead editing/reload, visible errors, reduced viewport height and 900/1440px split panes. Existing Avito navigation, sending, image, retry and order-creation tests remain release gates. Browser checks use synthetic data, not customer accounts.

Cross-browser QA and final CI/deployment evidence are recorded in the release PR. Tests that resize the viewport approximate a keyboard-reduced area; they are not a physical iPhone keyboard test. The local Chromium environment blocks loopback navigation, so browser rendering is verified in GitHub Actions without bypassing that policy.

# Mobile orders idle render

Local Chromium, dispatcher fixture at 390×844, eight seconds idle: the original page produced 33,345 MutationObserver callbacks across 44 installed observers. Instrumentation traced repeated child-list writes to `updateTomorrowButton`: it replaced identical innerHTML on every observer-driven sync, creating another mutation and sync.

A controlled response override adding only an equality check reduced the same measurement to zero callbacks. This change applies that guard in the source. A browser regression requires the page to settle without content mutations, verifies the Tomorrow count changes from one to two, navigates home/orders repeatedly without duplicate controls, and checks the Tomorrow filter still works. Existing assignment/quick-editor tests also pass.

Callback counts are local instrumentation, not a CPU-speed claim or a physical Android benchmark. Other observers and the patch architecture remain. No timers, action handlers, filters, auth, API routes or financial behavior are changed.

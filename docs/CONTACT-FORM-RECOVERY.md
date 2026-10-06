# Call result and agreement form recovery — 2026-10-06

Scope: master-call-workflow-v26.js, master-order-actions-v179.js and the contact-only branch of network-direct-v86.js, plus generated PWA artifacts. No backend, schema, authorization or payroll changes. No production order is submitted, rescheduled or completed by verification.

## Reproduced failure

The call result radio controls inherited generic form input dimensions and had no selected-row presentation. While a result request was pending, only Submit was disabled. Contact writes and agreement writes did not use the working bootstrap transport learned for stage writes and were bounded by short read deadlines. An already-committed result whose response was lost left the form showing a failure instead of opening the agreement step.

The initial branch-only Actions regression run failed the route/deadline checks and the form-lock/receipt-recovery checks before production code was changed. The browser locator was corrected separately before running the presentation checks.

## Behavior

- The entire radio label remains a native clickable label. A compact 22px radio, selected-row background/border and a textual selection receipt distinguish the active option. Keyboard focus remains visible. Styles are scoped to the contact-result form.
- The existing call result values, optional callback time and required comment for Other are preserved. All form controls are locked while saving; a failed request preserves the draft.
- Contact writes use the authenticated bootstrap's working route with a 20-second write budget. They are explicitly non-replayable after an ambiguous network failure. Existing stage, report, authentication and Avito route behavior is retained.
- After an ambiguous result response, one read-only authorized bootstrap checks the exact attempt ID, normalized phone, result, comment and callback time. Only a matching server receipt is accepted. A missing receipt or failed read leaves the form open for an explicit retry with the same attempt ID.
- Agreement recovery requires a saved agreement timestamp and the exact requested date/time on the authorized current order. No extra write is sent to verify success.
- An account change invalidates the pending UI completion. Closing a form prevents a late response from reopening another modal. Late older call-attempt responses do not overwrite newer contact state.
- The legacy workflow decorator no longer inserts workflow controls into contact/date forms.

## Regression checks

`node --test tests/master-contact-route.test.cjs`

`npx playwright test tests/master-contact-form-recovery.spec.js tests/master-contact-confirmation.spec.js tests/master-order-actions-v179.spec.js tests/master-confirmed-progress.spec.js --workers=2`

The new browser cases execute the real Edge handlers against the disposable in-memory database. They cover 320/390/1280px, all six choices, pending-save locking, preserved drafts, lost contact/date responses, explicit retry and unchanged financial fields. Route tests cover direct/proxy bootstrap choices, slow responses and the absence of ambiguous write replay.

Actions run 37531399735 verified 694 server tests and 37 Chromium tests. The first WebKit run passed all three presentation checks but failed the three submission cases: after service-worker activation, WebKit bypassed the page.route network fixture and reached external proxies. A separate diagnostic run disproved a comment-encoding issue. Blocking Service Workers in the mocked-network test context resolved this test-isolation failure without another production-code change. Actions run 37532684901 then passed all nine WebKit cases (six form/recovery cases and three temporary comment-encoding diagnostics). The permanent recovery test declares this isolation explicitly. Existing PWA/service-worker tests remain unchanged and test the real worker separately. The temporary diagnostic test and workflows are removed from the final tree.

Run the normal complete PR CI before release; do not infer production persistence or physical-device coverage from a browser fixture. Production verification must be read-only: check the published build and deployed contact handler capability, without sending call, agreement, stage or report mutations to a customer's order.

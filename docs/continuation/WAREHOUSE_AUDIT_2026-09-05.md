# Warehouse audit — 2026-09-05

This note records the functional Warehouse audit after the R5.11 performance pass. It is context-only and must not be merged to Production by itself.

## User direction

- Do not restore blanket admin approval gates for routine work. Managers must remain operationally autonomous.
- Warehouse must be controllable over time even when users are imperfect and do not proactively clean exception queues.
- Arrival UI remains frozen.
- Attention is currently not trusted as the primary daily workflow; users appear to fix issues mainly when the question is raised during a natural operation.
- Cyclic stock checking is not yet perceived as a finished control mechanism.
- Warehouse UI is too technical and unintuitive.
- Manager Warehouse navigation is visibly broken: Остатки and Внимание open, while Движение товара, Ревизия and История do not switch. Manager nav is vertical; desired desktop presentation is horizontal like admin.
- Catalog presentation is technical and contains duplicate-like historical variants. Manual +Вариант should be reconsidered/demoted rather than assumed to be the normal way new variants enter the system.
- Catalog review / Требует разбора is confusing and exhibited a lost-response symptom: UI reported an error, reload showed the issue was actually resolved.

## Confirmed manager navigation bug

Current frontend `openInventoryPanel` still rejects non-admin panels other than overview/attention. This stale gate contradicts the intended manager-safe Warehouse model already protected by current tests, which allow manager routine movement, stocktake/revision, history reads and exact stock checks while keeping master-data/catalog expansion and destructive reversal privileged.

P0 fix: remove the stale frontend role gate for manager-safe panels and add a regression that tests the actual navigation callback, not only the tab allow-list. Manager/admin should share one horizontal nav presentation; managers simply omit admin-only Catalog.

## Permission model conclusion

Removing the old blanket admin restrictions did not inherently damage Warehouse correctness. The correct safety boundary is risk/state based, not role based.

Routine manager-safe work should remain available when protected by existing invariants: freshness/CAS checks, idempotency, exact known-SKU identity, reservation/physical-truth checks, lifecycle state and audit history.

Admin-only should remain for genuinely structural/destructive work: creating master-data/reference values, resolving unknown product identity where new catalog facts may be created, catalog expansion/creation, destructive history reversal and similar operations.

Do not use admin permission as a generic substitute for checking whether an operation is physically safe.

## Attention conclusion

Attention is technically a derived recovery inbox, not a persistent task/SLA system. Its categories and order context are useful, but relying on users to visit it voluntarily is a product failure mode.

Do not make Attention the center of daily Warehouse work. Surface the same unresolved question at the natural operation where it matters: order save/shortage, issuing/handover, movement, return/intake and quick stock check. Keep Attention as the fallback recovery inbox for exceptions that were not resolved inline.

The badge should represent unresolved exceptions, not an obligation to clear an abstract queue.

## Cyclic stock control conclusion

The current quick-check backend is materially safer than the UI makes it feel: it uses exact quick stocktake semantics, expected physical quantity/CAS, forces refresh on stale race, removes a confirmed SKU from the current batch and is manager-safe. It deliberately shows only a small rotating batch rather than a giant backlog.

What is missing is a visible control loop. Warehouse overview should expose observable health signals such as recently physically checked coverage, long-unchecked active stock, repeated mismatches/manual corrections, unresolved physical questions and today's completed checks. Avoid a fake single confidence score; show the evidence that determines trust.

Routine selection should increasingly prioritize stale checks, movement since check, prior mismatch/manual correction, return/exchange activity, low/free-stock pressure and active reservation demand. Keep the visible daily batch small.

## Catalog conclusion

The current Catalog screen exposes database dimensions directly (`БЕЗ ЦВЕТА`, `СТАНДАРТ`, empty gender, raw variant rows), so it reads like a schema console rather than product master data.

Do not automatically merge visually similar variants. A no-gender and female variant may be a historical duplicate or a legitimately distinct identity; a safe duplicate decision must inspect canonical attributes, stock in both sources, active reservations, linked order items/orders, movements/history, aliases and lifecycle references.

Human display should suppress dimensions that carry no useful distinction and group variants around meaningful business identity. Add a read-only `possible duplicate` diagnostic before any merge/retirement workflow.

Manual `+ Вариант` should not be deleted until all legitimate creation paths are audited. Preferred direction is to demote it to an admin-only advanced action because everyday operators normally create/encounter variants through natural business flows.

## Требует разбора / Catalog Review conclusion

The queue is not a generic statement that Catalog is broken. It represents order positions where the system cannot confidently attach a canonical product or variant. Current filtering intentionally hides old irrelevant noise, deleted/archived/fully-returned positions and explicit exclusions while keeping recent operationally relevant unresolved positions and allowing an exact old order to resurface its own unresolved item.

Current frontend has a confirmed lost-response class bug: after successful `resolve-facts` mutation it awaits several refreshes inside the same `try`; a follow-up read failure is caught as if the mutation failed. That explains the observed `error -> reload -> issue disappeared` behavior.

P0 fix: once the mutation succeeds, report success. Refresh dependent views best-effort / independently. If a refresh fails, say that the change was saved but the screen could not refresh; never tell the user the business mutation failed.

The UI should explain the specific missing fact in human language: unknown product, unknown variant/characteristic or ambiguous combination, with affected order/customer/date and one primary action `Уточнить товар`.

## Production D1 spike at ~12:30 local

The ~1M rows-read spike around 12:30 (+05) was caused by assistant-created Production profiling, not ordinary Warehouse usage.

Four SELECT-only Actions runs overlapped that window:
- `33952679907` short-search profile: about 191,561 rows_read
- `33952785829` repeated short-search + summary profile: about 308,572 rows_read
- `33952885626` repeated profiles + Attention profile: about 312,452 rows_read
- `33952978232` repeated profiles + split Attention profile: about 315,097 rows_read

Combined: about 1,127,682 rows_read. They wrote no D1 rows, but the read volume was excessive and directly explains the analytics spike.

## New forensic read-budget rule

SELECT-only is necessary but not sufficient. From now on:

- Source/static/local SQLite analysis first.
- Reuse previous Production measurements instead of repeating baselines.
- Default hard budget for a new Production forensic investigation: <=25,000 rows_read total, and preferably far less.
- If one unexpected probe approaches 10k–15k rows_read, stop and reassess rather than testing many variants.
- Never again run a matrix such as multiple search terms × multiple alternative queries against Production merely for optimization.
- Any intentionally larger forensic scan requires explicit user approval first.
- Functional Warehouse redesign should be audited primarily from code, existing logs and bounded representative probes.

No Production D1 query was executed while preparing this Warehouse audit.

## Recommended implementation sequence

### W1 — reliability/access, small and safe
1. Fix manager Warehouse panel navigation.
2. Standardize manager/admin Warehouse nav horizontally on desktop and safely wrap/scroll on narrow screens.
3. Fix Catalog Review committed-success/read-failure isolation.
4. Rewrite `Требует разбора` explanatory copy without changing its business selection logic.

No D1 schema change. Arrival untouched.

### W2 — daily control loop
1. Redesign Warehouse overview around physical-control health plus current quantities.
2. Finish the rotating quick-check loop with visible coverage/freshness/mismatch signals.
3. Surface relevant exception resolution inline at natural operations.
4. Keep Attention as recovery inbox and simplify its language/hierarchy.

### W3 — Catalog/master-data UX
1. Humanize variant display and group meaningful identity.
2. Build read-only possible-duplicate diagnostics.
3. Demote manual variant creation to advanced/admin action unless creation-path audit proves it unnecessary.
4. Only after evidence review, design controlled history-safe merge/retirement for real duplicates.

Do not combine W3 identity cleanup with W1 access/reliability fixes.
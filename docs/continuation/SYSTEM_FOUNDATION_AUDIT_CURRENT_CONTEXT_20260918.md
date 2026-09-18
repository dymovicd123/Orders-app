# System foundation audit — current context (2026-09-18)

This file is the current continuation pointer for the Orders-app foundation cleanup.

## Repository / deployment guardrails

- GitHub repository: `dymovicd123/Orders-app`.
- Current Stage 0+1 implementation branch: `feature/stage01-truth-projections-20260918`.
- Current green Stage 0+1 head: `d8af03c492db9b44629578ecfcd94c72b4177aef`.
- Production D1 has not been changed by the Stage 0+1 work.
- Branch2 is a separate environment and must not be casually folded into Production work.
- Branch2 is reserved for interactive UI/end-to-end proving of coherent Stage01 groups before Production. Feature-branch static/CI work should remain isolated until it is ready for that test.
- Branch2 current proving head: `d8af03c492db9b44629578ecfcd94c72b4177aef` (R1–R13 green).
- `Приход` remains a frozen/high-risk surface unless a separate approved task explicitly requires changing it.

## Why Stage 0+1 exists

The system accumulated several different notions of “what an order currently is”:

- money totals;
- return/exchange lifecycle;
- shipping/handover state;
- Workshop state;
- catalog identity;
- immutable order-time snapshots.

Historically, UI and API code sometimes used one coarse field as a proxy for another fact. That produces contradictions after corrections, returns, Resolver repairs, old imports and Workshop operations.

Stage 0+1 is creating explicit read projections so each surface consumes the correct truth without rewriting historical evidence.

## Completed slice A — operational order truth

`OrderOperationalProjection` now centralizes the operational read model used by ordinary order UI.

Key correction: historical `return_amount` is a money fact, not proof that a Return/Exchange workflow is currently active.

Workshop state now prefers concrete `workshop_tasks` and uses the old coarse order status only as fallback.

Order edit/ship/return/exchange/handover actions are derived from the same projection.

## Completed slice B — canonical item truth versus historical snapshot

`canonicalItemProjection` now gives working order rows their current canonical product/SKU after Resolver linking.

The original manager-entered identity is preserved in `originalSnapshot`.

Resolver remains link-based: it updates canonical foreign keys rather than rewriting historical snapshot text.

This is especially important for repaired old orders: current work should follow the catalog identity that the system has actually resolved, while audit/history can still answer “what was entered at the time?”.

## Completed slice C — Workshop and action-entry truth

Concrete `workshop_tasks` now control Workshop readiness and shipment blocking. The coarse `orders.workshop_status` field is fallback/cache only when no task truth exists.

Committed Workshop task updates no longer false-fail because a secondary coarse-cache refresh, activity-log write or order readback failed. The route returns fresh order truth when possible, and the frontend updates Orders state immediately.

Order working actions now enter through the same `OrderOperationalProjection`, so UI visibility and controller safety checks no longer maintain separate lifecycle interpretations.

Focused regressions:
- `scripts/test-stage01-workshop-truth-r3.mjs`
- `scripts/test-stage01-order-action-entry-r3.mjs`

## Completed slice D — Finance correction reliability

`correctExchangeFinancials()` now separates committed money truth from secondary readback/logging.

Once the correction batch and order-ledger synchronization are committed, the critical operation is completed before `getOrder()` or activity logging. A readback outage therefore returns a successful `refreshRequired` result instead of falsely reporting that the money correction failed.

This preserves the existing Finance model: current order aggregates are synchronized from payment/return truth, correction chronology stays append-only in financial events, and cash remains a separate physical cash-state ledger.

Focused regression:
- `scripts/test-stage01-finance-correction-reliability-r4.mjs`

Validation: GitHub Actions run `35331323128` passed the cumulative release gate, dependency audits and production build. Temporary PR #74 was closed without merge.

## Completed slice E — Return/Exchange Workshop cache reliability

Return creation, exchange creation, return cancellation and exchange cancellation no longer false-fail because the secondary coarse Workshop order cache could not refresh.

`workshop_tasks` and the concrete lifecycle records remain authoritative. `orders.workshop_status` is compatibility/cache only and is refreshed best-effort after the real mutation.

Focused regression:
- `scripts/test-stage01-return-exchange-workshop-cache-r5.mjs`

Validation: GitHub Actions run `35332084525` passed the cumulative release gate, dependency audits and production build. Temporary PR #75 was closed without merge.

## Completed slice F — Unshipped/refund decoupling

The normal Orders `Не отправлено` filter now follows shipping truth only. Historical or partial returned money no longer removes an active unshipped order from the work queue.

This is the backend counterpart of the R1 rule that `return_amount` is financial history, not a whole-order lifecycle state.

Focused regression:
- `scripts/test-stage01-unshipped-refund-decoupling-r6.mjs`

Validation: GitHub Actions run `35332881155` passed the cumulative release gate, dependency audits and production build. Temporary PR #76 was closed without merge.

## Completed slice G — Bulk Workshop cache boundary

`bulkUpdateWorkshopTasks()` now commits concrete task/item truth before refreshing the compatibility `orders.workshop_status` cache.

The cache refresh is a single bounded affected-order update and is best-effort. A stale/failed coarse cache cannot block valid bulk Workshop work.

Focused regression:
- `scripts/test-stage01-workshop-bulk-cache-r7.mjs`

Validation: GitHub Actions run `35333766883` passed the cumulative release gate, dependency audits and production build. Temporary PR #77 was closed without merge.

## Completed slice F — Unshipped/refund truth decoupling

The ordinary Orders “Не отправлено” filter now follows `shipping_status` only. Historical or partial refunds no longer remove an active unshipped order from that operational queue.

The separate legacy `status=returned` filter was intentionally left unchanged in this slice.

Focused regression:
- `scripts/test-stage01-unshipped-refund-decoupling-r6.mjs`

Validation: GitHub Actions run `35332881155` passed the cumulative release gate, dependency audits and production build. Temporary PR #76 was closed without merge.

## Completed slice G — Workshop bulk cache reliability

Bulk Workshop writes now commit concrete task/item truth first. The coarse `orders.workshop_status` cache refresh is a bounded best-effort follow-up and cannot invalidate a successful bulk mutation.

Focused regression:
- `scripts/test-stage01-workshop-bulk-cache-r7.mjs`

Validation: GitHub Actions run `35333766883` passed the cumulative release gate, dependency audits and production build. Temporary PR #77 was closed without merge.

## Completed slice H — Debt canonical item truth

The live Debt workspace now uses the shared canonical item projection rather than a separate snapshot-first item identity path. Historical order-time snapshots remain preserved as fallback/history.

Focused regression:
- `scripts/test-stage01-debt-canonical-item-r8.mjs`

Validation: GitHub Actions run `35335232585` passed the cumulative release gate, dependency audits and production build. Temporary PR #78 was closed without merge.

## Completed slice I — Workshop canonical item truth

Live Workshop task identity now follows the same shared `canonicalItemProjection()` used by Orders and Debt. Exact linked catalog identity is current truth; immutable snapshots remain fallback/matching evidence.

Legacy inferred fallback variants are deliberately not promoted to exact canonical SKU identity.

Focused regression:
- `scripts/test-stage01-workshop-canonical-item-r9.mjs`

Validation: GitHub Actions run `35336256637` passed the cumulative release gate, dependency audits and production build. Temporary PR #79 was closed without merge.

## Completed slice J — Workshop lifecycle canonical links

New Return/Exchange physical lifecycle work now respects repaired explicit Workshop catalog links before attempting legacy snapshot re-resolution.

Exact linked `variant_id` is canonical truth when valid. A repaired base `product_id` is also preferred for Workshop fallback combination matching. Historical snapshots remain fallback evidence if links are absent or stale; physical freshness/full-stocktake guards are unchanged.

Focused regression:
- `scripts/test-stage01-workshop-lifecycle-canonical-link-r10.mjs`

Validation: GitHub Actions run `35337039333` passed the cumulative release gate, dependency audits and production build. Temporary PR #80 was closed without merge.


## Completed slice K — Pending lifecycle current-link truth

Pending physical lifecycle rows remain immutable historical evidence, but their live reconciliation/context now follows repaired canonical links from the linked order item when those links exist.

This closes the post-Resolver contradiction where an order line could already be canonically repaired while its pending intake still behaved as unknown because the lifecycle snapshot was older.

No lifecycle snapshot text is rewritten. Current `product_id` / `variant_id` are used only as live operational identity, with snapshot evidence retained as fallback/history.

Focused regression:
- `scripts/test-stage01-pending-lifecycle-current-links-r11.mjs`

Validation: GitHub Actions run `35339510564` passed the cumulative release gate, dependency audits and production build. Temporary PR #81 was closed without merge. Branch2 was fast-forwarded to `fc797f5da88ddb5eaa409b2101583c8910529b7f`.


## Completed slice L — Resolver reservation identity

Resolver now cannot expose a corrected canonical SKU while an active physical reservation still points at the previous SKU.

For active unsent work, physical reservation truth is aligned and re-read first; only then are the order item's current canonical links published. Already-issued/fulfilled physical history remains immutable, and sent historical orders remain identity-only.

Focused regression:
- `scripts/test-stage01-resolver-active-reservation-r12.mjs`

Validation: GitHub Actions run `35340711953` passed the cumulative release gate, dependency audits and production build. Temporary PR #82 was closed without merge. Branch2 was fast-forwarded to `3d1e28748d0892126f2deb7ca30b6bfa98f5f5c3`.


## Completed slice M — Handover physical canonical identity

The live handover/shipping surface now displays the same canonical SKU that the active physical reservation will actually consume.

Reservation-linked canonical product/SKU identity is first truth. Current order-item canonical links are the next fallback. Immutable order-time snapshots remain fallback/history only and are not rewritten.

Shipment preparation and blocker/shortage diagnostics use the same live canonical identity for human-facing labels.

Focused regression:
- `scripts/test-stage01-handover-physical-canonical-identity-r13.mjs`

Validation: GitHub Actions run `35344170743` passed the cumulative release gate, dependency audits and production build. Temporary PR #83 was closed without merge. Branch2 was fast-forwarded to `d8af03c492db9b44629578ecfcd94c72b4177aef`.

## Validation state

R2 passed the cumulative release gate and production build on GitHub Actions run `35327687377`.

R3 passed the full cumulative release gate, dependency audits and production build on GitHub Actions run `35330539221`. Temporary PR #73 existed only to trigger CI and was closed without merge.

R4 passed the same full gate on GitHub Actions run `35331323128`. Temporary PR #74 was closed without merge.

R5 passed the same full gate on GitHub Actions run `35332084525`. Temporary PR #75 was closed without merge.

R6 passed the same full gate on GitHub Actions run `35332881155`. Temporary PR #76 was closed without merge.

R7 passed the same full gate on GitHub Actions run `35333766883`. Temporary PR #77 was closed without merge.

R8 passed the same full gate on GitHub Actions run `35335232585`. Temporary PR #78 was closed without merge.

R9 passed the same full gate on GitHub Actions run `35336256637`. Temporary PR #79 was closed without merge.

R10 passed the same full gate on GitHub Actions run `35337039333`. Temporary PR #80 was closed without merge.

R11 passed the same full gate on GitHub Actions run `35339510564`. Temporary PR #81 was closed without merge, and Branch2 was fast-forwarded to the same green head.

R12 passed the same full gate on GitHub Actions run `35340711953`. Temporary PR #82 was closed without merge, and Branch2 was fast-forwarded to the same green head.

R13 passed the same full gate on GitHub Actions run `35344170743`. Temporary PR #83 was closed without merge, and Branch2 was fast-forwarded to the same green head.

R6 passed the same full gate on GitHub Actions run `35332881155`. Temporary PR #76 was closed without merge.

R7 passed the same full gate on GitHub Actions run `35333766883`. Temporary PR #77 was closed without merge.

## Important distinction for the next audit

Do **not** convert every historical screen to canonical-first.

Use current canonical identity for a live/working operational order after Resolver repair.

Use immutable snapshots where the purpose is historical evidence, audit, old transaction description, or preserving what was entered at that time.

The next audit must classify each remaining read surface by purpose before changing it.

## Immediate next checkpoint

Audit the remaining Return/Exchange, Finance and any still-live order/inventory surfaces by purpose. Live operational views may use canonical current identity; historical/audit/transaction views must preserve order-time evidence. Keep F2–F9 money semantics unchanged unless a concrete contradiction is proven.

See:
`docs/continuation/STAGE01_IMPLEMENTATION_CHECKPOINT_20260918.md`

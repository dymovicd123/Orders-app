# Stage04-B2 — Workshop cost snapshot from Catalog (2026-10-11)

## Confirmed business rule

The initial Workshop work charge is **current Catalog себестоимость at the moment the Workshop task becomes ready/done × the task quantity**. This cost is saved in the immutable event journal. Future edits to Catalog cost do not reprice completed work. This is one simple shared Workshop settlement ledger for ordinary and Kaspi orders, not a separate complex debt product.

The Catalog cost key is `catalog_variants.stock_position_id + catalog_variants.category` in `catalog_execution_prices`; material, length and adult/child matter. Never use a product-name guess, sale price, customer order price or order total.

## Scope of B2

`0106_v72_workshop_completion_catalog_cost_snapshot.sql` replaces only the dormant completion-capture trigger from 0084; it keeps the original 0083 event journal and the existing 0084 reversal trigger intact. It changes **no business rows** and adds **no historical backfill**.

When capture is deliberately enabled at a later cutover, both single and bulk `active -> ready/done` task changes atomically write the task, linked order-item ID, frozen product/characteristics/quantity and Catalog unit cost and amount. Repeated writes and `ready <-> done` do not create a second charge. Return to active/cancelled compensates the original frozen sum instead of silently changing old history.

A cost is accepted only when task/order-item variant pointers agree when both exist, the order-item belongs to the same order, the product IDs are consistent and the selected variant has a Catalog execution cost. Absent or conflicting price/identity produces a visible-to-future-UI **unpriced event** with `unit_cost=NULL` and `amount_delta=NULL`, not a false zero-cost charge. Explicit Catalog cost 0 is distinct from unknown.

## Activation and environment

**Capture remains OFF** (`workshop_settlement_capture_control.enabled=0`), including after installation. PR merge and migration installation do not constitute business cutover.

The one-purpose workflow applies 0106 only to Branch2 Worker `orders-app-branch2`, isolated D1 `orders_db_branch2` (ID `40065052-854e-44b8-bcd5-251bdd488301`). It fails closed without all prerequisite tables/triggers, required workshop order-item linkage, and capture disabled. It runs tests, records pre/post business fingerprints and verifies the replacement trigger. No fallback to production.

This PR never changes `main`, production D1, current orders, payments, inventory, pricing edits, or the UI.

## Verification

`node scripts/test-stage04b2-workshop-catalog-cost.mjs` covers: off-by-default; single/bulk ready; adult/child-specific cost; price snapshot immutability; return reversal and repeated completed work; missing vs explicit-zero cost; cross-order item pointer and mismatched SKU; missing variant; repeated migration; disabled recapture.

## Next Stage04 slices

1. Audit missing Catalog costs and design a simple user-facing pending-price queue; do not silently count unresolved work as zero.
2. Stage04-C: append-only Workshop payments, partial payments, advances, opening balance, error-safe compensation.
3. Stage04-D: single `Расчёты с Цехом` tab beside ordinary/Kaspi channels showing completed work, payments, remaining and unresolved prices.
4. E2E regression and deliberate Branch2 activation; keep production unchanged pending a separate explicit production release decision.

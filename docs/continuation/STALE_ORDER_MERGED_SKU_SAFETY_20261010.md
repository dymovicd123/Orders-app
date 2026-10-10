# Prevent stranded source SKU after consolidation (2026-10-10)

**Priority:** preserve employee mobility: no long-lived SKU lock, no forced abort of valid work, no re-entry of whole form. Backend safety first; UI remains unsatisfactory and will be redesigned only after the complete reference backend is stabilized.

## Confirmed hazard
Order creation uses an idempotent resumable `preResolvedCatalog` captured during validation. During a slow save/retry, an administrator may merge the SKU. Even though the visible catalog resolver only selects active variants, a stale pre-resolved ID could subsequently be written to an order item. The old independent `POST /api/catalog/variants/reconcile-stock` also corrected quantities without retiring the source, reopening the same risk.

## Implemented
- `resolveConsolidatedOrderWriteVariant` revalidates every non-workshop SKU immediately before the order-item insert. If still active, no change. If inactive, follows ONLY audited `catalog_variant_consolidations` source→target; verifies every step remains the same product, has a finite acyclic lineage and ends with an active variant. No arbitrary changed characteristic, non-merged retired SKU, or cross-product alias is silently accepted.
- Existing form snapshots (entered name/color/size/price) stay as entered; only the safe **physical SKU pointer** is moved. Shipped historical item pointers are preserved. If the exact physical identity cannot be proven, error is actionable; the order is not silently redirected.
- Schema 0097 introduces five lightweight SQLite triggers restricted to *inactive merged source SKUs*; these reject a concurrent stale active order insert/reassignment, source-reservation creation/reactivation and unsent reopening of old history, while allowing current primary SKU operations and shipped history. They are **not staff locks on active SKUs**.
- Standalone `POST /api/catalog/variants/reconcile-stock` now returns admin-only HTTP 409 with instructions to perform the audited one-shot merge instead. Its historic reports remain accessible. The independent writer module is kept for reading historical receipts/regression only.
- Branch2-only schema rollout fingerprints orders, money, physical and reserved stock, movements, and Stage04 before/after; *zero* business rows are migrated.

## Intentional boundaries
- For an inactive SKU with no authorized consolidation, never silently revive or guess the replacement. Use existing Catalog recovery workflow.
- No unconditional redirect from an arbitrary `variant_id` to a visually similar item.
- The resolver does not mutate catalog or stock; it does not promise editing/arrival/exchange UI now auto-correct all stale forms. Those entrypoints need a separate audited pass and user-friendly feedback.
- Stage04 settlement, finance, historical shipment details and main/production are outside this change.

## Acceptance
Run `scripts/test-catalog-stale-order-merge-bridge.mjs`, both complete release gates, strict build; schema 0097 only in branch2 remote D1 with preserved data. Follow with retired SKU prevention in arrival and other write entrypoints, safe reversal analysis, and full UI redesign.

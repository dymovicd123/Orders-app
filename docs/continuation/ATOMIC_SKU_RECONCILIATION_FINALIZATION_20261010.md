# One-step SKU stock resolution and retirement — Branch2 backend, 2026-10-10

**Reason:** The prior workflow corrected stock while the source SKU stayed active until a later manual consolidation. Such a pause risked new orders on an already reconciled source. A long-lived lock is unacceptable to shop staff.

## One atomic confirmation (no reservation lock)

Admin reviews the latest existing `/api/catalog/variants/consolidation-preview`, then calls existing admin-only consolidation endpoint once with `expectedToken` and independently verified `verifiedStockDecisions` per **source-positive** place:
- `sum`: only after physical confirmation that both entries represent different units;
- `keep_source`: after confirming the source count is correct;
- `keep_keeper`: after confirming the keeper count is correct;
- `physical_count`: supply the independently verified nonnegative integer `countedQuantity`.

For `keep_source`, `keep_keeper`, or `physical_count`, provide a reason of 12–500 characters. An absent source balance needs no decision. The final number may **never** be smaller than existing reserved quantities.

The full existing SKU identity, same-product execution/color/size, linked open-order/reservation, past-month history, reversible movement, exchange/return, workshop and stocktake gates are retained. **Any non-additive physical correction is blocked if EITHER SKU has current orders, reserves, active workshop, reversible lifecycles/transfers or exchange/return history**. No cancellation or stock loss is hidden.

Before confirmation, normal staff work proceeds. If an order, reservation, stock balance or variant identity changes, the operation fails closed. At confirmation, one D1 batch writes original consolidation receipt, immutable per-location stock decision lines in 0096, projected/actual stock and reservations, audited quantity-correction revision movement, postcondition checks, current valid linked order remapping (only safe add cases), and source SKU deactivation. A failed postcondition forces batch rollback. No intermediate corrected-but-active source SKU. Historical shipped order snapshots remain intact.

Existing `catalog_variant_consolidations` is the authoritative source→keeper mapping for later old-form resolution, rather than a separate alias table. A stale form referring to the now-inactive source must be resolved by application code; this rollout **does not claim** that every legacy editing entrypoint auto-redirects yet.

## Still intentionally unsupported

Cross-product/color/material/size reclassification without exact physical identity; non-additive corrections when either variant has active customer obligations or reversible operations; automatic reversal after subsequent inventory changes. These remain explicit blockers. UI overhaul deferred.

## Validation

SQLite fixture in `scripts/test-catalog-integrity-r2-sku-consolidation.mjs` covers two locations with independent `keep_keeper` and `physical_count` decisions, adjustment journal, movement entries, missing confirmations, idempotency, and concurrent new keeper order. Legacy guarded reservation/stock merging and Stage04 baseline regression remain required. The additive-only 0096 table is migrated exclusively to isolated Branch2 D1 with money, stock and workshop fingerprints.

# Catalog stock consolidation corrections — Stage 6 backend

Date: 2026-10-10. **UI is intentionally unchanged and considered unsatisfactory pending backend closure.**

This phase adds guarded, audited per-location stock correction for **exactly the same business SKU**. It is deliberately not a global characteristic rename and does not auto-retire a catalog variation.

## Supported write methods

- `keep_source`: leave the verified source physical quantity as the keeper's final quantity; the source balance becomes zero.
- `keep_keeper`: leave the verified keeper physical quantity; the source balance becomes zero.
- `physical_count`: independently counted physical total becomes the keeper's final quantity; the source balance becomes zero.
- `sum`: remains an explicit verified per-location decision in the existing guarded SKU consolidation endpoint.
- `defer`: no mutation.

**One SKU pair + one location per operation.** All quantities, method, correction delta, operator, reason, date and original stock IDs are stored in `catalog_stock_reconciliation_journal`. `inventory_movements` contains two revision movements (never a fake shipment or writeoff) and `inventory_stock_checks` contains linked correction observations. Corrections are specifically **excluded** from the latest independently verified physical count displayed in the preview.

## Fail-closed first iteration

The correction method **refuses any active/reserved customer order** or a pending/reversible exchange, return, warehouse transfer, workshop task or stocktake for either SKU. The accountant/administrator must resolve those business obligations separately. Completed/shipped historical order lines are left unchanged.

- Both SKU identities and existing inventory rows are required. Missing keeper stock rows are **not silently created** in this iteration.
- D1 compares original stock quantities and zero reserves at the SQL write boundary, checks both current SKU snapshots, and repeats operational blocking predicates.
- The receipt, stock changes, stock movement audit, stock-check observations and postcondition proof are written in **one atomic D1 batch**.
- A failed database postcondition aborts all writes. A unique request ID provides replay safety without extra inventory movement.
- After resolving all physical locations, the old SKU remains active until a **separate** existing validated SKU consolidation is confirmed.
- The API is restricted to administrators; the existing UI does not expose this action yet.
- The first iteration does not provide automatic reversal, all-new-product/material identity changes, or stock reconciliation while orders have open reservations. These are later scoped work, not completed.

## Acceptance

`scripts/test-catalog-stock-reconciliation-write.mjs` uses SQLite plus all catalog SKU migrations and new additive journal schema. Exercises all correction methods, independent locations, duplicate replay, stale token, active orders, concurrency, postcondition failure/rollback and preserved historical order links. New migration `0095` creates only empty audit tables in isolated Branch2. Old Stage04 and historical checks must stay green.

Next: connect a dedicated **reversal preview / compensating** journal process for corrections and selected SKU merges, with downstream inventory/obligation checks, then redesign UI. No production/main modifications.

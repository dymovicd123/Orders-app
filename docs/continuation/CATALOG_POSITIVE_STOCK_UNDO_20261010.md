# Positive-stock undo checkpoint — 2026-10-10

## Narrow operational definition

Only **original-generation, pure-additive, exact-SKU consolidation** with a positive original source quantity and **zero original reservations** is eligible for automatic compensation. Original decisions must all be `sum` with zero `adjustment_quantity`; original source/keeper stock rows must both exist for each audited location, and match the immutable root 0090–0092/0096 receipts exactly. No new customer orders, reservations, movements, stock checks, transfers, returns, exchanges, active workshop/stocktake, later merges or invalid timestamps are allowed.

For each warehouse/boutique ledger row: merged state `(source=0, keeper=oldSource+oldKeeper)` is atomically compensated to `(source=oldSource, keeper=oldKeeper)`. The **physical sum does not change**. Restoring the exact per-variant ownership is *not* a writeoff/arrival: `inventory_movements`, `order_items`, `inventory_reservations`, money, workshop balances and historical order snapshots are not modified.

## APIs and atomic proof

Admin GET `/api/catalog/variants/consolidation-undo-positive-stock-preview?consolidationId=…` lists source/keeper quantities per location, blockers, and a state token including the original undo preview, exact stock row fingerprint and prior generation count.

Admin POST `/api/catalog/variants/consolidation-undo-positive-stock` receives `{consolidationId,reason,expectedToken}`. Reason 12–500 chars, fresh token mandatory. Runtime first revalidates, then a **single D1 batch** appends generation-2 undo, stores immutable location-level physical compensation, reactivates the original SKU, restores keeper/source stock quantities and writes final immutable 0102 validation. The trigger proves exact balances, no extra rows, no reservation, original pure-sum decisions, source positive original and total conservation. A wrong row triggers rollback of the entire batch.

Staff are not locked during preview. If a staff order/reservation/stock operation is accepted first, the administrative write is invalidated instead of blocking staff. Missing, changed or even post-merge-touched stock rows fail closed.

**Schema-first:** 0102 was applied only to isolated Branch2 D1 by successful [workflow](https://github.com/dymovicd123/Orders-app/actions/runs/38043073516), with read-only business/stock/money/Stage04 fingerprints unchanged.

## Acceptance and remaining work

New SQLite test verifies warehouse + boutique conservation, audit rows, source restoration, unchanged shipped order snapshots, no fictitious movements, manual-correction refusal, reservation refusal, stale preview, concurrent order and intra-batch tampering rollback, immutable generation and replay denial.

The UI is **not yet exposed to staff**. Automatic reversal of a merge containing an independently verified physical correction, original reservations, a missing prior keeper row, unverified later stock movements or higher lifecycle generations still requires separate design, user-reviewed physical inventory decision and stricter proof. Never silently “restore old numbers” in those cases. No main or production data changes.

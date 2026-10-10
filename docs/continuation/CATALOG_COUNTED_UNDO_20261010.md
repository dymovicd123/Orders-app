# Corrected physical SKU undo — completed counted backend (2026-10-10)

## User/business rule
For a corrected original exact-SKU consolidation, historic original source/keeper quantities are **not** restored automatically. An administrator explicitly counts and chooses **both** source and keeper quantities for every audited warehouse/boutique location. Each quantity must be a safe nonnegative integer; both must be explicitly physically verified and their sum must equal the CURRENT combined physical amount in that location. No default selection from historical balances. The system cannot mint or discard a unit with this undo.

## Delivered
- Schema-first migration `0103_v72_catalog_counted_undo_validation.sql`: isolated branch2 D1 only, immutable per-location generation-2 allocation journal, final CHECK-backed proof for original corrected decision, complete per-location stock row mapping, active source/keeper, zero reserves, no extra rows, quantity conservation and one immutable proof.
- Existing admin-only GET `/api/catalog/variants/consolidation-undo-corrected-review?consolidationId=N` supplies initial historical, correction and current stock evidence and blockers without changes.
- Admin POST `/api/catalog/variants/consolidation-undo-counted-preview` with `{consolidationId,allocations:[{location,sourceQuantity,keeperQuantity,physicallyVerified}]}` validates explicit allocations without changing records; returns `canUndoCounted,errors,stateToken`.
- Admin POST `/api/catalog/variants/consolidation-undo-counted` with the same fields plus `reason,expectedToken` requires a fresh preflight. In one atomic D1 batch: generation-2 undo event, immutable per-location counted receipts, source reactivation, keeper/source quantity redistribution, final proof. All-or-nothing SQL.
- Original correction `inventory_movements` stays as historical physical adjustment; **no new fictitious movement** is added when identity is redistributed. `orders`, `order_items`, customer payments, reservations, financial events and shipped historical snapshots stay intact. UI is not yet exposed; admin REST only.
- Counterparty orders, reservations, changed stock/checks, linked workshop/lifecycle/transfer/return/exchange, missing original keeper row, incomplete original audit, later generations and inconsistent correction movements block this route. No staff long-lived locks; customer operation wins any write race.

## Tests
The new regression tests: both locations with corrected warehouse count and independent boutique count; refusal for missing, duplicate, unverified, fractional or wrong-total allocations; original financial, order and movement snapshots; a new order between preview/write; mid-batch stock tamper rolling back all 6 statements; no replay. Cumulative Stage04-safe integration and Quality checks required. `main` and production database must remain unchanged.

## Still remaining
1. Complex original reservation/order pointer compensation and later sales/stock events (separate manual case resolution, not an automatic stock count shortcut).
2. Characteristic-level merges across genuinely distinct SKU colors/sizes/length/material; prevent duplicates at creation and protect stale forms.
3. Human-friendly admin workflow and writeoff redesign with employee usability testing.
4. Final branch2 stress/security/DB concurrency checks, and only then explicit confirmation before main.

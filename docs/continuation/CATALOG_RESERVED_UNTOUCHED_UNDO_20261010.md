# Untouched originally transferred reservations undo — 2026-10-10

## Strict business rule
A first-generation exact-SKU merger may have moved **active customer reservations** and matching open unsent `order_items.variant_id` from source to keeper. A reversal may restore those pointers ONLY if all original reservation IDs and client orders are still active, unsent and **unmodified**, and all warehouse/boutique physical stock and reserved balances still exactly match the original merged receipt. Original shipped orders are never rewritten.

## Delivered
- Schema `0104_v72_catalog_reserved_undo_validation.sql`: append-only original-location physical+reserved compensation, per-reservation identity audit and final CHECK-backed D1 proof. Isolated schema-only migration and business fingerprints pass before the writer is deployed.
- Admin GET `/api/catalog/variants/consolidation-undo-reserved-preview?consolidationId=N` returns explicit blockers, all original stock/reserve locations, full initial reservation count (at most 50), and fresh immutable state token.
- Admin POST `/api/catalog/variants/consolidation-undo-reserved` requires `{consolidationId,expectedToken,reason}`; actor is the authenticated admin. In one serial atomic D1 batch: append generation 2, append original location & reservation audit, activate source, restore keeper/source physical+reserved balances, return only the validated active reservations and unshipped order-item SKU pointers to source, and write the final immutable SQL proof. Any incomplete/mismatched final state fails and rolls back all earlier steps.
- Original financially relevant orders, prices, shipped order snapshots, stock movements, returns, exchanges, payments, writeoffs and immutable merger receipts remain untouched; **no fabricated stock or reservation movement**. Source and keeper totals preserved independently for physical quantities and reserved quantities by location.
- Does not lock staff while admin previews: concurrent staff operations win, causing administrative undo to fail closed on revalidation.

## Refusal cases
Historical shipped, fulfilled, returned, exchanged, cancelled or edited customer orders; changed product identity, stock status or shipping state; partial/inconsistent order reservation; any postmerge movement/stocktake/transfer; changed/missing original reserve IDs, quantity, location or updated_at; altered keeper/source physical and reserved counts; any physical manual correction; an extra keeper-only stock location or downstream SKU merge; unsupported unknown timestamps; more than 50 original links (needs paginated reconciliation). All such cases continue via **read-only** `consolidation-undo-case-review`; never use this writer to force a rollback.

## Tests and remaining scope
New SQLite regression checks warehouse+boutique, pre-existing keeper reservation, shipped order untouched, original per-line financial snapshots, invalid/residual link cases, unknown shipping/product IDs, late staff order CAS, mid-batch tamper rollback, per-location stock+reserve conservation, immutable generations and replay refusal. Quality, Stage04-safe and Cloudflare exact branch2 deploy must all pass.

Remaining beyond this narrow case: orders already sent or changed after consolidation, stock movements/revisions after merge, genuine cross-characteristic SKU merging, duplicate prevention, user-facing References and writeoff redesign. Do not move to main/production without explicit user approval.

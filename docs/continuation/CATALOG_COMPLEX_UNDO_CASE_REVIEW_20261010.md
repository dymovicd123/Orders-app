# Complex SKU undo: customer commitments and later activity case review — 2026-10-10

## Business boundary
Restoring a SKU identity is not equivalent to undoing customer orders. The original exact-SKU consolidation **repointed active reservations and open, unsent order_item.variant_id** to the keeper, while shipped historic items retained their original snapshots and attribution. If a customer later receives, cancels, exchanges or returns an item, reversing the pointer would retrospectively falsify history and might duplicate reserved stock. The same risk applies to postmerge receipts, sales, stocktakes, writeoffs, exchanges and transfers.

## Delivered read-only admin API
`GET /api/catalog/variants/consolidation-undo-case-review?consolidationId=N` is **admin-only, read-only**, and does not add a compensating writer.

It builds on the original immutable root/stock/reservation preflight and returns:
- Original transferred reservation receipt **per order item** with old SKU, keeper SKU, original location and quantity, current reservation and order linkage; state `active_unchanged`, `edited_after_merge`, `fulfilled_or_released`, `changed_link`, or `missing_link`.
- Order items created or edited after the consolidation, including shipped status and any exchange/return linkage.
- All postmerge inventory movements with per-place signed quantity delta, reference and date, excluding ONLY the exact *original merge-time stock-finalization movement*.
- Later inventory stock checks by location, plus all original blocker categories (workshop, transfer, exchange, return, nested merges and unknown timestamps).
- A prioritized, business-language reconciliation checklist and warning if any chronology or linked record is missing/ambiguous.

Every detail section has a **full total count and up to 50 records**. Over-limit cases explicitly set `truncated=true`, `summary.incompleteEvidence=true` and `requires_pagination`; 50 entries are never interpreted as an exhaustive audit. All results set `canUndoNow=false`, `automaticCompensationAllowed=false` and `noChangesApplied=true`.

The preview never locks employees or changes orders, reservations, stock rows, money, movements or merge journals. SQLite regression verifies changes in reservation quantity/status/ownership, sending a customer order, subsequent sale, later stocktake, invalid timestamps, >50 movements and **zero database mutations**.

## Next required decision and implementation
1. Start with exact untouched original active reservations only: define an immutable proof covering original order/reservation IDs, customer commitments, physical stock per warehouse/boutique and CAS on order item/reservation/status. Do not repoint already fulfilled, changed or exchanged orders. Obtain explicit confirmation before enabling even a narrow writer.
2. For orders already shipped/returned and later stock events, build a **case resolution workflow**: identify authoritative current counted stock by place, preserve original financial and order history, and guide corrective active operations instead of pretending the original event did not happen.
3. Bound full-detail pagination and secure case access; generic employees must never be exposed to admin recovery endpoints.
4. Human-friendly admin UI with explanations, reconciliation status and safe action gating. Comprehensive branch2 production-like rehearsal, then explicit user confirmation before main.

Never claim the broad complicated reverse is now automatic. Stage04, main and production D1 remain untouched.

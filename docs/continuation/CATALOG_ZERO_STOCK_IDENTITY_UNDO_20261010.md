# Safe first class of SKU consolidation reversal — 2026-10-10

## Scope and safety boundary

**ONLY zero-source-physical-stock, no-reservation identity merges**, with immutable 0090–0092/0096 receipts; separate ongoing stock correction and multi-location physical reversal deliberately remain disallowed. The operation may return an unused duplicate to an active SKU **only after** confirming that nothing relevant happened after the initial consolidation. It DOES NOT mutate inventory_stock, order_items, reservations, money, inventory_movements, or historical order snapshots.

The existing admin read-only `consolidation-undo-preview` reports `canUndoZeroStockIdentity`, the specific blockers, and a `undoStateToken` over the root identity, SKU timestamps, locations, later customer/inventory activity and blockers. This is distinct from the general `canUndoNow=false` shown for unrestricted physical reversal. An administrator invokes `POST /api/catalog/variants/consolidation-undo-zero-stock` with {consolidationId, expectedToken, reason}; reasons require 12–500 characters.

During a **single atomic D1 batch**:
1. Append generation-2 `undo` event to 0099, preserving the unique immutable root consolidation receipt;
2. Reactivate the originally inactive source SKU, but only if the actual source and keeper identities, timestamps, exact existing stock rows, zero physical/reserved source quantities, original receipts and *lack of subsequent events* are still true AT THE SQL WRITE BOUNDARY;
3. Insert immutable 0100 validation with `CHECK(passed=1)` demanding successful source activation and zero physical quantity; any incomplete batch rolls back.

Original order and inventory history remain in place. An active staff SKU is **never locked during review**. Concurrent new orders, reservations, movements, physical counts or secondary SKU merges invalidate the administrative operation rather than stopping the employee. All ambiguous or missing event timestamps, incomplete ledgers, reversals, previous generations, or originals with nonzero physical stock are rejected. No replay can append duplicate generations.

**Excluded until follow-up:** undo where the original source had positive physical stock, where quantities or reservation pointers were transferred, when keeper location did not have an original stock row, or after any downstream activity. Restoring physical balances in these cases requires fully audited compensation and possibly human review. Future merge generations are already represented by 0099 but still lack their own audited write endpoint; do not claim arbitrary remerge is complete.

Migration 0100 creates an empty validation table only in isolated Branch2 D1, with read-only money, order, stock, reservation, movements and Stage04 fingerprints before and after. Historical stage04-preserved integration gate and SQLite race/rollback tests must pass before any branch2 deployment. UI remains unchanged. Main and production D1 untouched.

# Stage03 H9A — itemized Exchange backend foundation

Date: 2026-09-25

Environment: **Branch2 only**. Production/main is not a target. No Production D1 action is allowed in H9A.

Status: backend contract only. The existing itemized Exchange entry points in the UI remain fail-closed until H9B.

## Accepted itemized Exchange semantics

For an `itemized_v1` order, an exchange is a replacement of one active commercial line by another commercial line.

- the old `order_items` row remains historical; only the exchanged active quantity is reduced;
- the new replacement row receives its own actual `unit_price`;
- the new replacement row receives its own `catalog_price_snapshot` or explicit `NULL` when Catalog has no applicable price;
- `line_total = quantity × unit_price`;
- `orders.total_amount` is derived from the active itemized lines, not from the exchange payment/refund amount;
- current Catalog price is a recommendation/snapshot source, never an automatic surcharge.

A manager may perform a negotiated no-difference exchange by giving the new line the same actual sold price as the replaced line even when the current Catalog recommendation differs. The current Catalog recommendation is still stored separately as the new line snapshot.

## Money stays a separate fact

`financial_action` remains an actual money event:
- `extra_payment` inserts the linked exchange payment;
- `refund` inserts the linked exchange refund;
- `none` records no money movement.

For itemized orders, those money facts do **not** add to or subtract from `orders.total_amount`.

The backend rejects an itemized exchange when the projected net retained money would exceed the projected itemized commercial total. Underpayment/debt may remain; unexplained overpayment may not.

Legacy `legacy_manual_total` exchange arithmetic is preserved unchanged.

## Stale-editor boundary

Before the first H9A write, itemized Exchange requires the caller to echo:
- the observed order total;
- the old active quantity;
- the old unit price;
- the old line total;
- the old Catalog price snapshot, including explicit `NULL`.

The server re-reads all active itemized lines, verifies every stored `line_total`, verifies their sum equals persisted `orders.total_amount`, and rejects a stale/mismatched snapshot before mutating the exchange.

The validated itemized price plan is frozen into the critical-operation context so an idempotent retry continues the same accepted operation rather than recalculating against its own partial writes.

## Correction and cancellation

Exchange financial correction on an itemized order may correct the linked payment/refund facts but may not change the commercial order total.

Exchange cancellation restores the old line quantity, retires the replacement line, and restores the itemized total from line values. It does not reverse the total by the financial amount. Linked money events are still reversed through their existing audited paths.

## H9A non-goals

- no UI activation for itemized Exchange;
- no migration;
- no Catalog price backfill;
- no Production/main change;
- no return-policy redesign;
- no discount UI.

Next step after H9A is green: H9B UI payload/price resolver wiring and Branch2 manual acceptance.

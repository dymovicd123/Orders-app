# Stage03 H9 — itemized Exchange

> **Current-status note — 2026-10-05:** H9A/H9B/H9C remain historical compatibility evidence, but their old→new pair/batch UX is superseded for modern `itemized_v1` operations by **Exchange Set V2**. See `docs/continuation/EXCHANGE_SET_V2_20261005.md`. Legacy `legacy_manual_total` Exchange still uses the compatibility flow.

Date: 2026-09-25

Environment: **Branch2 only**. Production/main is not a target. No Production D1 action is allowed in H9A.

Status: H9A backend foundation implemented; H9B UI activation implemented on the Branch2 work branch and gated by cumulative CI before merge.

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


## H9B UI activation

H9B activates itemized Exchange in the existing Exchange form without reusing legacy manual-total semantics.

- both ordinary order entry and Workshop entry may open Exchange for `itemized_v1` orders;
- H9B initially allowed one replacement pair per itemized Exchange operation; H9C below supersedes that temporary restriction with a resumable multi-pair path;
- the historical sold price is the default factual price for the new line, which makes a negotiated no-surcharge exchange easy and explicit;
- changing the new product or a Catalog-driving dimension (audience, material, length) refreshes the current Catalog recommendation;
- a deliberate manager-entered sold price is preserved when the Catalog recommendation refreshes;
- Catalog recommendation remains a separate snapshot and never silently overwrites the manager's factual sold price;
- the form shows `Цена по каталогу`, `Цена продажи`, and the resulting new-line amount directly;
- missing/invalid sold price remains fail-closed.

Immediately before POST, the client validates the current old line snapshot and sends H9A's stale contract:
`expectedOrderTotal`, `expectedOldActiveQuantity`, `expectedOldUnitPrice`, `expectedOldLineTotal`, and `expectedOldCatalogPriceSnapshot`.

The new item payload carries its factual `unitPrice` separately from `catalogPriceSnapshot`.

### Financial UX

The itemized commercial total is never edited through the Exchange financial amount.

The Exchange finance panel represents only the real cash event:
- no money movement;
- client extra payment;
- refund to client.

Therefore an itemized replacement may create or reduce debt according to the new line price, while the separate money action records only what actually moved.

### Compatibility

Legacy Exchange behavior is intentionally preserved for `legacy_manual_total` orders. H9B does not migrate or reprice old orders.

No migration is introduced by H9B. Production/main remains outside the release scope.


## H9C itemized multi-pair Exchange — 2026-10-02 Branch2

H9C removes the temporary one-pair UI restriction for `itemized_v1` orders while keeping the same factual-price contract.

The implementation deliberately does **not** pretend several replacements are one D1 SQL transaction. Instead it uses a parent critical operation plus deterministic idempotent child Exchange operations:

- the browser queues several old→new pairs and sends one `POST /api/exchanges/batch`;
- the parent request fingerprint freezes the complete batch payload before the first commercial mutation;
- every old-line price/quantity snapshot and the starting order total are re-read and validated before execution;
- the final itemized commercial total and final net retained money are validated before the first child Exchange;
- child request ids are derived deterministically from the parent id, so a lost response or transient failure can safely resume without duplicating an already completed replacement;
- price-increasing/neutral replacements execute before price-decreasing replacements. A real refund, when required, is attached to the first child; a real extra payment is attached to the final child. This keeps every resumable intermediate state free from unexplained overpayment;
- repeated new SKUs are aggregated for the physical-stock preflight. A manager's explicit physical count for the same SKU must agree across rows and is applied only once, preventing a second row from resetting stock back to the pre-first-issue count;
- Workshop replacements remain supported per child through the existing exact task-link path;
- legacy `legacy_manual_total` multi-pair Exchange stays on its existing path and is not repriced.

If an application/transport failure happens after one child has committed, retrying the exact same batch resumes from the parent critical operation and replays already completed child requests from their cached responses. Changing the batch payload uses a different client idempotency request and therefore cannot silently reuse a partially completed parent operation.

H9C is **Branch2 only** until manual acceptance confirms:
1. two ordinary itemized replacements in one visit;
2. mixed cheaper/more-expensive lines with one aggregate refund or extra payment;
3. two replacements requesting the same physical SKU;
4. a Workshop replacement mixed with a stock replacement;
5. retry after a simulated lost response does not duplicate Exchange rows, money events or stock movement.

Production/main must not receive H9C until that acceptance is complete.

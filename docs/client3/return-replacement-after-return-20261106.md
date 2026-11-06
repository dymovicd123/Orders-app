# Client3: новая комплектация после оформленного возврата

Status: design only — no route or inventory mutation is enabled by this document.
Scope: watches, same order, same brand. No reinstatement of the old Exchange feature.

## Why rewriting an order is unsafe

An existing Return has immutable links to order_items, return_items, financial_events,
physical receipt and dispatch records. Generic Main itemContentReplacement retires prior
order lines and releases reservations; it must never be used to rewrite a returned or
physically issued line.

Current commercial projection is:
- grossTotal: orders.total_amount
- returnedGoodsValue: sum(return_items.amount, historical price fallback)
- netSale: max(0, grossTotal - returnedGoodsValue)
- netPaid: max(0, orders.received_amount - orders.return_amount)
- debt: max(0, netSale - netPaid)
- overpayment: max(0, netPaid - netSale)

## User experience

In an order with a completed item Return, show "Добавить часы после возврата" near
the relevant return history, not "Изменить старый товар". Display the original
returned item and outcome (physical intake: received in Office, Showcase,
no stock, or pending).

Use the existing brand-locked creation picker: Office or Showcase; available
SKU, whole catalog, or manual characteristics; quantity, price, engraving,
and deadline for this new line. No brand selector or cross-brand SKU.
Show before confirmation:
- original order gross and historical returned goods credit;
- already paid, actually refunded, net paid;
- cost of replacement, new net sale, due or overpayment;
- new reserve/source and engraving/shipping status;
- whether prior physical intake is still pending.

The action must be distinct from return cancellation, shipment correction,
deletion, and a cash refund. It never modifies those records.

## Required implementation

1. Read-only preview endpoint bound to orderId + brandId + selected returnId;
   verify active return with physical goods and exact order_item links,
   distinguish money-only returns, active partial returns and cancellation.
2. Dedicated append operation with immutable relation/journal for
   returnId -> newOrderItemIds and a unique requestId/fingerprint.
   Use a persistent recovery-safe critical operation or an atomic batch.
   Do not use itemContentReplacement (which retires old lines).
3. Preserve all old order_items, dispatches, inventory movements,
   return_items, receipts, payments and refunds. New lines are freshly created
   with their own canonical watch_variant_id and source-scoped reservation.
   The reserved quantity cannot exceed admitted available stock without the
   explicit, separately audited shortage path.
4. Increase gross order total by the new item total exactly once; recompute
   the existing itemized debt using the commercial projection. Do not
   post any new payment or refund automatically. Enforce same brand and
   authorized manager. Ledger and UI must agree on one persisted balance.
5. New line enters logistics as unready/unshipped; the original returned
   unit remains historical, not ready to ship again. Physical restock is
   only via existing return receipt confirmation, never via the append.
6. Support cancellation of the replacement line only if not issued,
   not shipped, not linked to a later return and with a safe reservation
   release. Provide a separate audit trail and re-check cash effects.
7. Return cancellation after a replacement must check the new dependency,
   recompute commercial totals and refuse unsafe cancellation; no orphaned
   return/replacement relationship.

## Money examples (tenge)

Original 100,000; paid 100,000; goods returned with 100,000 credit.
- No money refunded, replacement 120,000: new gross 220,000,
  credit 100,000, net sale 120,000, net paid 100,000, due 20,000.
- Actual 100,000 refunded, replacement 120,000: net paid 0, due 120,000.
- No money refunded, replacement 80,000: net sale 80,000,
  net paid 100,000, customer overpayment 20,000. A separate,
  explicitly confirmed money-only refund may clear it; never auto-refund.

## Acceptance requirements

- Original and replacement remain visible and can be independently traced.
- Return already recorded, physical receipt pending: adding a replacement
  changes no stock for the old SKU. Only new SKU acquires a reserve.
- Partial dispatch and partial return: existing issued units, nonreturned
  units, refunds and history are untouched.
- Same-model / different-variant and different-brand attempts: exact SKU/
  brand binding and stock isolation.
- Duplicate/retried request: one new line/reserve/debt delta, not two.
- Crash after each transition and concurrent stocktake/dispatch: retry
  resumes without double write or false physical restore.
- Refund given/not given, cheaper and more expensive replacement,
  multiple payment methods and mismatched historical totals all checked.
- Anonymous, manager of other brand and logistics role cannot run the action.
- All operations run on a disposable QA copy of D1 before deployment.

Note: until this transaction, ledger and lifecycle tests pass, keep
direct generic composition rewrite of returned orders blocked.

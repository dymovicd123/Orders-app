# Stage03 H10 — manual Return money policy

Date: 2026-09-25

Environment: **Branch2 only**. Production/main is not a target.

## Decision

Stage03 does **not** infer a refund from item prices.

A Return contains two independent facts:

1. **Physical fact** — which order items and quantities are returning, whether they are still on the way, and where they are physically received.
2. **Money fact** — the actual amount returned to the client and the payment method used for that refund.

For both `itemized_v1` and `legacy_manual_total` orders, the manager enters the refund amount explicitly.

## Why

For an itemized order the system knows the historical sold price of a line, but that still does not prove the refund policy for a particular return. A partial return may involve discounts, negotiated compensation, delivery costs, damaged goods, or a zero-money physical return.

Current Catalog price is even less suitable: it is a current recommendation and must never reinterpret an historical sale.

Therefore Stage03 H10 keeps these values separate:

- `order_items.unit_price` = factual historical sold price;
- `order_items.catalog_price_snapshot` = historical Catalog recommendation;
- `returns.amount` = factual refund that actually happened.

## UI behavior

- a new Return draft starts with refund amount **0**, not the full remaining received amount;
- the form still shows how much money is available to refund;
- the manager explicitly enters the real refund amount;
- selecting returned items does not change the refund field;
- zero-money item returns remain valid;
- a money-only return remains valid when amount is greater than zero;
- payment method is required only when money is actually returned.

The form explicitly states that product/Catalog prices are not inserted automatically.

## Server guards

The existing server contract remains authoritative:

- refund may not exceed `received_amount - return_amount`;
- return amount is persisted from explicit input;
- current Catalog price is never read;
- itemized sold price/line total is not used to derive refund money;
- physical return quantity is independently checked against the remaining returnable quantity;
- critical-operation/idempotency and stock/lifecycle rules remain unchanged.

No migration or data backfill is part of H10.

## Non-goals

H10 does not define:
- an automatic “recommended refund”;
- proportional discount allocation;
- delivery-cost allocation;
- automatic refund from historical sold line price;
- a new discount model.

Those would require a separate business-policy decision.

## Acceptance

1. Open an itemized order with received money. Return form must open with refund amount 0 while showing the available maximum.
2. Select one item. Refund amount must remain unchanged.
3. Enter an explicit refund and save. The refund is recorded exactly as entered.
4. Select an item with refund 0. Physical return must remain valid.
5. Attempt a refund above available received funds. Save must fail.
6. Current Catalog price changes must not affect Return money.
7. Legacy orders keep the same manual-money behavior.

After H10, Stage03 can move to discount/analytics interpretation and then the final end-to-end pricing audit.

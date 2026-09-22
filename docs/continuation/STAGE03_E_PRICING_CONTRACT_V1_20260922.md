# Stage03-E — Pricing Contract v1

Date: 2026-09-22
Baseline: branch2 `b5b2744b20076c38f9c92276092060f6751079fe`

Status: **DESIGN CONTRACT ONLY**. No application code, migration or D1 mutation in this step.

This contract turns the Stage03-D audit and the user's proposed order flow into explicit invariants before implementation.

## 1. Four separate financial layers

The system must keep these concepts separate:

### A. Catalog price

Current recommended sale price for the commercial execution.

Current Stage03 base key:
`product + material + length + adult/child`.

The current Catalog price is mutable and is never historical truth for an already-created order.

### B. Final sold line price

The actual unit price accepted for one order item after any manager discount/manual adjustment.

Canonical existing field:
`order_items.unit_price`.

For itemized orders:
`order_items.line_total = quantity * unit_price`.

### C. Payments

Actual money facts.

Canonical existing table:
`payments`.

Each payment independently records:
- date;
- method;
- amount;
- payment kind.

Price changes must never silently rewrite payment rows.

### D. Debt

Debt remains derived from the final commercial order total and actual received money:

`debt = max(order total - received payments, 0)`.

Existing server protection against `received > order total` remains required.

## 2. Explicit pricing mode is mandatory

Historical orders cannot safely be recognized from `unit_price` because old rows commonly contain zero, while zero may also be a legitimate future final price.

Therefore the order must explicitly declare its pricing generation.

Proposed persisted field:

`orders.pricing_mode`

Allowed v1 values:

- `legacy_manual_total`
- `itemized_v1`

### legacy_manual_total

For all historical/pre-rollout orders.

Rules:
- `orders.total_amount` remains authoritative;
- item prices are not used to recalculate the order total;
- today's Catalog price is never applied automatically;
- opening/saving an old order must preserve its historical commercial total;
- no historical item-price backfill is invented.

### itemized_v1

For new orders after itemized pricing is intentionally enabled.

Rules:
- every priced item has an actual `unit_price`;
- `line_total = quantity * unit_price`;
- `orders.total_amount = SUM(active item line_total)`;
- server derives the total and does not trust a separate manual order-level total;
- payments stay independent;
- debt is calculated against the derived order total.

Rollout rule: adding the field alone must not switch any existing or new UI behavior. Until the itemized create flow is explicitly enabled, order creation remains legacy-compatible.

## 3. Preserve Catalog recommendation as a historical snapshot

Only storing final `unit_price` would lose the price that the system originally proposed.

Proposed nullable item field:

`order_items.catalog_price_snapshot`

Meaning:
- whole KZT amount from Catalog at the moment the line commercial price was established;
- immutable historical snapshot for that sold line;
- NULL when there was no applicable Catalog price or for legacy history;
- never refreshed from today's Catalog after the order is created.

For a new itemized line:

- `catalog_price_snapshot` = recommended price at selection time;
- `unit_price` = actual sold price;
- `line_total` = quantity × actual sold price.

Example:

- Catalog recommendation: 40,000;
- manager final price: 36,000;
- quantity: 2;
- snapshot = 40,000;
- unit_price = 36,000;
- line_total = 72,000;
- derived commercial discount relative to snapshot = 8,000 for the line.

No separate persisted discount amount/percent is required in v1. The UI may later provide a discount calculator, but the stored truths remain recommendation snapshot + actual sold price.

## 4. Missing Catalog price

The storage model must support a new item with no Catalog price.

Contract:
- `catalog_price_snapshot = NULL`;
- manager may supply an explicit final `unit_price` only if product policy allows it;
- whether saving without any price is allowed is still a client/product decision.

Do not use zero to mean “price missing”.

## 5. Order total

For `itemized_v1`, there is exactly one commercial formula:

`orders.total_amount = Σ(order_items.quantity × order_items.unit_price)`

The persisted `orders.total_amount` remains important as:
- the order-level historical snapshot;
- the input used by existing Finance reports;
- the basis for debt reconciliation.

But for `itemized_v1` it is a server-derived value, not an independent editable source of truth.

For `legacy_manual_total`, this formula is explicitly **not** imposed.

## 6. Payment integration

Payments do not receive Catalog defaults.

Example:

Final itemized order total: 47,000.

Manager enters:
- НАЛИЧКА: 30,000;
- KASPI PAY: 10,000.

Then:
- received = 40,000;
- debt = 7,000.

If a manager later changes an unsaved line price:
- payment rows remain exactly as entered;
- debt preview updates;
- if payments exceed the new final order total, save remains blocked until payment facts are corrected.

This preserves reliable payment-method reporting.

## 7. Old orders — non-regression contract

The following are forbidden:

- recalculating an old order from current Catalog prices;
- automatically converting historical orders to `itemized_v1`;
- treating historical zero `unit_price` as a real line price;
- filling historical `catalog_price_snapshot` from current Catalog;
- changing historical payments because item pricing is introduced;
- changing historical debt by opening an order in the editor.

A future additive schema migration may safely assign every existing order the explicit default `legacy_manual_total`.

That is classification, not financial backfill.

## 8. Report isolation contract

Existing high-level historical reports continue to use persisted financial facts:

- gross/order sales → `orders.total_amount`;
- received money → payment ledger / `orders.received_amount`;
- payment methods → `payments.method + payments.amount`;
- debt → `orders.debt_amount`;
- refunds → `returns.amount`.

No historical Finance report may join today's `catalog_execution_prices.sale_price` to reinterpret old sales.

For an `itemized_v1` order, server-derived `orders.total_amount` keeps these reports compatible.

### Product revenue

Current product report's `SUM(orders.total_amount)` grouped through `order_items` is not exact item revenue for multi-product orders.

Contract for future corrected product revenue:
- exact itemized revenue may use `order_items.line_total` for `itemized_v1`;
- legacy orders without trustworthy line prices remain unallocated/legacy for exact product revenue;
- never invent a proportional historical allocation unless the client explicitly approves such an analytical estimate.

## 9. Create flow boundary

First implementation target, after schema/backend preparation, should be **new order creation only**.

Planned behavior:
1. manager chooses item identity;
2. system resolves an applicable current Catalog sale price;
3. line receives Catalog snapshot + final unit price;
4. manager may change the final unit price;
5. quantity changes line total;
6. order total is derived from all final line totals;
7. manager manually enters payments;
8. debt preview derives from total minus payments;
9. server independently recalculates and validates all financial totals.

Do not expose item-price editing in existing-order editor in the same implementation wave.

## 10. Existing-order edit boundary

Current edit comparison treats `unitPrice` as part of the item rewrite decision.

A price-only edit can therefore currently trigger inventory/reservation rewrite.

Contract:
- a commercial price correction must never cause stock movement;
- item identity/quantity/source changes and commercial price changes must be distinguishable;
- existing-order price correction requires a dedicated safe path before UI exposure.

Exact implementation (in-place optimistic update vs dedicated correction operation) remains for a later design step.

## 11. Returns boundary

Current return money remains manually entered.

Stage03 itemized order creation does not automatically change return policy.

Later:
- sold line prices may provide a suggested refund amount for `itemized_v1`;
- legacy orders remain manual because exact per-item historic sale value may not exist;
- policy for partial returns/discounts must be decided before automation.

## 12. Exchanges boundary

Current exchange behavior is legacy-total based:
- replacement item is inserted with price 0;
- manager enters one financial difference;
- backend adjusts `orders.total_amount` by that difference.

This is incompatible with making itemized totals universal.

Contract:
- do not switch exchanges to itemized semantics as a side effect of new-order pricing;
- before exchanges can operate on `itemized_v1`, define how old-line value, new-line value, negotiated no-difference exchanges, extra payment and refund interact;
- actual payment/refund remains a separate money fact regardless of price calculation.

## 13. Catalog price dimensions

Confirmed current base pricing dimensions:
- product;
- material;
- length;
- adult/child.

Still unresolved:
- gender;
- color;
- exact size/child age.

The storage contract above does not require those dimensions to be decided, but final automatic Catalog resolution in Production must not pretend they are irrelevant if the client has not answered.

## 14. Proposed additive schema foundation

The next schema-only candidate should be limited to two fields:

`orders.pricing_mode TEXT NOT NULL DEFAULT 'legacy_manual_total'`

with allowed values:
- `legacy_manual_total`
- `itemized_v1`

and:

`order_items.catalog_price_snapshot INTEGER NULL`

with non-negative validation where supported.

No data-copy/backfill from Catalog.

No recalculation of `orders.total_amount`.

No rewrite of `order_items.unit_price`.

No payment/return/exchange mutation.

## 15. Questions intentionally still open

These remain business/product decisions and are not silently decided by this contract:

- whether gender/color/size/age change price;
- whether delivery has its own price;
- whether an item with no Catalog price may be sold with manual price;
- whether zero-price/free items are allowed;
- exact discount UI (final price / amount / percent);
- whether manager must give a reason for override;
- behavior after changing price-driving item characteristics following a manual override;
- return refund defaults;
- exchange price policy;
- explicit discount reporting requirements.

## 16. Next safe engineering step

If this contract is accepted, the next bounded implementation step is **schema/backend compatibility foundation only**:

- additive migration for `pricing_mode` + `catalog_price_snapshot`;
- old orders classified as legacy by default;
- read/write types understand the fields;
- no Create Order UI change;
- no price autofill;
- no report change;
- no return/exchange change;
- no Production D1 mutation without a separate explicit gate.


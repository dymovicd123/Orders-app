# Stage03 H11 — absolute discount semantics and product price analytics

Date: 2026-09-26

Environment: **Branch2 only**. Production/main is not a target.

## Client-confirmed discount rule

Discount is expressed through the **final sold price amount**, not through a discount percentage.

Example:
- Catalog recommendation: 115,000;
- manager sells for: 105,000;
- factual historical sold price: 105,000;
- derived discount amount: 10,000.

The system does not need a separate persisted discount field to represent this rule.

For `itemized_v1`:
- `catalog_price_snapshot` remains the historical Catalog recommendation;
- `unit_price` remains the actual final sold unit price;
- `line_total = quantity × unit_price`;
- a discount amount can be derived as `max(0, catalog_price_snapshot - unit_price)` per unit when a snapshot exists.

No discount percentage is introduced by H11. No mandatory discount reason is introduced because the client has not requested one.

Create, Edit and itemized Exchange keep direct final-price entry and now state explicitly that a discount is entered as the final amount.

## Client-requested product indicator

The existing Products report remains the home for the requested “most sold products” indicator.

Ranking:
- products are ordered by sold quantity descending;
- order count remains visible.

New exact price indicator:
- each product shows **average sold price**;
- average is quantity-weighted, not an average of distinct price points;
- formula: `itemized_gross_sales / itemized_quantity`;
- `itemized_gross_sales` comes from persisted `order_items.line_total`;
- `itemized_quantity` comes from the same `itemized_v1` rows.

Example:
- 1 unit sold for 115,000;
- 3 units sold for 105,000;
- average sold price = (115,000 + 3 × 105,000) / 4 = 107,500.

## Legacy compatibility

Old `legacy_manual_total` orders often do not have trustworthy line prices. They may still contribute to product popularity/quantity because the product and quantity are known.

They must **not** be mixed into the average sold price.

Therefore the report shows price coverage:
- if all sold units have exact itemized prices: average is marked as based on all units;
- if the row mixes itemized and legacy history: average is explicitly based only on the exact-price subset;
- if the row contains only legacy history: average price is shown as unavailable.

The old `order_sales = SUM(o.total_amount)` compatibility field is not used to calculate the average because multi-product orders can duplicate the whole order total across product groups.

## Isolation

H11 must not:
- read current `catalog_execution_prices` to calculate historical averages;
- reinterpret old orders from today's Catalog;
- allocate legacy order total across products;
- change payments, debt, returns or exchange money;
- add a migration or data backfill.

No D1 business-row write is part of H11.

## Acceptance

1. Product report stays ordered by sold quantity.
2. An itemized product with 1 × 115,000 and 3 × 105,000 shows average 107,500.
3. A mixed itemized/legacy product shows the average only from exact itemized units and visibly states coverage.
4. A legacy-only product has no fabricated average price.
5. Current Catalog price changes do not change historical product average price.
6. Create/Edit/Exchange continue to accept direct final sold price amounts, including a lower amount than Catalog recommendation, without a percent field.

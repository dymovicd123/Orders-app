# Stage03-F1 — pricing compatibility schema foundation

Date: 2026-09-22
Baseline: branch2 `63ce9bc1e4f922a256959d2f8667b8d61956fcab`

This is the first implementation step after Pricing Contract v1.

## Scope

Additive schema + type vocabulary only.

Migration candidate:
`migrations/0073_v72_order_item_pricing_foundation.sql`

It adds:

- `orders.pricing_mode TEXT NOT NULL DEFAULT 'legacy_manual_total'`
  with allowed values `legacy_manual_total | itemized_v1`;
- `order_items.catalog_price_snapshot INTEGER NULL`
  with non-negative validation.

## Historical safety

0073 intentionally contains no business-row INSERT/UPDATE/DELETE.

The default on `pricing_mode` classifies existing orders as legacy/manual when the schema is applied. It does **not** recalculate:
- `orders.total_amount`;
- received/debt;
- `order_items.unit_price`;
- `order_items.line_total`;
- payments;
- returns;
- exchanges.

`catalog_price_snapshot` remains NULL for all historical rows. Current Catalog prices are never copied backward into history.

## Runtime boundary

This step does not activate itemized behavior.

- Create Order UI still uses the existing manual order total.
- Normal create still sends item `unitPrice: 0`.
- Pricing mode is not accepted as a create/edit API input yet.
- Catalog snapshot is not written by UI/backend yet.
- Reports are untouched.
- Returns/exchanges are untouched.

Only optional read-side/type vocabulary is prepared for later bounded work.

## D1 boundary

Migration 0073 is committed as a candidate but is **not executed** by this step on Branch2 or Production D1.

Next step after a green cumulative Branch2 build: review F1, then decide whether to add a pre-migration-safe read contract before applying 0073 to Branch2 D1.

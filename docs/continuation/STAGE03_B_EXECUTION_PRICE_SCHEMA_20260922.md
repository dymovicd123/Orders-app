# Stage03-B — execution + audience commercial price schema

Date: 2026-09-22  
Repository: `dymovicd123/Orders-app`  
Baseline: `branch2` `693e0cba25ed3349f9b0e9ac6524055e97693846`

## Safety status

Before this step the Branch2 environment binding was re-verified:

- Worker: `orders-app-branch2`;
- D1: `orders_db_branch2`;
- D1 id: `40065052-854e-44b8-bcd5-251bdd488301`;
- no Production D1 name/id is present in Branch2 `wrangler.jsonc`.

This step **does not execute a D1 migration**. It only adds the additive migration file and documents the contract. No Branch2 or Production database rows are touched by this commit.

## Confirmed pricing key

Current cost and sale price are known to depend on:

`product + material + length + adult/child`

Since migration 0048, `catalog_stock_positions` is the canonical execution identity:

`product + material + length`

and `catalog_variants.category` distinguishes `adult` / `child`.

Therefore the base commercial key is:

`stock_position_id + category`

## Schema

Migration file:

`migrations/0072_v72_catalog_execution_prices.sql`

New table:

`catalog_execution_prices`

Columns:

- `stock_position_id` — FK to canonical execution;
- `category` — `adult | child`;
- `cost_price` — nullable non-negative whole KZT;
- `sale_price` — nullable non-negative whole KZT;
- `created_at`;
- `updated_at`.

Composite primary key:

`(stock_position_id, category)`

This prevents duplicate base-price rows for the same execution and audience category.

## Why not catalog_products

A product can have different material/length executions, and those prices are confirmed to differ. Product-level fields would therefore lose required information.

## Why not catalog_variants

Gender, color and size/age are still unresolved pricing dimensions. Writing the same base price into every exact SKU would duplicate data and prematurely assert that exact-SKU pricing is the canonical model.

## Why not catalog_stock_positions columns

One execution can contain both adult and child combinations after the catalog identity v3 redesign. Adult/child is confirmed to affect price, so one pair of price columns on the execution itself is insufficient.

## Unresolved dimensions

Still awaiting client confirmation:

- gender;
- color;
- exact size / child age.

Stage03-B does not decide their effect and does not create an override precedence rule.

If later confirmed, a more-specific override model can be added above this base price without rewriting the base table.

## Historical invariants

- `order_items.unit_price` remains the actual historical transaction sale price.
- Current catalog sale price never rewrites old orders.
- No catalog-price backfill is derived from historical orders.
- Current `cost_price` is not historical sale cost.
- Stage04 must define historical Workshop invoice/batch cost before Stage05 profitability relies on cost history.

## D1 characteristics

The table is intentionally small and normalized:

- at most one base-price row per execution + adult/child;
- no per-color/per-size duplication;
- no background reads;
- no N+1 requirement.

When API work is added, price rows should be fetched in one batched Catalog read, not one query per SKU.

## Next micro-step

Stage03-B2: add **read-only runtime contract** for these price rows to the existing Catalog load.

Still do not:

- execute migration 0072 on any D1;
- add price-edit UI;
- default order prices;
- modify historical orders;
- create historical cost snapshots.

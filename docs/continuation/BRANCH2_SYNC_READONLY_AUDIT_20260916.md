# Branch2 sync read-only audit — 2026-09-16

Source workflow: GitHub Actions `Branch2 sync read-only audit`, successful evidence run `35113616022`.

The workflow used only Cloudflare `d1 list`, SQL `SELECT`, and `PRAGMA`. Every D1 query reported `rows_written=0`; no Branch2 D1 mutation was performed.

## Live identity

- D1 logical name: `orders_db_branch2`
- live D1 ID: `40065052-854e-44b8-bcd5-251bdd488301`
- created at: `2026-08-06T15:39:12.391Z`
- repository Branch2 Worker name: `orders-app-branch2`
- repository Branch2 DB name: `orders_db_branch2`
- repository Branch2 DB ID: `40065052-854e-44b8-bcd5-251bdd488301`

Therefore the historical Branch2 UUID currently configured in `branch2` is still the real live Branch2 database.

## Required base tables found

- `catalog_input_aliases`
- `catalog_products`
- `catalog_value_aliases`
- `catalog_variants`
- `d1_migrations`
- `exchange_items`
- `inventory_reservations`
- `inventory_stock`
- `order_items`
- `orders`
- `return_items`
- `workshop_tasks`

## Catalog product schema

Current `catalog_products` columns:

`id, name, category, is_active, created_at, updated_at, external_id`

`gender_scope` is absent. This proves migration 0068's new product-level gender-scope schema is not present.

## Return / exchange physical tracking

Current `return_items` and `exchange_items` do not contain the 0069 columns:

- `physical_tracking`
- `physical_received_at`

So 0069 has not been applied.

## Migration journal

`d1_migrations` contains 47 rows and ends at:

`0044_v72_operation_integrity.sql`

The Branch2 runtime/schema nevertheless contains post-0044-era functionality. Therefore the migration journal cannot safely be used as a blanket replay instruction. Do **not** run a normal remote `wrangler d1 migrations apply` merely because 0045+ are absent from the journal.

## Audited post-0064 indexes

The read-only query for these indexes returned no rows:

- `idx_catalog_variants_product_active_desc_sort` (0065)
- `idx_payments_payment_date_order_amount` (0066)
- `idx_orders_current_debt_partial` (0066)
- `idx_order_items_pending_writeoff_status_order` (0066)
- `idx_order_items_workshop_order_quantity` (0066)
- `idx_o1_exchanges_payment_finance` (0067)
- `idx_o1_stock_checks_normalized_time` (0067)
- `idx_o1_stock_checks_exact_stocktake` (0067)
- `idx_return_items_physical_receipt` (0069)
- `idx_exchange_items_physical_receipt` (0069)

Thus these audited 0065–0067/0069 index effects are absent.

## 0068 support tables

The following tables are absent:

- `catalog_gender_scope_repairs`
- `catalog_gender_variant_repairs`
- `catalog_gender_stock_baseline`

Combined with the missing `catalog_products.gender_scope`, this confirms 0068 has not been applied.

## Non-sensitive catalog size

At audit time:

- products: 50
- variants: 613

## Consequence for sync

Before moving Branch2 to current main, perform a schema-effect audit for migrations 0045–0064 against actual `sqlite_master`/PRAGMA state. Apply only genuinely missing effects. 0065–0067 are additive index migrations. 0069 is additive schema/index work. 0068 is a data-changing catalog migration and requires a Branch2 backup plus SELECT-only preflight of every proposed product scope assignment, variant remap/merge, stock effect, and canonical-reference update before it may be applied.

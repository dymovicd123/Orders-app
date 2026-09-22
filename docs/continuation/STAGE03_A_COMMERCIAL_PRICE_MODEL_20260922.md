# Stage03-A — Commercial price model

Date: 2026-09-22  
Repository: `dymovicd123/Orders-app`  
Baseline: `branch2` `0793274cc1f8e118f4d73e187eeb2a48e5cd1bb2`

## Scope

This step fixes only the data semantics for the client's two product prices:

- `Себестоимость`;
- `Цена продажи`.

It intentionally makes **no** migration, API, UI, order-write or Production D1 change.

## Existing facts

The current catalog has three stable identity levels:

1. product — `catalog_products`;
2. execution — product + material + length;
3. exact SKU — execution + audience/type + gender + color + size, represented by `catalog_variants.id`.

The current client wording is per **товар**. No business rule has been supplied saying that cost or sale price differs by execution, color, size, gender or exact SKU.

Historical order sale price already exists independently of catalog identity as:

- `order_items.unit_price`;
- `order_items.line_total`.

W7 already established the invariant that later catalog-price changes must not rewrite old `order_items.unit_price`.

## Decision

### 1. Current editable prices live on the product

Later Stage03 schema should add two current commercial fields to `catalog_products`:

- `cost_price` — current manually maintained себестоимость;
- `sale_price` — current manually maintained цена продажи.

Both are product-level values.

Do **not** add the same fields to `catalog_variants` or execution identity now. Doing so would invent pricing inheritance/override rules that the client has not requested.

If the client later says that a specific material/length/color/size has a different price, that becomes a separate explicit override design instead of silently changing today's semantics.

### 2. Money representation

Match the existing project convention:

- SQLite/D1 `INTEGER`;
- value is whole KZT, like current order/payment amounts;
- non-negative;
- `NULL` means “price not set yet”.

Do not use `0` as the default for “unknown”; zero must remain distinguishable from missing data.

### 3. Sale history uses the existing transaction snapshot

`order_items.unit_price` remains the historical sale transaction price.

Changing `catalog_products.sale_price` tomorrow must never update old order rows.

Stage03 may later use the current product `sale_price` as a default when creating/editing an order line, but that behavior is **not** part of Stage03-A and must be designed separately so manual order pricing/discount behavior is not broken.

A new `sale_price_snapshot` column is therefore not justified at this point: it would duplicate `unit_price` unless the client later asks to preserve “catalog list price at sale time” separately from the actual transaction price.

### 4. Current cost is not yet historical sale cost

`catalog_products.cost_price` is the current manual reference cost requested by the client.

It must **not** automatically be treated as the final historical cost of every past sale.

The planned Stage04 Workshop financial invoice/intake model can establish actual historical cost for a concrete received batch. Until that source/allocation rule exists, adding `cost_price_snapshot` to order items would create false precision.

Therefore Stage05 profitability must consume the historical cost model defined by Stage04, not retroactively apply today's mutable product cost to old sales.

### 5. No speculative pricing engine

Stage03-A explicitly does not invent:

- automatic price changes;
- product → execution → SKU inheritance;
- per-SKU overrides;
- effective-date pricing;
- discount rules;
- margin-based auto-pricing;
- automatic recalculation of old orders.

The only agreed behavior is manual current product cost + manual current product sale price.

## D1 / Cloudflare implication

This model is cheap:

- `listCatalog` already performs one product SELECT, so the two current fields can later be returned in that existing read;
- catalog product create/update already use admin-only POST/PATCH routes, so later writes can extend the existing path;
- ordinary SKU browsing needs no extra query;
- no polling/background price read is required.

## Next micro-step

**Stage03-B — schema/API foundation only.**

Expected scope:

- one additive migration for nullable product `cost_price` / `sale_price`;
- catalog product read contract;
- admin create/update validation and persistence;
- focused regression tests.

Explicitly still out of scope for Stage03-B:

- Catalog UI;
- automatic order price defaulting;
- changing existing order rows;
- historical cost allocation;
- Workshop invoice/debt logic;
- profitability analytics.

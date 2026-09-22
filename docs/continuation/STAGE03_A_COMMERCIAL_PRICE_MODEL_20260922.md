# Stage03-A — Commercial price model

Date: 2026-09-22  
Repository: `dymovicd123/Orders-app`  
Baseline before correction: `branch2` `be8371b440dd249cbb0c9118913e96cf24efa7db`

## Scope

This step fixes only the known pricing dimensions for the client's two current prices:

- `Себестоимость`;
- `Цена продажи`.

It intentionally makes **no** migration, API, UI, order-write or Production D1 change.

## Existing catalog identity

The current catalog has:

1. product — `catalog_products`;
2. execution — `product + material + length`, represented by `catalog_stock_positions`;
3. exact SKU — execution + audience/type + gender + color + size/age, represented by `catalog_variants.id`.

Historical order sale price already exists separately from catalog identity as:

- `order_items.unit_price`;
- `order_items.line_total`.

W7 already established the invariant that later catalog-price changes must not rewrite old `order_items.unit_price`.

## Confirmed pricing dimensions

The current price is **not** merely product-level.

Confirmed:

- material affects price;
- length affects price;
- adult vs child affects price.

Therefore the minimum known current-price key is:

`product + material + length + audience category (adult/child)`

In the current identity model this means:

`catalog_stock_positions.id + catalog_variants.category`

The price cannot live only on `catalog_products`, and it also cannot live only on `catalog_stock_positions`, because one execution can have both adult and child variants with different prices.

## Still unresolved

There is no confirmed answer yet on whether price also changes by:

- gender;
- color;
- exact size / child age.

Do not assume either direction.

Until the client answers, Stage03 must not bake in the claim that those dimensions definitely affect price or definitely never affect price.

## Recommended schema direction

Do **not** put the two prices directly on `catalog_products`.

Do **not** duplicate the same current price across every `catalog_variants` row either.

The clean base model is a separate commercial-price record for the confirmed scope:

- execution / `stock_position_id`;
- audience category `adult | child`;
- current `cost_price`;
- current `sale_price`.

That gives one current price per product+material+length+adult/child combination without duplicating it for every gender/color/size.

If the client later confirms that gender/color/size/age can change the price, add an explicit more-specific override layer after that rule is known. Do not invent the override precedence now.

## Money representation

Match the existing project convention:

- SQLite/D1 `INTEGER`;
- whole KZT;
- non-negative;
- `NULL` means “not set yet”.

Do not use `0` as a substitute for unknown.

## Historical sale price

`order_items.unit_price` remains the historical actual transaction price.

Changing the current catalog sale price later must never rewrite old order rows.

A separate `sale_price_snapshot` is not justified yet unless the client later asks to preserve both:

- catalog/list price at the moment of sale;
- actual transaction price after a manual change/discount.

## Historical cost

The current `cost_price` is not automatically the final historical cost of every past sale.

Stage04 Workshop invoice/intake work must define the historical cost source/allocation for the received goods. Until that rule exists, Stage05 profitability must not retroactively price old sales using today's mutable current cost.

## No speculative pricing engine

Stage03-A does not invent:

- gender/color/size/age price effects;
- automatic price changes;
- override precedence;
- effective-date pricing;
- margin-based auto-pricing;
- automatic rewriting of old orders.

## D1 / Cloudflare implication

The confirmed scope suggests a small separate commercial-price table keyed by execution + audience category.

Reads can be batched with the existing Catalog load rather than queried once per SKU. Do not introduce N+1 price reads.

## Next micro-step

Do **not** start the old Stage03-B design that added prices to `catalog_products`.

Before schema work, Stage03-B should now be a narrow schema-contract design for:

`execution + adult/child -> cost_price + sale_price`

while keeping gender/color/size/age price behavior explicitly unresolved and extensible.

# Stage03-G2 — price-only order edit isolation

Date: 2026-09-22
Green Branch2 baseline: `ef43358c71bc2fe688364b794b88cc69048a7586`
Cloudflare monitor: `35756878923` — success

## Purpose

Separate commercial correction of an existing order line price from a physical/content rewrite of the order item.

Before G2, `unitPrice` participated in the same equality test as product identity, source, quantity and Workshop details. A price-only edit could therefore enter the full item-rewrite path, release or reverse stock obligations, retire the active `order_items` rows and create new rows/reservations.

That coupling was unsafe: price is a commercial fact, not a physical stock identity.

## Implemented rule

Order edit now distinguishes three facts:

- `itemContentChanged` — any item-level change, including price; retained for lifecycle/business safety guards;
- `rewriteItems` — product/source/variant characteristics, quantity or Workshop-detail change that genuinely requires a full item rewrite;
- `priceOnlyItemsEdit` — the normalized item content is unchanged and only `unitPrice` differs.

For a pure price-only edit:

- existing active `order_items.id` rows are preserved;
- `unit_price` and `line_total` are updated in place;
- the order header money totals and line-price updates commit in the same D1 batch;
- `catalog_price_snapshot` is not modified;
- stock write-off reversal / reservation release is not called;
- old items are not retired;
- new order items are not inserted;
- reservations are not recreated;
- Workshop tasks are not cancelled/recreated.

## Safety policy deliberately unchanged

G2 is an implementation isolation fix, not a new business-policy decision.

The existing guards still treat price correction as an item edit for:

- already fully sent orders;
- orders with a fulfilled early/partial handover;
- orders with active completed returns or exchanges.

Therefore G2 does not silently grant broader correction rights. Those policy decisions remain separate client/business work.

Legacy `legacy_manual_total` semantics are also unchanged. G2 does not activate itemized pricing, Catalog autofill, discount UI, automatic total derivation for legacy orders, Return pricing or Exchange pricing.

## Regression protection

Focused gate:

`scripts/test-stage03-g2-price-only-edit-isolation.mjs`

The gate protects:

- price exclusion from physical/content identity;
- continued full detection of price changes;
- in-place `unit_price + line_total` update;
- preservation of Catalog snapshot;
- atomic order-money + line-price write;
- absence of stock/re-reservation rewrite for price-only edits;
- continued sent/handover/return/exchange policy guards.

G2 also changes Worker source files already covered by the historical Step 190.6A exact structural regression. A dedicated newest-layer manifest was added:

`scripts/stage03-g2-price-only-edit-worker-manifest.json`

The first Branch2 deploy of the runtime change (`4ad7886e782a57aa4b3db42d892a0eb33ff18b65`, monitor `35756301567`) correctly failed because the old Stage03-F2 exact manifest did not yet know about the newer G2 layer. Runtime-focused G2 checks had passed before that structural failure.

The structural test was then repaired so G2 is normalized first, after which the older Stage03-F2 and legacy layers verify their own predecessors unchanged. Final Branch2 monitor `35756878923` succeeded on `ef43358c71bc2fe688364b794b88cc69048a7586`.

## Environment / data impact

- Branch2 Worker only.
- Branch2 D1 binding remained `orders_db_branch2` / `40065052-854e-44b8-bcd5-251bdd488301`.
- No migration.
- No D1 data backfill or direct data mutation as part of the release.
- Production was not changed.
- No Catalog price autofill or itemized-order activation.

## Next bounded technical step

Prepare a pure backend `itemized_v1` calculator/validator contract without connecting it to Create/Edit UI:

- final order total = sum of quantity × actual sold unit price;
- actual payments remain independent money facts;
- debt = final order total minus received payments;
- overpayment remains an explicit validation error;
- current Catalog price is input/default context only and never historical truth.

Do not activate Catalog autofill or switch real orders to `itemized_v1` until unresolved client pricing rules are answered.

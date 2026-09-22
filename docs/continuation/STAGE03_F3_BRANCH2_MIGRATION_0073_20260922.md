# Stage03-F3 — Branch2 migration 0073 applied and verified

Date: 2026-09-22
Source commit: `5721d1d0151910f2c24bf17d94a44e5b5eeb807d`

## Environment

The migration workflow hard-stopped unless all three Branch2 identities matched exactly:

- Worker: `orders-app-branch2`
- D1 logical name: `orders_db_branch2`
- D1 id: `40065052-854e-44b8-bcd5-251bdd488301`

Production database markers were explicitly forbidden.

GitHub Actions migration run:
`35744456098` — **success**.

Cloudflare deploy monitor for the same source commit:
`35744455130` — **success**.

## Actual D1 mutation

Migration `0073_v72_order_item_pricing_foundation.sql` was executed on the remote Branch2 D1 only.

It added:

- `orders.pricing_mode TEXT NOT NULL DEFAULT 'legacy_manual_total'`
  constrained to `legacy_manual_total | itemized_v1`;
- `order_items.catalog_price_snapshot INTEGER NULL`
  constrained to NULL or a non-negative integer.

Production D1 was not touched.

## Historical safety verification

Before migration, the workflow captured one aggregate financial fingerprint covering:

- order count;
- order total / received / debt / return aggregates;
- order-item count / quantity / unit-price sum / line-total sum;
- payment count / payment amount;
- active return count / amount;
- active exchange count.

The exact same fingerprint was queried after migration and matched byte-for-byte after normalized JSON sorting.

Additional post-migration checks:

- existing orders: 13;
- `legacy_manual_total`: 13;
- `itemized_v1`: 0;
- invalid/null pricing modes: 0;
- existing order items: 18;
- non-null `catalog_price_snapshot` rows: 0.

Therefore the migration classified existing orders as legacy without recalculating historical commercial or payment facts and without backfilling current Catalog prices into order history.

## Runtime boundary after F3

Stage03-F2 read compatibility can now read the persisted metadata on Branch2.

Still deliberately inactive:

- item-price autofill;
- itemized Create Order behavior;
- writing Catalog snapshots;
- manager discount UI;
- existing-order price correction;
- report repricing;
- return-price automation;
- exchange itemized pricing.

This is the intended stop point after the Branch2-only schema application.

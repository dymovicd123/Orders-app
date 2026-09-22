# Stage03-F2 — pre-migration-safe pricing metadata reads

Date: 2026-09-22
Green code baseline: branch2 `c089ce43bc4ce079eaffb88af717cea3d601d80c`
Cloudflare monitor: `35742609404` — success

## Purpose

Migration 0073 is intentionally still unapplied. Therefore pricing metadata reads must work both before and after that additive schema exists.

## Read contract

A narrow shared schema probe checks for both 0073 columns:

- `orders.pricing_mode`;
- `order_items.catalog_price_snapshot`.

Before 0073:
- ordinary order reads expose `pricing_mode = legacy_manual_total`;
- item `catalogPriceSnapshot` is exposed as `null`;
- no order query directly selects a missing 0073 column.

After 0073:
- list/get-order reads persisted `pricing_mode`;
- existing batched `order_items.*` relation reads naturally include `catalog_price_snapshot`;
- API output normalizes the mode to `legacy_manual_total | itemized_v1`;
- item snapshot is nullable/non-negative on projection.

Retained historical order summaries are always explicitly `legacy_manual_total`.

## Deliberate non-scope

Stage03-F2 does not:
- accept pricing mode through Create/Edit input;
- write `pricing_mode`;
- write `catalog_price_snapshot`;
- copy current Catalog price into order history;
- enable item price autofill;
- change current manual order-total behavior;
- change Finance reports;
- change Returns or Exchanges.

## Regression note

The first F2 code run reached the new focused test but failed because its whole-file string guard mistook the read expression
`catalog_price_snapshot == null`
for a SQL assignment.

That guard was narrowed to detect actual SQL write shapes instead of the JavaScript equality expression.

The following run then reached an older R5.9 cursor regression whose assertion required the exact historic TypeScript generic
`.all<OrderListRow>()`.
F2 only widened that compile-time type to include optional pricing metadata; SQL cursor/OFFSET behavior was unchanged. R5.9 was made type-shape-agnostic while retaining the exact bind/cursor semantics check.

Final cumulative run `35742609404` passed release checks, TypeScript, Vite build, bundle budget and Wrangler dry-run against `orders_db_branch2`.

## D1 boundary

Migration 0073 remains **unapplied** to Branch2 and Production D1 at this checkpoint.

The next safe boundary is a separately guarded Branch2-only application/verification of 0073. Production remains untouched.

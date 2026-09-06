# W6.3 — Catalog polish / acceptance

Date: 2026-09-06
Base Production/main: `9c6bdb3ecd650d70030f714844712f417a080dd4` (W6.2)

## Goal

Keep the accepted W6.2 master/detail model, but remove the remaining database-shaped presentation from high-variant products.

Human browse hierarchy becomes:

`Товар → Исполнение → Цвет → Размер/возраст`

Exact `variant_id` remains authoritative and every size tile still edits exactly one variant.

## UX changes

- Equal colors are grouped instead of repeated once per SKU.
- Gender and adult/child are subgroups only when they carry real meaning.
- Size/age is the primary scannable element; physical quantity is secondary but clearly visible.
- Positive stock is easier to find; zero-stock variants remain visible but quieter.
- Repeated per-SKU «Править» buttons are removed: the exact size tile is the edit action.
- Execution summaries become human (colors + size/age range) instead of only «57 вариантов».
- Detail results now respect Adult/Child and characteristic search. If the product name itself matches the query, its full filtered assortment remains visible.
- The editor keeps the originally selected product even if the user changes search/filter and temporarily hides it.
- Result counts use correct Russian pluralization. Global totals are explicitly labelled «Всего», while «без вариантов» remains visibly actionable.
- «+ Новый товар» moves into the working search/filter toolbar and becomes easier to discover.

## Future pricing readiness

No price schema is introduced in W6.3. The UI is deliberately prepared for a later commercial layer without another catalogue redesign:

- product header has `catalog-product-commercial-anchor`;
- execution header has `catalog-execution-commercial-anchor` and a stable execution key (material + length);
- every exact size tile has `catalog-variant-commercial-anchor` and its exact `data-variant-id`.

This permits future prices at product, execution, or exact-variant level. A base product price can live in the product header; execution-specific prices can sit beside execution stock; a rare exact-variant override can live inside the size tile. The physical catalogue hierarchy and SKU identity do not need to change.

Important: W6.3 does not assume which level will become authoritative for price. That business rule must be designed separately when pricing is implemented.

## Safety

- no migration;
- no Production D1 read/write;
- no price data or pricing semantics introduced;
- no product/variant identity rewrite;
- no stock/reserve math change;
- existing Catalog save paths reused;
- STANDARD remains valid stored data;
- Arrival remains frozen;
- Branch2 untouched.

## Acceptance targets

Validate especially on:
- a 50+ variant product;
- one-variant product;
- no-variant product;
- mixed adult/child;
- multiple material/length executions;
- search by color/material/size;
- desktop ~1690×900 and 1366×768;
- mobile 390–430 px.

## Modularization note

The color/size presentation is isolated in `catalogPolishExecutionGroups.tsx`, keeping the main Catalog controller/view below the existing 190.6B renderer-size boundary. The helper owns no React hooks and receives the exact variant/edit callbacks explicitly.

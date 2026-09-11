# Catalog gender scope cleanup — 2026-09-11

Purpose: eliminate blank-gender catalog duplicates that split stock/returns while keeping historical order text intact.

## Product rule
- Product has a `gender_scope`: `female`, `male`, or `unisex`.
- Fixed-scope products auto-fill a default gender in transaction forms, but the concrete SKU/order-line gender remains editable.
- Unisex products require a human choice of concrete gender when the SKU/order line needs one.

## Migration 0068
- Adds `catalog_products.gender_scope`.
- Applies the approved model-level gender scope list, including `ЕҢЛІК/ЕНЛІК ШАПАН` as female.
- For fixed-scope products, blank-gender active variants are mapped to the correct concrete gender.
- If an equivalent gendered variant already exists, current canonical references and current stock are merged into one keeper variant.
- Stock merge is based on a captured baseline and is auditable through repair tables.
- Unused blank-gender placeholders on unisex products are retired only when they have no stock or operational/history footprint.

## Historical safety
- Migration may repoint `order_items.variant_id` to the canonical current variant, but it does not rewrite order-item text snapshots, quantity, price, totals, or order identity.
- Order list/detail/debt read paths are snapshot-first so later catalog normalization does not rewrite what the operator originally recorded.
- Catalog joins remain LEFT JOIN enrichment; a retired/missing catalog row cannot make an order line disappear.

## Tests / gates
- `scripts/test-catalog-gender-scope-r1.mjs`
- `scripts/test-catalog-order-history-preservation-r1.mjs`
- Both are included in `npm run release:check`.
- Step 1906A/1906B exact-delta gates are extended rather than weakened.

## Deployment caution
This change includes D1 migration 0068. Do not blanket-apply all remote migrations. Production migration state must be checked and 0068 applied deliberately as part of the release procedure.

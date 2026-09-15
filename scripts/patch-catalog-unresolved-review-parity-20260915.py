from pathlib import Path

review_path = Path('worker/domains/catalog-review.ts')
review = review_path.read_text(encoding='utf-8')
old = "    AND (${oi}.product_id IS NULL OR ${oi}.variant_id IS NULL)"
new = "    AND (${oi}.product_id IS NULL OR ${oi}.variant_id IS NULL OR COALESCE(${oi}.stock_writeoff_status, '') = 'catalog_unresolved')"
if review.count(old) != 1:
    raise SystemExit(f'Expected exactly one catalog-review identity predicate anchor, got {review.count(old)}')
review = review.replace(old, new, 1)
review_path.write_text(review, encoding='utf-8')

test_path = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
test = test_path.read_text(encoding='utf-8')
anchor = "  check(review.includes('fetchCatalogReviewRows(db, 160, orderId)'), 'Auto-reconciliation must stay scoped to one order')\n"
addition = anchor + "  check(review.includes(\"COALESCE(${oi}.stock_writeoff_status, '') = 'catalog_unresolved'\"), 'Rows left catalog_unresolved after order edits must remain visible to order-scoped reconciliation even when product/variant ids are already present')\n"
if test.count(anchor) != 1:
    raise SystemExit(f'Expected exactly one regression anchor, got {test.count(anchor)}')
test = test.replace(anchor, addition, 1)
test_path.write_text(test, encoding='utf-8')

print('catalog unresolved review parity patch applied')

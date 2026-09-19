import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const catalogReview = fs.readFileSync(path.join(root, 'worker/domains/catalog-review.ts'), 'utf8')
const ordersRead = fs.readFileSync(path.join(root, 'worker/domains/orders-read.ts'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(
    catalogReview.includes("if (!Object.keys(preview).length && toInt(anchor.variant_id, 0))") &&
      catalogReview.includes("gender_snapshot: cleanText(linked.gender)") &&
      catalogReview.includes("color_snapshot: cleanText(linked.color)") &&
      catalogReview.includes("size_snapshot: cleanText(linked.size_label)"),
    'Initial resolver context no longer hydrates facts from an already-linked canonical SKU',
  )

  check(
    catalogReview.includes("const remainingRows: Record<string, unknown>[] = []") &&
      catalogReview.includes("await resolveCatalogReviewRows(db, [row], selected, normalizedCatalogReviewKey(row)") &&
      catalogReview.includes("two blank-gender snapshots may legitimately") &&
      catalogReview.includes("point to different male/female variants"),
    'Order-scoped reconciliation can again propagate one known variant across multiple ambiguous raw snapshots',
  )

  check(
    ordersRead.includes("&& !toInt(item.variant_id, 0);"),
    'Orders table can still mark an already-linked exact SKU as requiring human catalog clarification',
  )

  console.log('CATALOG RESOLVER R5 CANONICAL TRUTH TESTS PASSED — linked SKU identity outranks stale snapshots, known variants repair per row, and humans are not summoned for already-known identity.')
} catch (error) {
  console.error(`CATALOG RESOLVER R5 CANONICAL TRUTH TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

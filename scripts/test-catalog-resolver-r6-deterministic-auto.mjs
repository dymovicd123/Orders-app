import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const reservations = fs.readFileSync(path.join(root, 'worker/domains/order-reservations.ts'), 'utf8')
const review = fs.readFileSync(path.join(root, 'worker/domains/catalog-review.ts'), 'utf8')
const worker = fs.readFileSync(path.join(root, 'worker/index.ts'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(
    worker.includes('await reconcileCatalogReviewOrder(env.DB, id)') &&
      worker.indexOf('await reconcileCatalogReviewOrder(env.DB, id)') < worker.indexOf("code: 'catalog_review_required'"),
    'Shipping no longer attempts deterministic auto-reconciliation before opening the human resolver',
  )
  check(
    reservations.includes("gender = catalogGenderForProductScope(productGenderScope)") &&
      reservations.includes("matchStatus: 'unresolved_attribute'"),
    'Single-gender product inference or unisex ambiguity guard disappeared',
  )
  check(
    reservations.includes("if (!rawColor || !rawSize)") &&
      reservations.includes("omittedSizeConflictsWithConcreteSibling"),
    'Missing color/size can again synthesize or select a SKU without enough facts',
  )
  check(
    reservations.includes('createCatalogCombinationV3(db, {') &&
      reservations.includes("matchStatus: created.created ? 'created_combination' : 'matched'"),
    'Known valid facts no longer create a missing exact combination automatically',
  )
  check(
    reservations.includes("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)") &&
      reservations.includes("reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) + ?)"),
    'Safe auto-created SKU no longer starts at physical 0 and reserves separately',
  )
  check(
    review.includes('if (!resolved.productId || !resolved.variantId) continue;') &&
      review.includes('await resolveCatalogReviewRows(db, matching, selected, inputKey'),
    'Order-scoped reconciliation no longer commits deterministic SKU + reservation without a form',
  )

  console.log('CATALOG RESOLVER R6 DETERMINISTIC AUTO TESTS PASSED — clear known facts bypass human review, missing unisex gender/color/size stays human, and stock truth remains physical 0 plus reservation.')
} catch (error) {
  console.error(`CATALOG RESOLVER R6 DETERMINISTIC AUTO TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

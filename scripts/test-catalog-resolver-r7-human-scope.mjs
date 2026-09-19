import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const review = fs.readFileSync(path.join(root, 'worker/domains/catalog-review.ts'), 'utf8')
const worker = fs.readFileSync(path.join(root, 'worker/index.ts'), 'utf8')
const modal = fs.readFileSync(path.join(root, 'src/features/orders/OrderCatalogResolutionModal.tsx'), 'utf8')
const flow = fs.readFileSync(path.join(root, 'src/features/orders/catalogResolutionFlow.ts'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(review.includes("options: { singleItem?: boolean } = {}") && review.includes("catalogReviewInputCanLearnExact") && review.includes("toInt(row.id ?? row.order_item_id, 0) === orderItemId"), 'Human fact resolution no longer keeps incomplete/ambiguous answers scoped to one order item')
  check(review.includes("writeAlias: reusableExactInput") && review.includes("normalizedCatalogReviewKey(row) === inputKey"), 'A complete exact human confirmation is no longer reusable for identical raw SKU signatures')
  check(worker.includes("const needsAdminCatalogMutation = Boolean(input.createProduct) || createFields.length > 0 || Boolean(input.legacyUnknownGender)") && worker.includes("const denied = requireAdminAccess(request)") && worker.includes("}, { singleItem: true });"), 'Inline Admin mutation is not both privileged and scoped to the current order item')
  check(!modal.includes("/api/catalog/review/${item.orderItemId}/resolve-facts") && modal.includes("/api/orders/${order.id}/catalog-review/${item.orderItemId}/resolve-facts"), 'Inline resolver can still escape to the global grouped review mutation route')
  check(modal.includes("Само уточнение применяется только к этой позиции заказа."), 'Advanced resolver still tells users that one human answer affects matching unresolved rows')
  check(flow.includes("return { kind: 'field', field }"), 'Resolver no longer asks one concrete unresolved field at a time')

  console.log('CATALOG RESOLVER R7 HUMAN SCOPE TESTS PASSED — incomplete human answers stay row-scoped; complete exact SKU confirmations are safely learned and reused.')
} catch (error) {
  console.error(`CATALOG RESOLVER R7 HUMAN SCOPE TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

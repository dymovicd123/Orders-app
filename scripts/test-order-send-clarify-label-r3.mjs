import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const ordersRead = read('worker/domains/orders-read.ts')
  const projection = read('src/app/orderOperationalProjection.ts')
  const table = read('src/features/sections/OrdersTableSection.tsx')
  const types = read('src/app/types.ts')

  check(types.includes('catalog_review_required?: boolean'), 'Order API type lost the catalog-review flag')
  check(
    ordersRead.includes('catalog_review_required:') &&
      ordersRead.includes("status === 'catalog_unresolved'") &&
      ordersRead.includes("'legacy_unknown_gender'"),
    'Orders read model no longer derives the known human catalog-clarification state safely',
  )
  check(
    projection.includes('needsCatalogClarification: mutableWorkingOrder && !sent && Boolean(order.catalog_review_required)'),
    'Operational projection no longer carries the clarification state',
  )
  check(
    table.includes("{projection.needsCatalogClarification ? 'Уточнить товар' : 'Отправить клиенту'}"),
    'Orders table no longer replaces the shipping label when clarification is already known',
  )
  check(
    table.includes('void markOrderSentToClient(order)'),
    'Clarification button no longer reuses the guarded shipping/resolver flow',
  )

  console.log('ORDER SEND CLARIFY LABEL R3 TESTS PASSED — known catalog-review orders show «Уточнить товар» while preserving the guarded shipping flow.')
} catch (error) {
  console.error(`ORDER SEND CLARIFY LABEL R3 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

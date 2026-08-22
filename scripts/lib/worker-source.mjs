import fs from 'node:fs'
import path from 'node:path'

const WORKER_SOURCE_ORDER = [
  'core/types.ts', 'core/http.ts', 'core/text.ts', 'domains/auth.ts', 'domains/critical.ts',
'domains/catalog.ts', 'domains/money.ts', 'domains/activity.ts', 'domains/cash.ts',
  'domains/finance-reports.ts', 'domains/order-core.ts', 'core/settings.ts', 'domains/storage.ts', 'core/sql.ts',
  'domains/references.ts', 'domains/orders-relations.ts', 'domains/clients.ts', 'domains/workshop-schema.ts',
  'domains/inventory-reservations.ts', 'domains/inventory-primitives.ts', 'domains/inventory-stocktake.ts',
  'domains/inventory-read.ts', 'domains/inventory-movement.ts', 'domains/orders-read.ts', 'domains/order-reservations.ts',
  'domains/catalog-review.ts', 'domains/orders-write.ts', 'domains/lifecycle.ts', 'domains/returns-exchanges.ts',
  'domains/workshop-matching.ts', 'domains/workshop.ts', 'domains/team.ts', 'index.ts',
]

export function workerSourceFiles(root = process.cwd()) {
  return WORKER_SOURCE_ORDER.map((relative) => path.join(root, 'worker', relative)).filter((file) => fs.existsSync(file))
}

export function readWorkerSource(root = process.cwd()) {
  return workerSourceFiles(root).map((file) => fs.readFileSync(file, 'utf8')).join('\n\n')
}

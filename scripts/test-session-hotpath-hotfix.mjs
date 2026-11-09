import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const worker = read('worker/index.ts')
  const ordersRead = read('worker/domains/orders-read.ts')
  const ordersWrite = read('worker/domains/orders-write.ts')
  const app = read('src/App.tsx')

  check(!worker.includes("ensureOrderItemWorkshopColumn(env.DB)"), 'Global API hot path still waits for workshop schema initialization')
  check(!worker.includes("import { ensureOrderItemWorkshopColumn } from './domains/workshop-schema.ts'"), 'Composition root still owns workshop schema initialization')

  check(ordersRead.includes("import { ensureOrderItemWorkshopColumn } from './workshop-schema.ts'"), 'Order read path is missing scoped workshop schema guard')
  check(ordersRead.includes("export async function listOrders(db: D1Database, url: URL) {\n  await ensureOrderItemWorkshopColumn(db);"), 'Orders list does not initialize legacy workshop columns before using them')

  check(ordersWrite.includes('assertWorkshopTaskDetailSchema, ensureOrderItemWorkshopColumn'), 'Order write path is missing scoped workshop schema guard import')
  check(ordersWrite.includes("export async function createOrder(db: D1Database, input: OrderInput, actor?: AuthUser | null) {\n  await ensureOrderItemWorkshopColumn(db);"), 'Create Order is missing scoped workshop column initialization')
  check(ordersWrite.includes(") {\n  await ensureOrderItemWorkshopColumn(db);\n  let criticalOperation"), 'Critical Order edit is missing scoped workshop column initialization')
  check(ordersWrite.includes("export async function getOrder(db: D1Database, id: number) {\n  await ensureOrderItemWorkshopColumn(db);"), 'Get Order is missing scoped workshop column initialization')

  check(app.includes('const controller = new AbortController()'), 'Initial auth check has no abort controller')
  check(app.includes('window.setTimeout(() => controller.abort(), 8_000)'), 'Initial auth check timeout is missing or changed')
  check(app.includes("fetch('/api/auth/status', {"), 'Initial auth status request missing')
  check(app.includes("cache: 'no-store'") && app.includes('signal: controller.signal'), 'Initial auth check is not cache-bypassed and abortable')
  check(app.includes('window.clearTimeout(timeout)'), 'Initial auth timeout cleanup missing')

  console.log('SESSION HOTPATH HOTFIX PASSED — auth status no longer depends on workshop schema initialization and startup auth cannot wait forever.')
} catch (error) {
  console.error(`SESSION HOTPATH HOTFIX FAILED: ${error?.message || error}`)
  process.exit(1)
}

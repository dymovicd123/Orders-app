import fs from 'node:fs'
import crypto from 'node:crypto'

import { readWorkerSource } from './lib/worker-source.mjs'
import { readAppControllerSource, readInventorySource } from './lib/frontend-source.mjs'
const read = (file) => fs.readFileSync(file, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const ARRIVAL_START = '<div className="inventory-arrival-legacy-workspace">'
const ARRIVAL_END = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
const ARRIVAL_HASH = 'd8806f8f7971d6ee5c4c656d5cdf1551297ecc6ad01cc84730b16c3153bd05bf'

try {
  const worker = readWorkerSource()
  const app = readAppControllerSource()
  const team = read('src/features/sections/TeamSection.tsx')
  const workshop = read('src/features/sections/WorkshopSection.tsx')
  const orders = read('src/features/sections/OrdersTableSection.tsx')
  const debts = read('src/features/sections/OrderDebtSection.tsx')
  const filters = read('src/features/sections/OrderFiltersSection.tsx')
  const inventoryController = read('src/features/sections/InventorySection.tsx')
  const inventory = readInventorySource()
  const storage = read('src/features/storage/DatabaseStorageMaintenance.tsx')
  const cleanup1906c = worker.includes("deadLegacyCleanup: '1906c'")
  const importHubPath = 'src/features/renderers/ImportHubRenderer.tsx'
  const importHub = fs.existsSync(importHubPath) ? read(importHubPath) : ''
  const css = read('src/styles/1905-small-screen-acceptance.css')

  check(worker.includes("storageDatabaseHygiene: '1904'"), '190.4 prerequisite marker missing')
  check(worker.includes("uiSmallScreenAcceptance: '1905'"), '190.5 health marker missing')
  check(app.includes("import './styles/1905-small-screen-acceptance.css'"), '190.5 CSS is not loaded')

  check(!team.includes('внутреннему ID'), 'Team still exposes internal ID prose')
  check(team.includes('<th>Закрытые долги</th>'), 'Team debt-closure column is not labeled explicitly')
  check(!team.includes('<th>Всего</th>'), 'Team still exposes the meaningless mixed total column')
  check(!team.includes('<td>{row.totalActions}</td>'), 'Team still renders mixed totalActions')
  check(team.includes('colSpan={6}'), 'Team empty state must match the six meaningful columns')
  check(team.includes("teamActivityReport ? teamActivityReport.totals.orders : '—'"), 'Team failed first load must still render a placeholder, not zero')

  check(workshop.includes('<th>Заказ</th>') && !workshop.includes('<th>ID заказа</th>'), 'Workshop invoice still says ID заказа')
  check(orders.includes('<th>Дата / заказ</th>') && !orders.includes('<th>Дата / ID</th>'), 'Orders table still uses technical ID wording')
  check(debts.includes('<th>Дата / заказ</th>') && !debts.includes('<th>Дата / ID</th>'), 'Debt table still uses technical ID wording')
  check(filters.includes('placeholder="Заказ, клиент, менеджер, город, товар или комментарий"'), 'Order search placeholder was not humanized')
  check(app.includes("'Изделие | Характеристики | Кол-во | Срочность | Комментарий | Заказ'"), 'Workshop text export header is not humanized')

  for (const forbidden of ['Показываю последние подходящие заказы из D1.', 'Фильтр работает через SQL.', '<div className="card-label">Worker</div>']) {
    check(!app.includes(forbidden), `overview still exposes developer wording: ${forbidden}`)
  }
  check(!storage.includes('отдельную D1'), 'Storage UI still exposes D1 terminology')
  if (cleanup1906c) {
    check(!fs.existsSync(importHubPath), 'Step 190.6C: retired Import Hub renderer resurfaced')
  } else {
    check(!importHub.includes('лежит в D1') && !importHub.includes('D1 при этом не меняется'), 'Import UI still exposes D1 terminology')
  }
  check(!inventory.includes('Пакетов чтения D1'), 'Inventory support summary still exposes D1 terminology')
  check(!inventory.includes('variant-комбинации'), 'Inventory workflow still exposes internal variant wording')

  check(css.includes('@media (max-width: 1180px) and (min-width: 821px)'), '1024/900 desktop acceptance breakpoint missing')
  check(css.includes('@media (max-width: 820px)'), '768/mobile acceptance breakpoint missing')
  check(css.includes('@media (max-width: 820px) and (max-height: 700px)'), '768x650 short-screen dialog guard missing')
  check(css.includes('.report-filter-row'), 'report filter row layout contract missing')
  check(css.includes('.sector-orders .editor-columns'), 'order editor mid-size layout guard missing')
  check(css.includes('.storage-maintenance-modal'), 'storage dialog small-screen guard missing')
  check(css.includes('.catalog-resolution-facts-grid'), 'catalog review small-screen guard missing')
  check(!/inventory-arrival(?:-|\b)/.test(css), '190.5 CSS must not target the frozen Arrival UI')

  const start = inventory.indexOf(ARRIVAL_START)
  const end = start >= 0 ? inventory.indexOf(ARRIVAL_END, start) : -1
  check(start >= 0 && end >= 0, 'frozen Arrival block not found')
  check(sha(inventory.slice(start, end + ARRIVAL_END.length)) === ARRIVAL_HASH, 'frozen Arrival UI changed')

  console.log('STEP 190.5 UI / SMALL-SCREEN ACCEPTANCE TESTS PASSED')
} catch (error) {
  console.error(`STEP 190.5 UI / SMALL-SCREEN ACCEPTANCE TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

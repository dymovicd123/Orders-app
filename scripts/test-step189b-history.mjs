import fs from 'node:fs'
import path from 'node:path'

import { readWorkerSource } from './lib/worker-source.mjs'
import { readInventorySource } from './lib/frontend-source.mjs'
const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))
const fail = (message) => { throw new Error(message) }

try {
  const required = [
    'worker/index.ts',
    'src/App.tsx',
    'src/app/types.ts',
    'src/features/sections/InventorySection.tsx',
    'src/features/sections/OrderReturnsSection.tsx',
    'src/features/sections/OrderExchangeSection.tsx',
    'src/features/renderers/FinanceDashboardRenderer.tsx',
    'src/styles/189b-business-history.css',
  ]
  for (const file of required) if (!exists(file)) fail(`Нет файла ${file}`)

  const worker = readWorkerSource()
  for (const marker of [
    "businessHistoryVisibility: '189b'",
    "url.pathname === '/api/inventory/history'",
    "url.pathname === '/api/inventory/check-history'",
    "url.pathname === '/api/finance/cash-register/cycles'",
    'async function listInventoryHistory',
    'async function listInventoryCheckHistory',
    'async function listCashRegisterCycles',
    'nextBeforeId',
    "const variantId = Math.max(0, toInt(url.searchParams.get('variantId'), 0));",
    "status === 'cancelled'",
  ]) if (!worker.includes(marker)) fail(`Worker marker отсутствует: ${marker}`)

  const app = read('src/App.tsx')
  for (const marker of [
    "import './styles/189b-business-history.css'",
    'loadInventoryHistory',
    'loadInventoryCheckHistory',
    'loadCashRegisterCycles',
    'returnHistoryError',
    'exchangeHistoryError',
  ]) if (!app.includes(marker)) fail(`App marker отсутствует: ${marker}`)

  const returns = read('src/features/sections/OrderReturnsSection.tsx')
  for (const marker of ['История возвратов', 'Комментарий возврата', 'Причина отмены', 'Показать ещё', 'Не удалось загрузить историю возвратов']) {
    if (!returns.includes(marker)) fail(`Returns marker отсутствует: ${marker}`)
  }
  if (returns.includes('entry.comment || entry.cancellationComment')) fail('Возвраты снова смешивают комментарий и причину отмены.')

  const exchanges = read('src/features/sections/OrderExchangeSection.tsx')
  for (const marker of ['История обменов', 'Не удалось загрузить историю обменов', 'Показать ещё', 'Причина отмены']) {
    if (!exchanges.includes(marker)) fail(`Exchange marker отсутствует: ${marker}`)
  }

  const inventory = readInventorySource()
  for (const marker of ['История склада', 'Ревизии и сверки', 'loadHistoryMovements', 'loadHistoryChecks', 'historyVariantFilter']) {
    if (!inventory.includes(marker)) fail(`Inventory history marker отсутствует: ${marker}`)
  }

  const finance = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  for (const marker of ['Прошлые циклы', 'Показать прошлые циклы', 'Остаток перед закрытием']) {
    if (!finance.includes(marker)) fail(`Cash history marker отсутствует: ${marker}`)
  }

  const css = read('src/styles/189b-business-history.css')
  for (const marker of ['.history-card', '.history-filter-bar', '.cash-cycle-card', '@media (max-width: 760px)']) {
    if (!css.includes(marker)) fail(`189B CSS marker отсутствует: ${marker}`)
  }

  console.log('Step 189B history visibility checks: OK')
} catch (error) {
  console.error(`Step 189B history visibility checks FAILED: ${error?.message || error}`)
  process.exit(1)
}

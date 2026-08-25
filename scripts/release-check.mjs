import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readWorkerSource } from './lib/worker-source.mjs'
import { readInventorySource } from './lib/frontend-source.mjs'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))
const fail = (message) => { throw new Error(message) }
const shaText = (value) => crypto.createHash('sha256').update(value).digest('hex')
const ARRIVAL_START = '<div className="inventory-arrival-legacy-workspace">'
const ARRIVAL_END = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
const EXPECTED_ARRIVAL_HASH = 'd8806f8f7971d6ee5c4c656d5cdf1551297ecc6ad01cc84730b16c3153bd05bf'

function run(label, executable, args) {
  console.log(`> ${label}`)
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  if (result.error) fail(`${label}: ${result.error.message}`)
  if (result.status !== 0) fail(`${label}: код ${result.status}`)
}

function localNodeScript(candidates, label) {
  for (const candidate of candidates) if (exists(candidate)) return path.join(root, candidate)
  fail(`${label}: локальный пакет не найден.`)
}

function configValue(text, key) {
  const match = new RegExp(`(?:^|\\n)\\s*["']?${key}["']?\\s*[:=]\\s*["']([^"']+)["']`, 'm').exec(text)
  return match?.[1] || ''
}

function verifySource() {
  for (const file of [
    'worker/index.ts',
    'src/App.tsx',
    'src/features/sections/InventorySection.tsx',
    'src/features/storage/DatabaseStorageMaintenance.tsx',
    'migrations/0057_v72_safe_early_handover.sql',
    'scripts/test-step189a2-sql.mjs',
    'scripts/test-step189b-history.mjs',
    'scripts/test-step189b-history-sql.mjs',
    'src/styles/189b-business-history.css',
    'migrations/0058_v72_reliable_money_history.sql',
    'scripts/test-step189c-money-history.mjs',
    'scripts/test-step189c-money-sql.mjs',
    'scripts/test-finance-f2-trace.mjs',
    'scripts/test-finance-f3-summary-ux.mjs',
    'scripts/test-finance-f4-money-journal.mjs',
    'scripts/test-finance-f5-entry-semantics.mjs',
    'scripts/test-finance-f5-adjacent-regression.mjs',
    'scripts/test-finance-f6-release-audit.mjs',
    'scripts/finance-f6-delete-money-history-worker-manifest.json',
    'scripts/finance-f4-money-journal-worker-manifest.json',
    'scripts/finance-f2-trace-worker-manifest.json',
    'src/styles/189c-reliable-money-history.css',
    'src/styles/finance-f4-money-journal.css',
    'scripts/test-step189d-team-activity.mjs',
    'scripts/test-step189d-team-activity-sql.mjs',
    'scripts/test-step189d1-pre-audit-stability.mjs',
    'src/styles/189d-team-activity-cleanup.css',
    'migrations/0059_v72_critical_operation_idempotency.sql',
    'scripts/test-step1901-critical-operations.mjs',
    'scripts/test-step1902-cloudflare-bulk-limits.mjs',
    'scripts/test-step1903-read-error-cache-safety.mjs',
    'migrations/0060_v72_storage_database_hygiene.sql',
    'scripts/test-step1904-storage-database-hygiene.mjs',
    'scripts/test-step1905-ui-small-screen-acceptance.mjs',
    'scripts/test-step1906a-worker-modularization.mjs',
    'scripts/test-step1906b-frontend-modularization.mjs',
    'scripts/test-step1906c-dead-code-cleanup.mjs',
    'scripts/test-step1906d-bundle-lazy-loading.mjs',
    'scripts/test-step1906e-type-api-boundaries.mjs',
    'scripts/step1906e-type-boundary-manifest.json',
    'scripts/step191d-transfer-runtime-manifest.json',
    'scripts/test-step191d-transfer-runtime-safety.mjs',
    'scripts/step191e-runtime-hardening-manifest.json',
    'scripts/test-step191e-runtime-limits-atomicity.mjs',
    'scripts/step191f-admin-session-integrity-manifest.json',
    'scripts/test-step191f-admin-session-integrity.mjs',
    'scripts/step192a1-warehouse-truth-freshness-manifest.json',
    'scripts/test-step192a1-warehouse-truth-freshness.mjs',
    'scripts/step192a2-catalog-truth-finalizer-manifest.json',
    'scripts/test-step192a2-catalog-truth-finalizer.mjs',
    'scripts/step192b2a4-order-create-save-integrity-manifest.json',
    'scripts/test-step192b2a4-order-create-save-integrity.mjs',
    'scripts/test-step192b2b-movement-picker.mjs',
    'src/features/inventory/movementPickerB2B.ts',
    'src/styles/192b2b-movement-picker.css',
    'shared/api-contracts.ts',
    'scripts/check-step1906d-bundle-budget.mjs',
    'src/app/lazySections.tsx',
    'src/main.tsx',
    'scripts/step1906c-dead-code-manifest.json',
    'scripts/verify-database-safety.mjs',
    'scripts/step1906b-frontend-preservation-manifest.json',
    'scripts/step1906a-worker-declaration-manifest.json',
    'scripts/lib/worker-source.mjs',
    'scripts/lib/frontend-source.mjs',
    'src/styles/1905-small-screen-acceptance.css',
    'wrangler.jsonc',
  ]) if (!exists(file)) fail(`Нет обязательного файла: ${file}`)

  const worker = readWorkerSource()
  for (const marker of [
    "warehouseCatalogFilter: '188k2-post-stocktake'",
    "safeEarlyHandover: '188k3-v5'",
    "catalogReviewOperationalQueue: '189a2'",
    "storageCleanupSafety: '189a2'",
    "businessHistoryVisibility: '189b'",
    "reliableMoneyHistory: '189c'",
    "teamActivityCleanup: '189d1'",
    "preAuditStability: '189d1'",
    "teamActivityQueryPlan: 'split-selects-r2'",
    "criticalOperationReliability: '1901'",
    "cloudflareBulkLimits: '1902'",
    "readPathSafety: '1903'",
    "storageDatabaseHygiene: '1904'",
    "uiSmallScreenAcceptance: '1905'",
    "structuralModularization: '1906a'",
    "frontendControllerModularization: '1906b'",
    "deadLegacyCleanup: '1906c'",
    "bundleLazyLoading: '1906d'",
    "typeApiBoundaryCleanup: '1906e'",
    "transferRuntimeSafety: '191d'",
    "runtimeLimitsAtomicity: '191e'",
    "adminSessionIntegrity: '191f'",
    "warehouseTruthFreshness: '192a1'",
    "catalogTruthFinalizer: '192a2'",
    "orderCreateSaveIntegrity: '192b2a4'",
    'excludeCatalogReviewQueueItem',
    'activeDatabaseStorageStocktakeCount',
    'databaseStoragePendingBatchBlockReason',
  ]) if (!worker.includes(marker)) fail(`Worker marker отсутствует: ${marker}`)

  const app = read('src/App.tsx')
  for (const marker of ["import './styles/189c-reliable-money-history.css'", 'loadMoneyHistory', 'moneyHistorySummary']) {
    if (!app.includes(marker)) fail(`Step 189C App marker отсутствует: ${marker}`)
  }
  const financeRenderer = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  for (const marker of ['История денег', 'Здесь видно, как менялись деньги в системе']) {
    if (!financeRenderer.includes(marker)) fail(`Step 189C finance marker отсутствует: ${marker}`)
  }

  const inventoryController = read('src/features/sections/InventorySection.tsx')
  const inventory = readInventorySource()
  if (inventory.includes('Старые записи скрыты:')) fail('Интерфейс снова показывает технический счётчик скрытой истории.')
  for (const marker of ['Не добавлять в каталог', 'Здесь только недавние позиции', 'Не сохранено:', 'openStocktakeInlineSize']) {
    if (!inventory.includes(marker)) fail(`Inventory marker отсутствует: ${marker}`)
  }
  const arrivalStart = inventory.indexOf(ARRIVAL_START)
  const arrivalEnd = arrivalStart >= 0 ? inventory.indexOf(ARRIVAL_END, arrivalStart) : -1
  if (arrivalStart < 0 || arrivalEnd < 0) fail('Не найден замороженный блок «Приход».')
  const arrivalHash = shaText(inventory.slice(arrivalStart, arrivalEnd + ARRIVAL_END.length))
  if (arrivalHash !== EXPECTED_ARRIVAL_HASH) fail('Интерфейс «Приход» отличается от утверждённой версии.')

  const storage = read('src/features/storage/DatabaseStorageMaintenance.tsx')
  for (const marker of ['Хранилище этой системы', 'Настроенный лимит этой базы', 'активные резервы', 'ревизии не очищаются']) {
    if (!storage.includes(marker)) fail(`Storage UI marker отсутствует: ${marker}`)
  }

  const migration = read('migrations/0057_v72_safe_early_handover.sql').replace(/^\s*--.*$/gm, ' ')
  const statements = migration.split(';').map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const allow = [
    /^CREATE TABLE IF NOT EXISTS inventory_handover_reviews\b/i,
    /^CREATE INDEX IF NOT EXISTS idx_inventory_handover_reviews_order\b/i,
    /^CREATE INDEX IF NOT EXISTS idx_inventory_handover_reviews_checkpoint\b/i,
    /^INSERT OR IGNORE INTO inventory_model_meta\b/i,
  ]
  if (statements.length !== allow.length) fail(`0057: ожидалось ${allow.length} additive statements, найдено ${statements.length}.`)
  statements.forEach((statement, index) => {
    if (!allow[index].test(statement)) fail(`0057 statement ${index + 1} вышел за additive allow-list.`)
    if (/^\s*(UPDATE|DELETE|REPLACE|DROP|ALTER|VACUUM|ATTACH|DETACH)\b/i.test(statement)) fail(`0057 statement ${index + 1} начинается с запрещённой мутации.`)
  })
}

function verifyGeneratedConfig() {
  const redirectPath = path.join(root, '.wrangler', 'deploy', 'config.json')
  if (!fs.existsSync(redirectPath)) fail('Vite build не создал .wrangler/deploy/config.json.')
  const redirect = JSON.parse(fs.readFileSync(redirectPath, 'utf8'))
  const generatedPath = path.resolve(path.dirname(redirectPath), String(redirect.configPath || ''))
  if (!fs.existsSync(generatedPath)) fail('Не найден сгенерированный Wrangler config.')
  const generated = JSON.parse(fs.readFileSync(generatedPath, 'utf8'))
  const source = read('wrangler.jsonc')
  const expectedName = configValue(source, 'name')
  const expectedDbName = configValue(source, 'database_name')
  const expectedDbId = configValue(source, 'database_id')
  if (!expectedName || generated.name !== expectedName) fail(`Worker name mismatch: ${generated.name || '(нет)'} / ${expectedName || '(нет)'}`)
  const db = Array.isArray(generated.d1_databases) ? generated.d1_databases.find((entry) => entry?.binding === 'DB') : null
  if (!db || db.database_name !== expectedDbName || db.database_id !== expectedDbId) fail('Сгенерированный deploy config указывает не на ту D1.')
}

try {
  console.log('=== RELEASE CHECK — current project invariants ===')
  verifySource()
  console.log('Source invariants: OK')
  run('Step 189A.2 SQL safety tests', process.execPath, [path.join(root, 'scripts/test-step189a2-sql.mjs')])
  run('Step 189B history visibility tests', process.execPath, [path.join(root, 'scripts/test-step189b-history.mjs')])
  run('Step 189B SQL shape tests', process.execPath, [path.join(root, 'scripts/test-step189b-history-sql.mjs')])
  run('Step 189C reliable money history tests', process.execPath, [path.join(root, 'scripts/test-step189c-money-history.mjs')])
  run('Step 189C money SQL tests', process.execPath, [path.join(root, 'scripts/test-step189c-money-sql.mjs')])
  run('Finance F2 selected-period traceability tests', process.execPath, [path.join(root, 'scripts/test-finance-f2-trace.mjs')])
  run('Finance F3 summary/day UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f3-summary-ux.mjs')])
  run('Finance F4 money journal UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f4-money-journal.mjs')])
  run('Finance F5 entry semantics tests', process.execPath, [path.join(root, 'scripts/test-finance-f5-entry-semantics.mjs')])
  run('Finance F5 adjacent finance/cash regression', process.execPath, [path.join(root, 'scripts/test-finance-f5-adjacent-regression.mjs')])
  run('Finance F6 aggregate release audit', process.execPath, [path.join(root, 'scripts/test-finance-f6-release-audit.mjs')])
  run('Step 189D team activity tests', process.execPath, [path.join(root, 'scripts/test-step189d-team-activity.mjs')])
  run('Step 189D team activity SQL tests', process.execPath, [path.join(root, 'scripts/test-step189d-team-activity-sql.mjs')])
  run('Step 189D.1 pre-audit stability tests', process.execPath, [path.join(root, 'scripts/test-step189d1-pre-audit-stability.mjs')])
  run('Step 190.1 critical operation reliability tests', process.execPath, [path.join(root, 'scripts/test-step1901-critical-operations.mjs')])
  run('Step 190.2 Cloudflare bulk-limit tests', process.execPath, [path.join(root, 'scripts/test-step1902-cloudflare-bulk-limits.mjs')])
  run('Step 190.3 read/error/cache safety tests', process.execPath, [path.join(root, 'scripts/test-step1903-read-error-cache-safety.mjs')])
  run('Step 190.4 storage/database hygiene tests', process.execPath, [path.join(root, 'scripts/test-step1904-storage-database-hygiene.mjs')])
  run('Step 190.5 UI / small-screen acceptance tests', process.execPath, [path.join(root, 'scripts/test-step1905-ui-small-screen-acceptance.mjs')])
  run('Step 190.6A Worker modularization tests', process.execPath, [path.join(root, 'scripts/test-step1906a-worker-modularization.mjs')])
  run('Step 190.6B frontend controller modularization tests', process.execPath, [path.join(root, 'scripts/test-step1906b-frontend-modularization.mjs')])
  run('Step 190.6C dead/dormant/legacy cleanup tests', process.execPath, [path.join(root, 'scripts/test-step1906c-dead-code-cleanup.mjs')])
  run('Step 190.6D bundle / lazy-loading tests', process.execPath, [path.join(root, 'scripts/test-step1906d-bundle-lazy-loading.mjs')])
  run('Step 190.6E type / API boundary tests', process.execPath, [path.join(root, 'scripts/test-step1906e-type-api-boundaries.mjs')])
  run('Step 191D transfer runtime safety tests', process.execPath, [path.join(root, 'scripts/test-step191d-transfer-runtime-safety.mjs')])
  run('Step 191E D1 runtime limits / atomicity tests', process.execPath, [path.join(root, 'scripts/test-step191e-runtime-limits-atomicity.mjs')])
  run('Step 191F admin session integrity tests', process.execPath, [path.join(root, 'scripts/test-step191f-admin-session-integrity.mjs')])
  run('Step 192A1 Warehouse truth / freshness tests', process.execPath, [path.join(root, 'scripts/test-step192a1-warehouse-truth-freshness.mjs')])
  run('Step 192A2 catalog truth finalizer tests', process.execPath, [path.join(root, 'scripts/test-step192a2-catalog-truth-finalizer.mjs')])
  run('Step 192B1 Warehouse truth gates / attention tests', process.execPath, [path.join(root, 'scripts/test-step192b1-warehouse-truth-attention.mjs')])
  run('Step 192B2A daily Warehouse attention / count tests', process.execPath, [path.join(root, 'scripts/test-step192b2a-daily-warehouse.mjs')])
  run('Step 192B2A1 Attention panel visibility tests', process.execPath, [path.join(root, 'scripts/test-step192b2a1-attention-visibility.mjs')])
  run('Step 192B2A2 Attention context / de-dup tests', process.execPath, [path.join(root, 'scripts/test-step192b2a2-attention-context.mjs')])
  run('Step 192B2A3 handover SQL alias safety tests', process.execPath, [path.join(root, 'scripts/test-step192b2a3-handover-sql-alias-safety.mjs')])
  run('Step 192B2A4 order create/save integrity tests', process.execPath, [path.join(root, 'scripts/test-step192b2a4-order-create-save-integrity.mjs')])
  run('Step 192B2B movement picker UX tests', process.execPath, [path.join(root, 'scripts/test-step192b2b-movement-picker.mjs')])
  run('Current database safety tests', process.execPath, [path.join(root, 'scripts/verify-database-safety.mjs')])
  const tsc = localNodeScript(['node_modules/typescript/bin/tsc'], 'TypeScript')
  const vite = localNodeScript(['node_modules/vite/bin/vite.js'], 'Vite')
  const wrangler = localNodeScript(['node_modules/wrangler/bin/wrangler.js', 'node_modules/wrangler/wrangler-dist/cli.js'], 'Wrangler')
  run('TypeScript', process.execPath, [tsc, '-b', '--force', '--pretty', 'false'])
  run('Clean Vite build', process.execPath, [vite, 'build', '--emptyOutDir'])
  run('Step 190.6D post-build bundle budget', process.execPath, [path.join(root, 'scripts/check-step1906d-bundle-budget.mjs')])
  verifyGeneratedConfig()
  run('Wrangler deploy --dry-run', process.execPath, [wrangler, 'deploy', '--dry-run'])
  console.log('RELEASE CHECK PASSED.')
} catch (error) {
  console.error(`RELEASE CHECK FAILED: ${error?.message || error}`)
  process.exit(1)
}

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const workerRoot = path.join(root, 'worker')
const manifestPath = path.join(root, 'scripts/step1906a-worker-declaration-manifest.json')
const cleanupPath = path.join(root, 'scripts/step1906c-dead-code-manifest.json')
const boundaryPath = path.join(root, 'scripts/step1906e-type-boundary-manifest.json')
const transferRuntimePath = path.join(root, 'scripts/step191d-transfer-runtime-manifest.json')
const runtimeHardeningPath = path.join(root, 'scripts/step191e-runtime-hardening-manifest.json')
const adminSessionIntegrityPath = path.join(root, 'scripts/step191f-admin-session-integrity-manifest.json')
const warehouseTruthFreshnessPath = path.join(root, 'scripts/step192a1-warehouse-truth-freshness-manifest.json')
const catalogTruthFinalizerPath = path.join(root, 'scripts/step192a2-catalog-truth-finalizer-manifest.json')
const warehouseAttentionTruthPath = path.join(root, 'scripts/step192b1-warehouse-truth-attention-manifest.json')
const dailyWarehousePath = path.join(root, 'scripts/step192b2a-daily-warehouse-manifest.json')
const attentionContextPath = path.join(root, 'scripts/step192b2a2-attention-context-manifest.json')
const handoverSqlAliasSafetyPath = path.join(root, 'scripts/step192b2a3-handover-sql-alias-safety-manifest.json')
const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')
const stocktakeLostResponsePath = path.join(root, 'scripts/stocktake-lost-response-worker-manifest.json')
const financeOrderDateSyncPath = path.join(root, 'scripts/finance-order-date-sync-worker-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function walk(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(full)
  }
  return result.sort()
}

function declarationNames(statement) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')
function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const target = path.resolve(path.dirname(fromFile), specifier)
  return target.endsWith('.ts') ? target : `${target}.ts`
}

try {
  check(fs.existsSync(manifestPath), '1906A declaration manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  check(manifest?.version === 1 && manifest?.declarationCount === 577, '1906A declaration manifest invalid')
  check(fs.existsSync(financeOrderDateSyncPath), 'Finance order-date sync Worker manifest missing')
  const cleanup = fs.existsSync(cleanupPath) ? JSON.parse(fs.readFileSync(cleanupPath, 'utf8')) : null
  const removed = cleanup?.version === 1 ? (cleanup.removedWorkerDeclarations || {}) : {}
  const boundary = fs.existsSync(boundaryPath) ? JSON.parse(fs.readFileSync(boundaryPath, 'utf8')) : null
  const boundaryChanges = boundary?.version === 1 ? (boundary.changes || {}) : {}
  const transferRuntime = fs.existsSync(transferRuntimePath) ? JSON.parse(fs.readFileSync(transferRuntimePath, 'utf8')) : null
  const transferRuntimeChanges = transferRuntime?.version === 1 ? (transferRuntime.changes || {}) : {}
  const runtimeHardening = fs.existsSync(runtimeHardeningPath) ? JSON.parse(fs.readFileSync(runtimeHardeningPath, 'utf8')) : null
  const runtimeHardeningChanges = runtimeHardening?.version === 1 ? (runtimeHardening.changes || {}) : {}
  const adminSessionIntegrity = fs.existsSync(adminSessionIntegrityPath) ? JSON.parse(fs.readFileSync(adminSessionIntegrityPath, 'utf8')) : null
  const adminSessionIntegrityChanges = adminSessionIntegrity?.version === 1 ? (adminSessionIntegrity.changes || {}) : {}
  const warehouseTruthFreshness = fs.existsSync(warehouseTruthFreshnessPath) ? JSON.parse(fs.readFileSync(warehouseTruthFreshnessPath, 'utf8')) : null
  const warehouseTruthFreshnessChanges = warehouseTruthFreshness?.version === 1 ? (warehouseTruthFreshness.changes || {}) : {}
  const warehouseTruthFreshnessAdded = warehouseTruthFreshness?.version === 1 ? (warehouseTruthFreshness.added || {}) : {}
  const catalogTruthFinalizer = fs.existsSync(catalogTruthFinalizerPath) ? JSON.parse(fs.readFileSync(catalogTruthFinalizerPath, 'utf8')) : null
  const catalogTruthFinalizerChanges = catalogTruthFinalizer?.version === 1 ? (catalogTruthFinalizer.changes || {}) : {}
  const warehouseAttentionTruth = fs.existsSync(warehouseAttentionTruthPath) ? JSON.parse(fs.readFileSync(warehouseAttentionTruthPath, 'utf8')) : null
  const warehouseAttentionTruthChanges = warehouseAttentionTruth?.version === 1 ? (warehouseAttentionTruth.changes || {}) : {}
  const warehouseAttentionTruthAdded = warehouseAttentionTruth?.version === 1 ? (warehouseAttentionTruth.added || {}) : {}
  const dailyWarehouse = fs.existsSync(dailyWarehousePath) ? JSON.parse(fs.readFileSync(dailyWarehousePath, 'utf8')) : null
  const dailyWarehouseChanges = dailyWarehouse?.version === 1 ? (dailyWarehouse.changes || {}) : {}
  const dailyWarehouseAdded = dailyWarehouse?.version === 1 ? (dailyWarehouse.added || {}) : {}
  const attentionContext = fs.existsSync(attentionContextPath) ? JSON.parse(fs.readFileSync(attentionContextPath, 'utf8')) : null
  const attentionContextChanges = attentionContext?.version === 1 ? (attentionContext.changes || {}) : {}
  const attentionContextAdded = attentionContext?.version === 1 ? (attentionContext.added || {}) : {}
  const handoverSqlAliasSafety = fs.existsSync(handoverSqlAliasSafetyPath) ? JSON.parse(fs.readFileSync(handoverSqlAliasSafetyPath, 'utf8')) : null
  const handoverSqlAliasSafetyChanges = handoverSqlAliasSafety?.version === 1 ? (handoverSqlAliasSafety.changes || {}) : {}
  const orderCreateSaveIntegrity = fs.existsSync(orderCreateSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderCreateSaveIntegrityPath, 'utf8')) : null
  const orderCreateSaveIntegrityChanges = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.changes || {}) : {}
  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}
  const stocktakeLostResponse = fs.existsSync(stocktakeLostResponsePath) ? JSON.parse(fs.readFileSync(stocktakeLostResponsePath, 'utf8')) : null
  const stocktakeLostResponseChanges = stocktakeLostResponse?.version === 1 ? (stocktakeLostResponse.changes || {}) : {}
  const financeOrderDateSync = fs.existsSync(financeOrderDateSyncPath) ? JSON.parse(fs.readFileSync(financeOrderDateSyncPath, 'utf8')) : null
  const financeOrderDateSyncChanges = financeOrderDateSync?.version === 1 ? (financeOrderDateSync.changes || {}) : {}

  const files = walk(workerRoot)
  const indexPath = path.join(workerRoot, 'index.ts')
  check(files.length >= 28, `Worker module tree unexpectedly small: ${files.length}`)
  check(fs.existsSync(indexPath), 'worker/index.ts missing')

  const required = [
    'core/http.ts', 'core/settings.ts', 'core/sql.ts', 'core/text.ts', 'core/types.ts',
    'domains/auth.ts', 'domains/critical.ts', 'domains/catalog.ts', 'domains/money.ts',
    'domains/activity.ts', 'domains/cash.ts', 'domains/finance-reports.ts', 'domains/order-core.ts',
    'domains/storage.ts', 'domains/references.ts', 'domains/orders-relations.ts', 'domains/clients.ts',
    'domains/workshop-schema.ts', 'domains/inventory-reservations.ts', 'domains/inventory-primitives.ts',
    'domains/inventory-stocktake.ts', 'domains/inventory-read.ts', 'domains/inventory-movement.ts',
    'domains/orders-read.ts', 'domains/order-reservations.ts', 'domains/catalog-review.ts', 'domains/orders-write.ts',
    'domains/lifecycle.ts', 'domains/returns-exchanges.ts', 'domains/workshop-matching.ts', 'domains/workshop.ts', 'domains/team.ts', 'domains/warehouse-attention.ts',
  ]
  if (!cleanup) required.push('domains/imports.ts')
  for (const relative of required) check(fs.existsSync(path.join(workerRoot, relative)), `Worker module missing: ${relative}`)
  if (cleanup) check(!fs.existsSync(path.join(workerRoot, 'domains/imports.ts')), 'Retired imports.ts unexpectedly returned')

  const indexText = fs.readFileSync(indexPath, 'utf8')
  check(indexText.includes("structuralModularization: '1906a'"), '1906A live health marker missing')
  check(indexText.split(/\r?\n/).length <= 1600, `worker/index.ts is no longer a composition root (${indexText.split(/\r?\n/).length} lines)`)
  for (const forbidden of ['async function createOrder', 'async function applyInventoryMovement', 'async function createReturn', 'async function listTeamActivity']) check(!indexText.includes(forbidden), `Domain logic leaked back into worker/index.ts: ${forbidden}`)

  const declarations = new Map()
  let currentRouter = ''
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    check(!text.includes('@ts-nocheck'), `Worker module disables type checking: ${path.relative(root, file)}`)
    if (file !== indexPath) check(fs.statSync(file).size <= 240_000, `Worker module is still too large: ${path.relative(root, file)} (${fs.statSync(file).size} bytes)`)
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of source.statements) {
      for (const name of declarationNames(statement)) {
        check(!declarations.has(name), `Duplicate top-level Worker declaration after split: ${name}`)
        declarations.set(name, normalizeMovedDeclaration(statement.getText(source)))
      }
      if (file === indexPath && ts.isExportAssignment(statement)) currentRouter = statement.getText(source)
    }
  }

  const removedNames = Object.keys(removed)
  const expectedDeclarationCount = manifest.declarationCount - removedNames.length + Object.keys(warehouseTruthFreshnessAdded).length + Object.keys(warehouseAttentionTruthAdded).length + Object.keys(dailyWarehouseAdded).length + Object.keys(attentionContextAdded).length + Object.keys(orderCreateSaveIntegrityAdded).length
  check(declarations.size === expectedDeclarationCount, `Worker declaration count changed outside accepted allow-lists: ${declarations.size}/${expectedDeclarationCount}`)
  for (const [name, expectedHash] of Object.entries(manifest.declarations)) {
    if (Object.hasOwn(removed, name)) {
      check(removed[name] === expectedHash, `1906C removal hash does not match accepted 1906A declaration: ${name}`)
      check(!declarations.has(name), `Retired Worker declaration unexpectedly returned: ${name}`)
      continue
    }
    check(declarations.has(name), `Worker declaration disappeared outside cleanup allow-list: ${name}`)
    const cleanupChanged = cleanup?.changedWorkerDeclarations?.[name]
    const acceptedPreBoundaryHash = cleanupChanged ? cleanupChanged.after : expectedHash
    if (cleanupChanged) check(cleanupChanged.before === expectedHash, `1906C changed declaration baseline hash mismatch: ${name}`)
    const boundaryChanged = boundaryChanges[name]
    let acceptedPostBoundaryHash = acceptedPreBoundaryHash
    if (boundaryChanged) {
      check(boundaryChanged.before === acceptedPreBoundaryHash, `1906E declaration baseline hash mismatch: ${name}`)
      acceptedPostBoundaryHash = boundaryChanged.after
    }
    const transferRuntimeChanged = transferRuntimeChanges[name]
    let acceptedPostTransferHash = acceptedPostBoundaryHash
    if (transferRuntimeChanged) {
      check(transferRuntimeChanged.before === acceptedPostBoundaryHash, `191D declaration baseline hash mismatch: ${name}`)
      acceptedPostTransferHash = transferRuntimeChanged.after
    }
    const runtimeHardeningChanged = runtimeHardeningChanges[name]
    let acceptedPostRuntimeHardeningHash = acceptedPostTransferHash
    if (runtimeHardeningChanged) {
      check(runtimeHardeningChanged.before === acceptedPostTransferHash, `191E declaration baseline hash mismatch: ${name}`)
      acceptedPostRuntimeHardeningHash = runtimeHardeningChanged.after
    }
    const adminSessionIntegrityChanged = adminSessionIntegrityChanges[name]
    let acceptedPostAdminSessionHash = acceptedPostRuntimeHardeningHash
    if (adminSessionIntegrityChanged) {
      check(adminSessionIntegrityChanged.before === acceptedPostRuntimeHardeningHash, `191F declaration baseline hash mismatch: ${name}`)
      acceptedPostAdminSessionHash = adminSessionIntegrityChanged.after
    }
    const warehouseTruthFreshnessChanged = warehouseTruthFreshnessChanges[name]
    let acceptedPostWarehouseTruthHash = acceptedPostAdminSessionHash
    if (warehouseTruthFreshnessChanged) {
      check(warehouseTruthFreshnessChanged.before === acceptedPostAdminSessionHash, `192A1 declaration baseline hash mismatch: ${name}`)
      acceptedPostWarehouseTruthHash = warehouseTruthFreshnessChanged.after
    }
    const catalogTruthFinalizerChanged = catalogTruthFinalizerChanges[name]
    let acceptedPostCatalogTruthHash = acceptedPostWarehouseTruthHash
    if (catalogTruthFinalizerChanged) {
      check(catalogTruthFinalizerChanged.before === acceptedPostWarehouseTruthHash, `192A2 declaration baseline hash mismatch: ${name}`)
      acceptedPostCatalogTruthHash = catalogTruthFinalizerChanged.after
    }
    const warehouseAttentionTruthChanged = warehouseAttentionTruthChanges[name]
    let acceptedPostWarehouseAttentionHash = acceptedPostCatalogTruthHash
    if (warehouseAttentionTruthChanged) {
      check(warehouseAttentionTruthChanged.before === acceptedPostCatalogTruthHash, `192B1 declaration baseline hash mismatch: ${name}`)
      acceptedPostWarehouseAttentionHash = warehouseAttentionTruthChanged.after
    }
    const dailyWarehouseChanged = dailyWarehouseChanges[name]
    let acceptedPostDailyWarehouseHash = acceptedPostWarehouseAttentionHash
    if (dailyWarehouseChanged) {
      check(dailyWarehouseChanged.before === acceptedPostWarehouseAttentionHash, `192B2A declaration baseline hash mismatch: ${name}`)
      acceptedPostDailyWarehouseHash = dailyWarehouseChanged.after
    }
    const attentionContextChanged = attentionContextChanges[name]
    let acceptedPostAttentionContextHash = acceptedPostDailyWarehouseHash
    if (attentionContextChanged) {
      check(attentionContextChanged.before === acceptedPostDailyWarehouseHash, `192B2A2 declaration baseline hash mismatch: ${name}`)
      acceptedPostAttentionContextHash = attentionContextChanged.after
    }
    const handoverSqlAliasSafetyChanged = handoverSqlAliasSafetyChanges[name]
    let acceptedPostHandoverSqlAliasHash = acceptedPostAttentionContextHash
    if (handoverSqlAliasSafetyChanged) {
      check(handoverSqlAliasSafetyChanged.before === acceptedPostAttentionContextHash, `192B2A3 declaration baseline hash mismatch: ${name}`)
      acceptedPostHandoverSqlAliasHash = handoverSqlAliasSafetyChanged.after
    }
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    let acceptedPostOrderCreateSaveHash = acceptedPostHandoverSqlAliasHash
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 declaration baseline hash mismatch: ${name}`)
      acceptedPostOrderCreateSaveHash = orderCreateSaveIntegrityChanged.after
    }
    const stocktakeLostResponseChanged = stocktakeLostResponseChanges[name]
    let acceptedPostStocktakeLostResponseHash = acceptedPostOrderCreateSaveHash
    if (stocktakeLostResponseChanged) {
      check(stocktakeLostResponseChanged.before === acceptedPostOrderCreateSaveHash, `Stocktake lost-response declaration baseline hash mismatch: ${name}`)
      acceptedPostStocktakeLostResponseHash = stocktakeLostResponseChanged.after
    }
    const financeOrderDateSyncChanged = financeOrderDateSyncChanges[name]
    if (financeOrderDateSyncChanged) {
      check(financeOrderDateSyncChanged.before === acceptedPostStocktakeLostResponseHash, `Finance order-date sync declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeOrderDateSyncChanged.after, `Worker declaration changed beyond exact Finance order-date sync allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostStocktakeLostResponseHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync deltas: ${name}`)
    }
  }

  const normalizedRouter = currentRouter
    .replace(/\n\s*orderCreateSaveIntegrity:\s*'192b2a4',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionContextFix:\s*'192b2a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseDailyAttentionUx:\s*'192b2a',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionTruthGates:\s*'192b1',\s*\n/, '\n')
    .replace(/\n\s*catalogTruthFinalizer:\s*'192a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseTruthFreshness:\s*'192a1',\s*\n/, '\n')
    .replace(/\n\s*adminSessionIntegrity:\s*'191f',\s*\n/, '\n')
    .replace(/\n\s*runtimeLimitsAtomicity:\s*'191e',\s*\n/, '\n')
    .replace(/\n\s*transferRuntimeSafety:\s*'191d',\s*\n/, '\n')
    .replace(/\n\s*typeApiBoundaryCleanup:\s*'1906e',\s*\n/, '\n')
    .replace(/\n\s*bundleLazyLoading:\s*'1906d',\s*\n/, '\n')
    .replace(/\n\s*deadLegacyCleanup:\s*'1906c',\s*\n/, '\n')
    .replace(/\n\s*frontendControllerModularization:\s*'1906b',\s*\n/, '\n')
    .replace(/\n\s*structuralModularization:\s*'1906a',\s*\n/, '\n')
  const pre191eRouterHash = cleanup ? cleanup.postCleanupWorkerRouterHash : manifest.routerHash
  let acceptedPostRuntimeRouterHash = pre191eRouterHash
  if (runtimeHardening) {
    check(runtimeHardening.router?.before === pre191eRouterHash, '191E router baseline hash mismatch')
    acceptedPostRuntimeRouterHash = runtimeHardening.router.after
  }
  let acceptedPostAdminRouterHash = acceptedPostRuntimeRouterHash
  if (adminSessionIntegrity) {
    check(adminSessionIntegrity.router?.before === acceptedPostRuntimeRouterHash, '191F router baseline hash mismatch')
    acceptedPostAdminRouterHash = adminSessionIntegrity.router.after
  }
  let acceptedPostWarehouseRouterHash = acceptedPostAdminRouterHash
  if (warehouseTruthFreshness) {
    check(warehouseTruthFreshness.router?.before === acceptedPostAdminRouterHash, '192A1 router baseline hash mismatch')
    acceptedPostWarehouseRouterHash = warehouseTruthFreshness.router.after
  }
  let acceptedPostCatalogRouterHash = acceptedPostWarehouseRouterHash
  if (catalogTruthFinalizer) {
    check(catalogTruthFinalizer.router?.before === acceptedPostWarehouseRouterHash, '192A2 router baseline hash mismatch')
    acceptedPostCatalogRouterHash = catalogTruthFinalizer.router.after
  }
  let acceptedPostAttentionRouterHash = acceptedPostCatalogRouterHash
  if (warehouseAttentionTruth) {
    check(warehouseAttentionTruth.router?.before === acceptedPostCatalogRouterHash, '192B1 router baseline hash mismatch')
    acceptedPostAttentionRouterHash = warehouseAttentionTruth.router.after
  }
  let acceptedPostDailyRouterHash = acceptedPostAttentionRouterHash
  if (dailyWarehouse) {
    check(dailyWarehouse.router?.before === acceptedPostAttentionRouterHash, '192B2A router baseline hash mismatch')
    acceptedPostDailyRouterHash = dailyWarehouse.router.after
  }
  let acceptedPostAttentionContextRouterHash = acceptedPostDailyRouterHash
  if (attentionContext) {
    check(attentionContext.router?.before === acceptedPostDailyRouterHash, '192B2A2 router baseline hash mismatch')
    acceptedPostAttentionContextRouterHash = attentionContext.router.after
  }
  if (orderCreateSaveIntegrity) {
    check(orderCreateSaveIntegrity.router?.before === acceptedPostAttentionContextRouterHash, '192B2A4 router baseline hash mismatch')
    check(sha(normalizedRouter) === orderCreateSaveIntegrity.router.after, 'Worker router changed beyond exact 192B2A4 order-save delta')
  } else {
    check(sha(normalizedRouter) === acceptedPostAttentionContextRouterHash, `Worker router changed beyond accepted structural/cleanup/runtime/security/warehouse/catalog/attention/daily/order-save delta`)
  }

  for (const [name, expectedHash] of Object.entries(warehouseTruthFreshnessAdded)) {
    check(declarations.has(name), `192A1 added Worker declaration missing: ${name}`)
    const warehouseAttentionChanged = warehouseAttentionTruthChanges[name]
    const acceptedPostAttentionHash = warehouseAttentionChanged ? warehouseAttentionChanged.after : expectedHash
    if (warehouseAttentionChanged) check(warehouseAttentionChanged.before === expectedHash, `192B1 changed 192A1-added declaration baseline hash mismatch: ${name}`)
    const dailyWarehouseChanged = dailyWarehouseChanges[name]
    const acceptedPostDailyHash = dailyWarehouseChanged ? dailyWarehouseChanged.after : acceptedPostAttentionHash
    if (dailyWarehouseChanged) check(dailyWarehouseChanged.before === acceptedPostAttentionHash, `192B2A changed 192A1-added declaration baseline hash mismatch: ${name}`)
    const attentionContextChanged = attentionContextChanges[name]
    const acceptedPostAttentionContextHash = attentionContextChanged ? attentionContextChanged.after : acceptedPostDailyHash
    if (attentionContextChanged) check(attentionContextChanged.before === acceptedPostDailyHash, `192B2A2 changed 192A1-added declaration baseline hash mismatch: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostAttentionContextHash, `192B2A4 changed 192A1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192A1-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostAttentionContextHash, `192A1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(warehouseAttentionTruthAdded)) {
    check(declarations.has(name), `192B1 added Worker declaration missing: ${name}`)
    const dailyWarehouseChanged = dailyWarehouseChanges[name]
    const acceptedPostDailyHash = dailyWarehouseChanged ? dailyWarehouseChanged.after : expectedHash
    if (dailyWarehouseChanged) check(dailyWarehouseChanged.before === expectedHash, `192B2A changed 192B1-added declaration baseline hash mismatch: ${name}`)
    const attentionContextChanged = attentionContextChanges[name]
    const acceptedPostAttentionContextHash = attentionContextChanged ? attentionContextChanged.after : acceptedPostDailyHash
    if (attentionContextChanged) check(attentionContextChanged.before === acceptedPostDailyHash, `192B2A2 changed 192B1-added declaration baseline hash mismatch: ${name}`)
    const handoverSqlAliasSafetyChanged = handoverSqlAliasSafetyChanges[name]
    const acceptedPostHandoverSqlAliasHash = handoverSqlAliasSafetyChanged ? handoverSqlAliasSafetyChanged.after : acceptedPostAttentionContextHash
    if (handoverSqlAliasSafetyChanged) check(handoverSqlAliasSafetyChanged.before === acceptedPostAttentionContextHash, `192B2A3 changed 192B1-added declaration baseline hash mismatch: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192B1-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostHandoverSqlAliasHash, `192B1 added Worker declaration changed: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(dailyWarehouseAdded)) {
    check(declarations.has(name), `192B2A added Worker declaration missing: ${name}`)
    const attentionContextChanged = attentionContextChanges[name]
    const acceptedPostAttentionContextHash = attentionContextChanged ? attentionContextChanged.after : expectedHash
    if (attentionContextChanged) check(attentionContextChanged.before === expectedHash, `192B2A2 changed 192B2A-added declaration baseline hash mismatch: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostAttentionContextHash, `192B2A4 changed 192B2A-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192B2A-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostAttentionContextHash, `192B2A added Worker declaration changed: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(attentionContextAdded)) {
    check(declarations.has(name), `192B2A2 added Worker declaration missing: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === expectedHash, `192B2A4 changed 192B2A2-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192B2A2-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === expectedHash, `192B2A2 added Worker declaration changed: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(orderCreateSaveIntegrityAdded)) {
    check(declarations.has(name), `192B2A4 added Worker declaration missing: ${name}`)
    check(sha(declarations.get(name)) === expectedHash, `192B2A4 added Worker declaration changed: ${name}`)
  }

  const graph = new Map(files.map((file) => [file, new Set()]))
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const target = resolveImport(file, match[1])
      if (!target || !graph.has(target)) continue
      check(target !== indexPath, `Worker domain imports composition root: ${path.relative(workerRoot, file)}`)
      graph.get(file).add(target)
    }
  }
  const visiting = new Set(), visited = new Set()
  function visit(node, chain = []) {
    if (visiting.has(node)) fail(`Circular Worker import: ${[...chain, node].map((file) => path.relative(workerRoot, file)).join(' -> ')}`)
    if (visited.has(node)) return
    visiting.add(node)
    for (const dep of graph.get(node) || []) visit(dep, [...chain, node])
    visiting.delete(node); visited.add(node)
  }
  for (const file of files) visit(file)

  const cleanupNote = cleanup ? `, ${removedNames.length} explicitly retired legacy declarations` : ''
  const boundaryNote = boundary ? `, ${Object.keys(boundaryChanges).length} exact 1906E boundary deltas` : ''
  const transferRuntimeNote = transferRuntime ? `, ${Object.keys(transferRuntimeChanges).length} exact 191D transfer-runtime delta` : ''
  const runtimeHardeningNote = runtimeHardening ? `, ${Object.keys(runtimeHardeningChanges).length} exact 191E runtime-hardening deltas` : ''
  const adminSessionIntegrityNote = adminSessionIntegrity ? `, ${Object.keys(adminSessionIntegrityChanges).length} exact 191F admin-session deltas` : ''
  const warehouseTruthFreshnessNote = warehouseTruthFreshness ? `, ${Object.keys(warehouseTruthFreshnessChanges).length} changed + ${Object.keys(warehouseTruthFreshnessAdded).length} added 192A1 warehouse-truth declarations` : ''
  const catalogTruthFinalizerNote = catalogTruthFinalizer ? `, ${Object.keys(catalogTruthFinalizerChanges).length} exact 192A2 catalog-truth delta` : ''
  const warehouseAttentionTruthNote = warehouseAttentionTruth ? `, ${Object.keys(warehouseAttentionTruthChanges).length} changed + ${Object.keys(warehouseAttentionTruthAdded).length} added 192B1 warehouse-truth declarations` : ''
  const dailyWarehouseNote = dailyWarehouse ? `, ${Object.keys(dailyWarehouseChanges).length} changed + ${Object.keys(dailyWarehouseAdded).length} added 192B2A daily-warehouse declarations` : ''
  const attentionContextNote = attentionContext ? `, ${Object.keys(attentionContextChanges).length} changed + ${Object.keys(attentionContextAdded).length} added 192B2A2 attention-context declarations` : ''
  const handoverSqlAliasSafetyNote = handoverSqlAliasSafety ? `, ${Object.keys(handoverSqlAliasSafetyChanges).length} exact 192B2A3 handover-SQL alias delta` : ''
  const orderCreateSaveIntegrityNote = orderCreateSaveIntegrity ? `, ${Object.keys(orderCreateSaveIntegrityChanges).length} changed + ${Object.keys(orderCreateSaveIntegrityAdded).length} added 192B2A4 order-save declarations` : ''
  console.log(`STEP 190.6A WORKER MODULARIZATION TESTS PASSED — ${files.length} TS files, ${declarations.size} preserved declarations${cleanupNote}${boundaryNote}${transferRuntimeNote}${runtimeHardeningNote}${adminSessionIntegrityNote}${warehouseTruthFreshnessNote}${catalogTruthFinalizerNote}${warehouseAttentionTruthNote}${dailyWarehouseNote}${attentionContextNote}${handoverSqlAliasSafetyNote}${orderCreateSaveIntegrityNote}, 0 import cycles`)
} catch (error) {
  console.error(`STEP 190.6A WORKER MODULARIZATION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

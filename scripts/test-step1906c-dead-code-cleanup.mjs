import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import {execFileSync} from 'node:child_process'

const root = process.cwd()
const manifestPath = path.join(root, 'scripts/step1906c-dead-code-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

function walk(dir, predicate = () => true) {
  const result = []
  if (!fs.existsSync(dir)) return result
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(full, predicate))
    else if (entry.isFile() && predicate(full)) result.push(full)
  }
  return result.sort()
}

function resolveModule(fromFile, specifier, fileSet) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = path.extname(base)
    ? [base]
    : [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => fileSet.has(candidate)) || null
}

function assertAllReachable(directory, entryRelative) {
  const files = walk(path.join(root, directory), (file) => /\.(ts|tsx)$/.test(file)).map((file) => path.resolve(file))
  const fileSet = new Set(files)
  const graph = new Map(files.map((file) => [file, []]))
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    for (const statement of source.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveModule(file, statement.moduleSpecifier.text, fileSet)
        if (target) graph.get(file).push(target)
      }
    }
    function visitDynamic(node) {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const target = resolveModule(file, node.arguments[0].text, fileSet)
        if (target) graph.get(file).push(target)
      }
      ts.forEachChild(node, visitDynamic)
    }
    ts.forEachChild(source, visitDynamic)
  }
  const entry = path.resolve(root, entryRelative)
  const reachable = new Set()
  function visit(file) {
    if (reachable.has(file) || !graph.has(file)) return
    reachable.add(file)
    for (const dep of graph.get(file)) visit(dep)
  }
  visit(entry)
  const unreachable = files.filter((file) => !reachable.has(file)).map((file) => path.relative(root, file).replaceAll('\\', '/'))
  check(unreachable.length === 0, `${directory}: unreachable runtime modules remain: ${unreachable.join(', ')}`)
  return files.length
}

try {
  check(fs.existsSync(manifestPath), '1906C cleanup manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  check(manifest?.version === 1 && manifest?.baseline === '1906b', '1906C cleanup manifest invalid')

  for (const relative of manifest.removedRuntimeFiles || []) check(!fs.existsSync(path.join(root, relative)), `Retired runtime file returned: ${relative}`)
  const srcFiles = assertAllReachable('src', 'src/main.tsx')
  const workerFiles = assertAllReachable('worker', 'worker/index.ts')

  const app = read('src/App.tsx')
  const types = read('src/app/types.ts')
  const constants = read('src/app/constants.ts')
  const utils = read('src/app/utils.ts')
  const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
  const worker = read('worker/index.ts')
  const workerTree = walk(path.join(root, 'worker'), (file) => file.endsWith('.ts')).map((file) => fs.readFileSync(file, 'utf8')).join('\n')

  for (const marker of ['legacyImportText','loadImportStatus','ImportHubRenderer','LEGACY_FOUNDATION_CONFIRM_TEXT','LegacyImportPreview','cleanupWorkingData']) check(!app.includes(marker), `Retired import UI symbol returned: ${marker}`)
  check(!types.includes("| 'import'"), 'AppSector still exposes retired import sector')
  check(!workspace.includes("title: 'Перенос данных'"), 'Retired import page title returned')
  for (const marker of ['LEGACY_TEST1_JSON_STORAGE_KEY','LEGACY_FOUNDATION_CONFIRM_TEXT','LEGACY_ORDERS_CONFIRM_TEXT','LEGACY_LEADS_PLANS_CONFIRM_TEXT','LEGACY_CATALOG_CLEANUP_CONFIRM_TEXT']) check(!constants.includes(marker), `Retired legacy constant returned: ${marker}`)
  for (const marker of ['readStoredLegacyImportText','storeLegacyImportText','normalizeConfirmText']) check(!utils.includes(marker), `Retired legacy helper returned: ${marker}`)

  for (const marker of ["/api/import/", 'rebuild-imported-test1', 'repair-imported', 'MIGRATION_ENABLED', 'handleLegacyFoundationImport', 'handleRebuildImportedWorkshopFromTest1']) check(!workerTree.includes(marker), `Retired Worker surface returned: ${marker}`)
  check(worker.includes("deadLegacyCleanup: '1906c'"), '1906C health marker missing')

  const rootFiles = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  const allowedInstaller = 'APPLY_STEP192B2A3_HANDOVER_SQL_ALIAS_RECOVERY.cmd'
  const allowedContext = 'CLOUDFLARE_CONTINUATION_CONTEXT_STEP192B2A3_HANDOVER_SQL_ALIAS_RECOVERY.md'
  const historicalRoot = rootFiles.filter((name) =>
    (name.startsWith('APPLY_STEP') && name !== allowedInstaller) ||
    name.startsWith('README_STEP') ||
    (/^STEP.*\.(?:txt|html|md)$/i.test(name)) ||
    (name.startsWith('CLOUDFLARE_CONTINUATION_CONTEXT_STEP') && name.endsWith('.md') && name !== allowedContext) ||
    (/^(?:FIX|AUTH|FINISH|DIAGNOSE|CHECK)_STEP\d.*\.cmd$/i.test(name)) ||
    (/^(?:CREATE|FINISH|REPAIR)_BRANCH2.*\.cmd$/i.test(name)) ||
    name === 'APPLY_LIGHT_FABRIC_AND_BRANCH2_TITLE_FIX.cmd' ||
    name === 'PROJECT_INTEGRITY.txt' || name === 'START_HERE.txt' || name === 'PACKAGE_SHA256.txt' ||
    /^BRANCH2_.*\.txt$/i.test(name) || /^README_BRANCH2.*\.txt$/i.test(name) ||
    /^README_LIGHT_FABRIC.*\.txt$/i.test(name) || /^LIGHT_FABRIC.*\.txt$/i.test(name) ||
    /^_branch2_.*\.html$/i.test(name) || /^apply-step\d+-files\.mjs$/i.test(name)
  )
  check(historicalRoot.length === 0, `Historical root artifacts remain: ${historicalRoot.join(', ')}`)

  const scriptNames = fs.readdirSync(path.join(root, 'scripts')).filter((name) => fs.statSync(path.join(root, 'scripts', name)).isFile())
  const historicalScripts = scriptNames.filter((name) => {
    if (name.startsWith('apply-step')) return true
    const match = /^(?:test-|verify-)?step(\d+)/.exec(name)
    return Boolean(match && Number(match[1]) <= 188)
  })
  check(historicalScripts.length === 0, `Historical step scripts remain: ${historicalScripts.join(', ')}`)
  for (const stale of ['verify-project.mjs','wrangler-direct.mjs','verify-manager-order-permissions.mjs','verify-branch2-initial-release.mjs']) {
    check(!scriptNames.includes(stale), `Stale verifier/runner returned: ${stale}`)
  }

  const packageJson = JSON.parse(read('package.json'))
  check(packageJson.scripts?.verify === 'npm run release:check', 'npm run verify must use the current release gate')
  check(packageJson.scripts?.['verify:db-safety'] === 'node scripts/verify-database-safety.mjs', 'Current database-safety command missing')

  const architectureDoc = read('docs/ARCHITECTURE.md')
  const cleanupDoc = read('docs/CLEANUP.md')
  const refactorDoc = read('docs/REFACTOR_REPORT.md')
  check(architectureDoc.includes('composition root') && architectureDoc.includes('Retired runtime'), 'Architecture documentation is stale after 190.6C')
  check(!architectureDoc.includes('worker/index.ts` пока содержит маршрутизацию, авторизацию, импорт'), 'Architecture documentation still describes the old Worker monolith')
  check(cleanupDoc.includes('migrations/*.sql') && cleanupDoc.includes('Не удаляем'), 'Cleanup policy must protect migration history')
  check(refactorDoc.includes('98 намеренно удалённых legacy declarations'), 'Refactor report does not document the exact 190.6C retirement baseline')

  const migrationDir = path.join(root, 'migrations')
  const migrationFiles = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()
  const acceptedAdditiveMigrations = ['0061_v72_warehouse_attention_truth_gates.sql', '0062_v72_d1_read_budget_r5_warehouse_indexes.sql', '0063_v72_d1_read_budget_r5_catalog_attention_index.sql', '0064_v72_d1_read_budget_r5_order_search_fts.sql', '0065_v72_d1_read_budget_r5_workshop_variant_order_index.sql', '0066_v72_d1_read_budget_r5_finance_summary_indexes.sql']
  acceptedAdditiveMigrations.push('0067_v72_o1_read_budget_indexes.sql')
  acceptedAdditiveMigrations.push('0068_v72_catalog_product_gender_scope.sql')
  acceptedAdditiveMigrations.push('0069_v72_return_exchange_physical_receipt.sql')
  acceptedAdditiveMigrations.push('0070_v72_stage01_canonical_order_search.sql')
  acceptedAdditiveMigrations.push('0071_v72_inventory_operation_evidence.sql')
  acceptedAdditiveMigrations.push('0072_v72_catalog_execution_prices.sql')
  acceptedAdditiveMigrations.push('0073_v72_order_item_pricing_foundation.sql')
  acceptedAdditiveMigrations.push('0074_v72_retained_order_pricing_mode.sql')
  acceptedAdditiveMigrations.push('0075_v72_zammler_workshop_due_time.sql')
  acceptedAdditiveMigrations.push('0076_v72_catalog_safe_retirement.sql')
  acceptedAdditiveMigrations.push('0077_v72_catalog_safe_restore.sql')
  acceptedAdditiveMigrations.push('0078_v72_catalog_restore_resumability.sql')
  acceptedAdditiveMigrations.push('0079_v72_catalog_granular_retirement_history.sql')
  acceptedAdditiveMigrations.push('0080_v72_auth_login_identity.sql')
  acceptedAdditiveMigrations.push('0081_v72_auth_hardening.sql')
  acceptedAdditiveMigrations.push('0082_v72_kaspi_order_payment_method.sql')
  // Exact, independently audited catalog/reference migrations. Stage04 0083/0084
  // intentionally remain absent; legacy historical snapshots are unchanged.
  acceptedAdditiveMigrations.push('0090_v72_catalog_variant_consolidations.sql')
  acceptedAdditiveMigrations.push('0091_v72_catalog_variant_stock_consolidation.sql')
  acceptedAdditiveMigrations.push('0092_v72_catalog_variant_reservation_consolidation.sql')
  acceptedAdditiveMigrations.push('0093_v72_reference_value_choice_merges.sql')
  acceptedAdditiveMigrations.push('0094_v72_reference_payment_method_merges.sql')
  acceptedAdditiveMigrations.push('0095_v72_catalog_stock_reconciliation_journal.sql')
  acceptedAdditiveMigrations.push('0096_v72_catalog_atomic_stock_finalization.sql')
  acceptedAdditiveMigrations.push('0097_v72_consolidated_sku_active_order_guard.sql')
  acceptedAdditiveMigrations.push('0098_v72_consolidated_sku_stock_guard.sql')
  acceptedAdditiveMigrations.push('0099_v72_catalog_merge_generation_events.sql')
  acceptedAdditiveMigrations.push('0100_v72_catalog_zero_stock_undo_validation.sql')
  acceptedAdditiveMigrations.push('0101_v72_catalog_zero_stock_remerge_validation.sql')
  acceptedAdditiveMigrations.push('0102_v72_catalog_positive_stock_undo_validation.sql')
  acceptedAdditiveMigrations.push('0103_v72_catalog_counted_undo_validation.sql')
  acceptedAdditiveMigrations.push('0104_v72_catalog_reserved_undo_validation.sql')
  acceptedAdditiveMigrations.push('0105_v72_reference_reason_choice_merges.sql')
  for(const [filename,expectedSha] of [
    ['0090_v72_catalog_variant_consolidations.sql','b4405429db17fbca0f7e212b3dd47cc6ca800ae8'],
    ['0091_v72_catalog_variant_stock_consolidation.sql','3bf9bf2496145aa19a919a3468d3fb3d0a13d1c7'],
    ['0092_v72_catalog_variant_reservation_consolidation.sql','894164a039a76abfdf8d7ac8a49109329b9bc66d'],
    ['0093_v72_reference_value_choice_merges.sql','d3afb62545f1cca2fc195244db13d42ac7b6471b'],
    ['0094_v72_reference_payment_method_merges.sql','fd6d34164f59ac3856b113701e47a81e681e95f7'],
    ['0095_v72_catalog_stock_reconciliation_journal.sql','0a35ae87effae25fd1e5d0d5befafd9aff0270f1'],
    ['0096_v72_catalog_atomic_stock_finalization.sql','0f6cde970b9cb535d28e762e4002a87820625a2e'],
    ['0097_v72_consolidated_sku_active_order_guard.sql','7e443eceb367cb1c7aa6ab795c22f3e2d19e0e1d'],
    ['0098_v72_consolidated_sku_stock_guard.sql','700db59c2b37e6db43f3b9a9dc378b44b96858c6'],
    ['0099_v72_catalog_merge_generation_events.sql','af2d04967b27f750384a62ba7513ff8ff17e69db'],
    ['0100_v72_catalog_zero_stock_undo_validation.sql','94937dd3b455e11742bc363ddfd267fc0c2dd466'],
    ['0101_v72_catalog_zero_stock_remerge_validation.sql','2750280cd66f4a8bf41aa19351fcd1a28fa0f1f3'],
    ['0102_v72_catalog_positive_stock_undo_validation.sql','9c26b192223a32d068d3e0e1cefebbe29959fdda'],
    ['0103_v72_catalog_counted_undo_validation.sql','ce925e9d87473a5490f4bbb5e9652d5c10d194e3'],
    ['0104_v72_catalog_reserved_undo_validation.sql','5a03ea7ab8bc51afe90b18de502e2053b427c90d'],
    ['0105_v72_reference_reason_choice_merges.sql','6a3314e903349049740ccbe661f60f896a6e8a5b']
  ]){
    const actualSha=execFileSync('git',['hash-object','migrations/'+filename],{encoding:'utf8'}).trim()
    check(actualSha===expectedSha,'Reference migration changed: '+filename)
  }
  check(!migrationFiles.some(x=>/^008[34]_/.test(x)), 'Stage04 is out of scope')

  const historicalMigrationFiles = migrationFiles.filter((name) => !acceptedAdditiveMigrations.includes(name))
  const aggregate = historicalMigrationFiles.map((name) => `${sha(fs.readFileSync(path.join(migrationDir, name)))}  migrations/${name}\n`).join('')
  check(historicalMigrationFiles.length === manifest.migrationCount, `Historical migration count changed: ${historicalMigrationFiles.length}/${manifest.migrationCount}`)
  check(sha(aggregate) === manifest.migrationAggregateHash, 'Historical migration content changed after 190.6C')
  check(migrationFiles.length === manifest.migrationCount + acceptedAdditiveMigrations.length, `Unexpected migration file count: ${migrationFiles.length}`)
  for (const name of acceptedAdditiveMigrations) check(migrationFiles.includes(name), `Accepted additive migration missing: ${name}`)
  const physicalReceiptMigration = read('migrations/0069_v72_return_exchange_physical_receipt.sql')
  const physicalReceiptStatements = physicalReceiptMigration
    .replace(/^\s*--.*$/gm, ' ')
    .split(';')
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const physicalReceiptAllow = [
    /^PRAGMA foreign_keys = ON$/i,
    /^ALTER TABLE return_items ADD COLUMN physical_tracking INTEGER NOT NULL DEFAULT 0 CHECK \(physical_tracking IN \(0, 1\)\)$/i,
    /^ALTER TABLE return_items ADD COLUMN physical_received_at TEXT$/i,
    /^ALTER TABLE exchange_items ADD COLUMN physical_tracking INTEGER NOT NULL DEFAULT 0 CHECK \(physical_tracking IN \(0, 1\)\)$/i,
    /^ALTER TABLE exchange_items ADD COLUMN physical_received_at TEXT$/i,
    /^CREATE INDEX IF NOT EXISTS idx_return_items_physical_receipt ON return_items\(physical_tracking, physical_received_at, return_id\)$/i,
    /^CREATE INDEX IF NOT EXISTS idx_exchange_items_physical_receipt ON exchange_items\(role, physical_tracking, physical_received_at, exchange_id\)$/i,
  ]
  check(physicalReceiptStatements.length === physicalReceiptAllow.length, `0069: expected ${physicalReceiptAllow.length} scoped statements, found ${physicalReceiptStatements.length}`)
  physicalReceiptStatements.forEach((statement, index) => check(physicalReceiptAllow[index].test(statement), `0069 statement ${index + 1} widened beyond physical receipt scope`))
  check(!/\barrival\b/i.test(physicalReceiptMigration), '0069 must not touch Arrival')
  check(!/\b(?:orders|payments|workshop_tasks|inventory_stock)\b/i.test(physicalReceiptMigration), '0069 widened into unrelated business tables')
  const catalogGenderMigrationManifest = JSON.parse(read('scripts/catalog-gender-scope-r1-migration-manifest.json'))
  check(catalogGenderMigrationManifest?.version === 1 && catalogGenderMigrationManifest?.revision === 'catalog-gender-scope-r1', 'Catalog gender migration manifest invalid')
  check(catalogGenderMigrationManifest.file === 'migrations/0068_v72_catalog_product_gender_scope.sql', 'Catalog gender migration manifest file widened unexpectedly')
  const catalogGenderMigrationBytes = Buffer.from(read(catalogGenderMigrationManifest.file))
  const catalogGenderMigrationGitBlob = crypto.createHash('sha1').update(Buffer.from('blob ' + catalogGenderMigrationBytes.length + '\0')).update(catalogGenderMigrationBytes).digest('hex')
  check(catalogGenderMigrationGitBlob === catalogGenderMigrationManifest.gitBlob, 'Accepted catalog gender migration changed beyond exact manifest')

  const ARRIVAL_START = '<div className="inventory-arrival-legacy-workspace">'
  const ARRIVAL_END = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
  const inventorySource = walk(path.join(root, 'src', 'features', 'inventory'), (file) => /\.(ts|tsx)$/.test(file)).map((file) => fs.readFileSync(file, 'utf8')).join('\n') + '\n' + read('src/features/sections/InventorySection.tsx')
  const start = inventorySource.indexOf(ARRIVAL_START), end = inventorySource.indexOf(ARRIVAL_END, start)
  check(start >= 0 && end >= 0, 'Frozen Arrival block missing')
  check(sha(inventorySource.slice(start, end + ARRIVAL_END.length)) === 'd8806f8f7971d6ee5c4c656d5cdf1551297ecc6ad01cc84730b16c3153bd05bf', 'Frozen Arrival block changed')

  console.log(`STEP 190.6C DEAD / DORMANT / LEGACY CLEANUP TESTS PASSED — ${srcFiles} reachable frontend TS/TSX files, ${workerFiles} reachable Worker TS files, ${Object.keys(manifest.removedWorkerDeclarations || {}).length} legacy Worker declarations retired, migration history preserved`)
} catch (error) {
  console.error(`STEP 190.6C DEAD / DORMANT / LEGACY CLEANUP TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

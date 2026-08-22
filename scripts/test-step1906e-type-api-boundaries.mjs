import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(root, relative))

function walk(dir) {
  const result = []
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.posix.join(dir.replaceAll('\\', '/'), entry.name)
    if (entry.isDirectory()) result.push(...walk(relative))
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) result.push(relative)
  }
  return result.sort()
}

function exportedTypeNames(relative) {
  const text = read(relative)
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = new Set()
  for (const statement of source.statements) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) names.add(statement.name.text)
  }
  return names
}

try {
  const contractFile = 'shared/api-contracts.ts'
  check(exists(contractFile), 'Shared API contract module missing')
  const contractText = read(contractFile)
  const contractNames = exportedTypeNames(contractFile)
  for (const name of [
    'ApiOkResponse', 'InventorySource', 'CatalogResolutionContext', 'CatalogResolutionInput', 'CatalogResolutionResponse',
    'InventoryReservation', 'InventoryReservationsResponse', 'InventoryStocktakeSession', 'InventoryStocktakeSessionsResponse',
    'InventoryStocktakeMutationResponse', 'InventoryCycleCountSuggestionsResponse', 'InventoryCycleCountApplyResponse',
  ]) check(contractNames.has(name), `Shared API contract missing: ${name}`)
  check(!/\bany\b/.test(contractText), 'Shared API contracts must not use any')

  const app = read('src/App.tsx')
  check(app.includes("from '../shared/api-contracts.ts'"), 'Frontend does not consume shared API contracts')
  check(!app.includes('readJsonResponse<any>'), 'App returned to untyped readJsonResponse<any>')
  check(!app.includes('createFields as any') && !app.includes('(input as any).createFields'), 'Catalog/lifecycle request boundary returned to any cast')
  check(!/reservations:\s*\[\]\s+as\s+any\[\]/.test(app), 'Reservation empty result returned to any[]')

  const srcFiles = walk('src')
  for (const relative of srcFiles) {
    const text = read(relative)
    check(!text.includes('readJsonResponse<any>'), `${relative}: untyped API response boundary returned`)
    check(!/\bresponse\.json\s*\(/.test(text), `${relative}: direct response.json() bypasses centralized API reader`)
  }

  const utils = read('src/app/utils.ts')
  check(utils.includes('readJsonResponse<T extends object = Record<string, unknown>>'), 'Frontend JSON reader lost object-bounded generic')
  check(utils.includes("typeof data !== 'object'") && utils.includes('Array.isArray(data)'), 'Frontend JSON reader no longer rejects primitive/array envelopes')
  check(!utils.includes('JSON.parse(trimmed) as T'), 'Frontend JSON reader casts before validating envelope shape')

  const http = read('worker/core/http.ts')
  check(http.includes('readJson<T extends object = Record<string, unknown>>'), 'Worker JSON reader lost object-bounded generic')
  check(http.includes("typeof value !== 'object'") && http.includes('Array.isArray(value)'), 'Worker JSON ingress no longer rejects primitive/array payloads')
  check(!http.includes('(error as any)'), 'Worker public error mapping returned to unsafe any cast')

  const workerContractConsumers = [
    'worker/domains/catalog-review.ts',
    'worker/domains/lifecycle.ts',
    'worker/domains/inventory-reservations.ts',
    'worker/domains/inventory-stocktake.ts',
  ]
  for (const relative of workerContractConsumers) {
    const text = read(relative)
    check(text.includes('shared/api-contracts.ts'), `${relative}: shared contract import missing`)
    check(text.includes('import type '), `${relative}: shared contract must stay type-only at runtime`)
  }

  const critical = read('worker/domains/critical.ts')
  for (const forbidden of ['cachedResponse: any', 'stableJsonValue(value: any)', 'Record<string, any>']) {
    check(!critical.includes(forbidden), `Critical-operation serialization boundary returned to unsafe type: ${forbidden}`)
  }
  check(critical.includes('cachedResponse: unknown | null'), 'Critical-operation cached response is not unknown-first')
  check(critical.includes('stableJsonValue(value: unknown): unknown'), 'Critical-operation stable JSON serializer is not unknown-first')

  const inventoryController = read('src/features/sections/InventorySection.tsx')
  check(!inventoryController.includes('@ts-nocheck'), 'Inventory controller is no longer fully TypeScript checked')
  check(inventoryController.includes('InventoryStocktakeSession | null'), 'Inventory stocktake API state is not contract-typed')
  check(inventoryController.includes('InventoryReservation[]'), 'Inventory reservation API state is not contract-typed')

  const renderFiles = fs.readdirSync(path.join(root, 'src/features/inventory/views'))
    .filter((name) => /^render.*\.tsx$/.test(name))
    .sort()
  const dailyWarehouse = exists('scripts/step192b2a-daily-warehouse-manifest.json')
  const expectedRenderBoundaries = dailyWarehouse ? 11 : 10
  check(renderFiles.length === expectedRenderBoundaries, `Expected ${expectedRenderBoundaries} inventory render boundaries, found ${renderFiles.length}`)
  if (dailyWarehouse) check(renderFiles.includes('renderInventoryAttentionPanel.tsx'), '192B2A Attention render boundary missing')
  for (const name of renderFiles) {
    const relative = `src/features/inventory/views/${name}`
    const text = read(relative)
    check(text.includes('type PanelContext = Pick<InventoryRenderContext,'), `${name}: renderer boundary is not an explicit Pick<>`)
    check(/function\s+\w+\(ctx:\s*PanelContext\)/.test(text), `${name}: renderer does not consume its narrow PanelContext`)
    check(!text.includes('@ts-nocheck'), `${name}: renderer disables TypeScript checking`)
  }

  const manifest = JSON.parse(read('scripts/step1906e-type-boundary-manifest.json'))
  check(manifest?.version === 1 && manifest?.baseline === '1906d', '1906E declaration delta manifest invalid')
  check(Object.keys(manifest.changes || {}).length === 17, `Expected 17 exact Worker boundary declaration deltas, found ${Object.keys(manifest.changes || {}).length}`)

  const releaseCheck = read('scripts/release-check.mjs')
  check(releaseCheck.includes("[tsc, '-b', '--force', '--pretty', 'false']"), 'Release gate must force TypeScript project rebuild; stale tsbuildinfo can hide boundary errors')

  const worker = read('worker/index.ts')
  check(worker.includes("typeApiBoundaryCleanup: '1906e'"), '1906E live health marker missing')

  console.log(`STEP 190.6E TYPE / API BOUNDARY TESTS PASSED — ${contractNames.size} shared contract types, 0 readJsonResponse<any>, Inventory controller under TypeScript, ${renderFiles.length} narrow inventory panel contexts, 17 exact Worker boundary deltas`)
} catch (error) {
  console.error(`STEP 190.6E TYPE / API BOUNDARY TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

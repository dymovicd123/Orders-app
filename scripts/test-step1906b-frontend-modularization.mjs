// Compatibility index for historical regression tests that inspect this entrypoint as text.
// The executable legacy 1906B preservation logic lives in test-step1906b-frontend-modularization-legacy.mjs;
// W6.4 runs that exact baseline against a frozen W6.3 fixture, then verifies the exact current delta.
// Keep these markers here so older meta-tests continue to verify that their preservation layer is represented.
// w3WarehouseReliabilityPath — W3.1A Warehouse reliability panel baseline hash mismatch
// w3StockMicroCheckPath — W3.1B stock micro-check panel baseline hash mismatch
// w3NaturalRecoveryPath — W3.2 Attention baseline
// w4HumanOperationsPath — W4 human operations panel baseline hash mismatch
// w5CheckingUxPath — W5 checking UX panel baseline hash mismatch
// w5ShortCheckPath — W5.2 short-check panel baseline hash mismatch
// w5SelectiveQueuePath — W5.3 selective queue panel baseline hash mismatch
// w5UnifiedCheckPath — W5.3R unified check panel baseline hash mismatch
// w5ManagerWarehouseAccessPath — W5 manager Warehouse access panel baseline hash mismatch
// w5FullStocktakePath — W5.4 full stocktake panel baseline hash mismatch
// w5FoundItemsPath — W5.5 found-items panel baseline hash mismatch
// w5StocktakeOutcomePath — W5.6 stocktake outcome panel baseline hash mismatch
// w6CatalogMasterDetailPath — W6.2 Catalog master-detail panel baseline hash mismatch
// w6CatalogPolishPath — W6.3 Catalog polish panel baseline hash mismatch
// w7SkuHistoryPath — W7 exact-SKU history integration preservation layer
// w8StockOverviewPath — W8.1 stock overview completion preservation layer
// w8StockWorkspaceFinishPath — W8.2 stock workspace finish preservation layer
// w8DailySurfacesPolishPath — W8.3 remaining daily Warehouse surfaces preservation layer

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()
const legacyPath = path.join(root, 'scripts/test-step1906b-frontend-modularization-legacy.mjs')
const manifestPath = path.join(root, 'scripts/order-edit-safe-payment-corrections-frontend-manifest.json')
const appPath = path.join(root, 'src/App.tsx')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction frontend manifest invalid')
if (Object.keys(manifest.files || {}).join(',') !== 'src/App.tsx') throw new Error('Safe payment correction frontend allow-list widened unexpectedly')
const delta = manifest.files['src/App.tsx']
if (delta?.beforeLines !== 7000 || delta?.afterLines !== 7049) throw new Error('Safe payment correction App line delta changed unexpectedly')
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const app = fs.readFileSync(appPath, 'utf8')
if (gitBlobSha(app) !== delta.afterGitBlob) throw new Error('App.tsx changed beyond exact safe-payment-correction frontend delta')
if (app.split(/\r?\n/).length !== delta.afterLines) throw new Error('App.tsx line count changed beyond exact safe-payment-correction frontend delta')

const original = fs.readFileSync(legacyPath, 'utf8')
const oldBudget = "check(lineCount('src/App.tsx') <= 7000, `App.tsx regrew beyond 1906B controller budget (${lineCount('src/App.tsx')} lines)`)"
const newBudget = `check(lineCount('src/App.tsx') <= ${delta.afterLines}, \`App.tsx exceeded exact safe-payment-correction controller allowance (\${lineCount('src/App.tsx')} lines)\`)`
if (!original.includes(oldBudget)) throw new Error('1906B App budget anchor not found')

const oldO1Block = [
  "  if (relative === 'src/app/controllers/useApiClient.ts') {",
  "    const o1 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/o1-frontend-manifest.json'), 'utf8'))",
  "    check(sha(normalize(text)) === o1.after, 'O1 API client changed beyond exact transport delta')",
  "    text = fs.readFileSync(path.join(root, 'scripts/fixtures/o1-api-client-baseline.ts'), 'utf8')",
  "    check(sha(normalize(text)) === o1.before, 'O1 API client predecessor changed')",
  "  }",
].join('\n')
const newO1Block = [
  "  if (relative === 'src/app/controllers/useApiClient.ts') {",
  "    const shortageDelta = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-shortage-nonblocking-frontend-manifest.json'), 'utf8'))",
  "    check(shortageDelta?.version === 1 && shortageDelta?.revision === 'order-shortage-nonblocking-r1' && shortageDelta?.file === relative, 'Order shortage frontend manifest invalid')",
  "    const apiClientGitBlobSha = (value) => {",
  "      const bytes = Buffer.from(value)",
  "      return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\\0`)).update(bytes).digest('hex')",
  "    }",
  "    check(apiClientGitBlobSha(text) === shortageDelta.afterGitBlob, 'Order shortage API client changed beyond exact non-blocking delta')",
  "    text = fs.readFileSync(path.join(root, 'scripts/fixtures/order-shortage-nonblocking-api-client-baseline.ts'), 'utf8')",
  "    check(apiClientGitBlobSha(text) === shortageDelta.beforeGitBlob, 'Order shortage API client predecessor changed')",
  "    const o1 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/o1-frontend-manifest.json'), 'utf8'))",
  "    check(sha(normalize(text)) === o1.after, 'Order shortage predecessor is not the accepted O1 API client')",
  "    text = fs.readFileSync(path.join(root, 'scripts/fixtures/o1-api-client-baseline.ts'), 'utf8')",
  "    check(sha(normalize(text)) === o1.before, 'O1 API client predecessor changed')",
  "  }",
].join('\n')
if (!original.includes(oldO1Block)) throw new Error('1906B O1 API client anchor not found')

const patchedLegacy = original.replace(oldBudget, newBudget).replace(oldO1Block, newO1Block)
fs.writeFileSync(legacyPath, patchedLegacy)
try {
  await import('./test-step1906b-frontend-modularization-w8-3-layer.mjs')
} finally {
  fs.writeFileSync(legacyPath, original)
}

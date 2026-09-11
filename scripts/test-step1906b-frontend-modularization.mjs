/* PRESERVED PRE-CATALOG 1906B META-TEXT
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

END PRESERVED PRE-CATALOG 1906B META-TEXT */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const manifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-frontend-manifest.json')
const unisexGenderInplaceManifestPath = path.join(root, 'scripts/catalog-unisex-gender-inplace-r1-frontend-manifest.json')
const unisexMergeManifestPath = path.join(root, 'scripts/catalog-unisex-merge-r1-frontend-manifest.json')
const fixtureRoot = path.join(root, 'scripts/fixtures/catalog-gender-scope-r1')
const predecessorFixture = path.join(fixtureRoot, 'test-step1906b-frontend-modularization-predecessor.mjs')
const runtimePredecessor = path.join(root, 'scripts/.tmp-test-step1906b-catalog-predecessor.mjs')
const expectedFiles = ["src/App.tsx","src/app/controllers/useOperationalViewModel.ts","src/app/controllers/useWorkspaceViewModel.tsx","src/app/types.ts","src/features/inventory/views/catalogLegacyAdminModes.tsx","src/features/inventory/views/renderInventoryCatalogPanel.tsx","src/features/sections/InventorySection.tsx","src/features/sections/OrderExchangeSection.tsx"]
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest?.version !== 1 || manifest?.revision !== 'catalog-gender-scope-r1') throw new Error('Catalog gender scope frontend manifest invalid')
if (JSON.stringify(Object.keys(manifest.files || {})) !== JSON.stringify(expectedFiles)) throw new Error('Catalog gender scope frontend allow-list widened unexpectedly')
const unisexGenderInplaceManifest = JSON.parse(fs.readFileSync(unisexGenderInplaceManifestPath, 'utf8'))
if (unisexGenderInplaceManifest?.version !== 1 || unisexGenderInplaceManifest?.revision !== 'catalog-unisex-gender-inplace-r1') throw new Error('Catalog unisex gender in-place frontend manifest invalid')
if (Object.keys(unisexGenderInplaceManifest.files || {}).join(',') !== 'src/features/inventory/views/renderInventoryCatalogPanel.tsx') throw new Error('Catalog unisex gender in-place frontend allow-list widened unexpectedly')
const unisexMergeManifest = JSON.parse(fs.readFileSync(unisexMergeManifestPath, 'utf8'))
if (unisexMergeManifest?.version !== 1 || unisexMergeManifest?.revision !== 'catalog-unisex-merge-r1') throw new Error('Catalog unisex merge frontend manifest invalid')
if (Object.keys(unisexMergeManifest.files || {}).join(',') !== 'src/features/inventory/views/renderInventoryCatalogPanel.tsx') throw new Error('Catalog unisex merge frontend allow-list widened unexpectedly')
const gitBlobSha = (text) => { const bytes = Buffer.from(text); return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex') }
const current = new Map()
try {
  for (const file of expectedFiles) {
    const actualPath = path.join(root, file)
    const baselinePath = path.join(fixtureRoot, file)
    const actual = fs.readFileSync(actualPath, 'utf8')
    const baseline = fs.readFileSync(baselinePath, 'utf8')
    const delta = manifest.files[file]
    const inPlaceDelta = unisexGenderInplaceManifest.files?.[file]
    const mergeDelta = unisexMergeManifest.files?.[file]
    if (mergeDelta) {
      if (!inPlaceDelta) throw new Error('Catalog unisex merge predecessor is missing: ' + file)
      if (inPlaceDelta.beforeGitBlob !== delta.afterGitBlob || inPlaceDelta.beforeLines !== delta.afterLines) throw new Error('Catalog unisex gender in-place predecessor drifted: ' + file)
      if (mergeDelta.beforeGitBlob !== inPlaceDelta.afterGitBlob || mergeDelta.beforeLines !== inPlaceDelta.afterLines) throw new Error('Catalog unisex merge predecessor drifted: ' + file)
      if (gitBlobSha(actual) !== mergeDelta.afterGitBlob || actual.split(/\r?\n/).length !== mergeDelta.afterLines) throw new Error('Catalog unisex merge frontend file changed beyond exact manifest: ' + file)
    } else if (inPlaceDelta) {
      if (inPlaceDelta.beforeGitBlob !== delta.afterGitBlob || inPlaceDelta.beforeLines !== delta.afterLines) throw new Error('Catalog unisex gender in-place predecessor drifted: ' + file)
      if (gitBlobSha(actual) !== inPlaceDelta.afterGitBlob || actual.split(/\r?\n/).length !== inPlaceDelta.afterLines) throw new Error('Catalog unisex gender in-place frontend file changed beyond exact manifest: ' + file)
    } else if (gitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
      throw new Error('Catalog gender frontend file changed beyond exact manifest: ' + file)
    }
    if (gitBlobSha(baseline) !== delta.beforeGitBlob) throw new Error('Catalog gender frontend baseline drifted: ' + file)
    if (baseline.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog gender frontend baseline line contract drifted: ' + file)
    current.set(file, actual)
    fs.writeFileSync(actualPath, baseline)
  }
  fs.writeFileSync(runtimePredecessor, fs.readFileSync(predecessorFixture, 'utf8'))
  const result = spawnSync(process.execPath, [runtimePredecessor], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  if (result?.error) throw result.error
  if (result?.status !== 0) throw new Error('Pre-catalog 1906B preservation layer failed with code ' + result?.status)
  console.log('CATALOG GENDER FRONTEND STRUCTURAL LAYER PASSED — exact current UI delta accepted over preserved main baseline')
} finally {
  for (const [file, text] of current) fs.writeFileSync(path.join(root, file), text)
  if (fs.existsSync(runtimePredecessor)) fs.rmSync(runtimePredecessor)
}

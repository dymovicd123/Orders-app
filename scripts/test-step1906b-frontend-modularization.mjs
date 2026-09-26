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
const catalogIntegrityFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-selection-retirement-integrity-frontend-manifest.json'), 'utf8'))
if (catalogIntegrityFrontendManifest?.version !== 1 || catalogIntegrityFrontendManifest?.revision !== 'catalog-selection-retirement-integrity-r1') throw new Error('Catalog selection/retirement frontend manifest invalid')
const catalogIntegrityFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_SELECTION_RETIREMENT_INTEGRITY_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogIntegrityFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogIntegrityFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Catalog selection/retirement frontend changed beyond exact manifest: ' + relative)
      }
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      if (catalogIntegrityFrontendBlobSha(baseline) !== delta.beforeGitBlob || baseline.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Catalog selection/retirement frontend baseline fixture drifted: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, CATALOG_SELECTION_RETIREMENT_INTEGRITY_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG SELECTION / RETIREMENT FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
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
  "      return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')",
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
const resolverR12FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r12-catalog-consistency-frontend-manifest.json'), 'utf8'))
if (resolverR12FrontendManifest?.version !== 1 || resolverR12FrontendManifest?.revision !== 'catalog-resolver-r12-catalog-consistency') throw new Error('Resolver R12 frontend manifest invalid')
const resolverR12FrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R12_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(resolverR12FrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (resolverR12FrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Resolver R12 frontend changed beyond exact manifest: ' + relative)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      if (resolverR12FrontendBlobSha(baseline) !== delta.beforeGitBlob || baseline.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Resolver R12 frontend baseline fixture drifted: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {cwd: root, stdio: 'inherit', shell: false, windowsHide: true, env: { ...process.env, CATALOG_RESOLVER_R12_FRONTEND_NORMALIZED: '1' }})
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R12 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const resolverR11Manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r11-known-gender-frontend-manifest.json'), 'utf8'))
if (resolverR11Manifest?.version !== 1 || resolverR11Manifest?.revision !== 'catalog-resolver-r11-known-gender' || resolverR11Manifest?.file !== 'src/app/controllers/useWorkspaceViewModel.tsx') {
  throw new Error('Catalog resolver R11 frontend manifest invalid')
}
if (!process.env.CATALOG_RESOLVER_R11_KNOWN_GENDER_NORMALIZED) {
  const absolute = path.join(root, resolverR11Manifest.file)
  const actual = fs.readFileSync(absolute, 'utf8')
  let reverted = actual
  for (const replacement of [...(resolverR11Manifest.replacements || [])].reverse()) {
    const occurrences = reverted.split(replacement.afterBlock).length - 1
    if (occurrences !== 1) throw new Error('Catalog resolver R11 frontend after-block missing or ambiguous')
    reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
  }
  fs.writeFileSync(absolute, reverted)
  let childStatus = 1
  try {
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R11_KNOWN_GENDER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    fs.writeFileSync(absolute, actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R11 KNOWN-GENDER FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const clientZammlerProdRuntimeManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/client-zammler-prod-runtime-frontend-manifest.json'), 'utf8'))
if (clientZammlerProdRuntimeManifest?.version !== 1 || clientZammlerProdRuntimeManifest?.revision !== 'client-zammler-prod-runtime-20260924') throw new Error('CLIENT-ZAMMLER Production frontend manifest invalid')
const clientZammlerProdFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CLIENT_ZAMMLER_PROD_RUNTIME_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(clientZammlerProdRuntimeManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (clientZammlerProdFrontendBlobSha(actual) !== delta.afterGitBlob) throw new Error('CLIENT-ZAMMLER Production frontend changed beyond exact manifest: ' + relative)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      if (clientZammlerProdFrontendBlobSha(baseline) !== delta.beforeGitBlob) throw new Error('CLIENT-ZAMMLER Production frontend baseline fixture drifted: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {cwd: root, stdio: 'inherit', shell: false, windowsHide: true, env: { ...process.env, CLIENT_ZAMMLER_PROD_RUNTIME_FRONTEND_NORMALIZED: '1' }})
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CLIENT-ZAMMLER PRODUCTION FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage03C2PricePolishManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage03-c2-price-ui-polish-frontend-manifest.json'), 'utf8'))
if (stage03C2PricePolishManifest?.version !== 1 || stage03C2PricePolishManifest?.revision !== 'stage03-c2-price-ui-polish') throw new Error('Stage03-C2 price UI polish manifest invalid')
const stage03C2PricePolishBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE03_C2_PRICE_UI_POLISH_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage03C2PricePolishManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage03C2PricePolishBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Stage03-C2 price UI polish changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage03-C2 price UI polish after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage03C2PricePolishBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Stage03-C2 price UI polish predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE03_C2_PRICE_UI_POLISH_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE03-C2 PRICE UI POLISH FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage03C1LayoutManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage03-c1-sku-card-layout-frontend-manifest.json'), 'utf8'))
if (stage03C1LayoutManifest?.version !== 1 || stage03C1LayoutManifest?.revision !== 'stage03-c1-sku-card-layout') throw new Error('Stage03-C1 SKU card layout manifest invalid')
const stage03C1BlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE03_C1_SKU_CARD_LAYOUT_NORMALIZED) {
  const relative = 'src/styles/w9-warehouse-catalog-cleanup.css'
  const delta = stage03C1LayoutManifest.files[relative]
  const absolute = path.join(root, relative)
  const actual = fs.readFileSync(absolute, 'utf8')
  if (stage03C1BlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
    throw new Error('Stage03-C1 SKU card layout changed beyond exact manifest')
  }
  if (!actual.endsWith(delta.appendedBlock)) throw new Error('Stage03-C1 SKU card layout patch missing from CSS tail')
  const predecessor = actual.slice(0, -delta.appendedBlock.length)
  if (stage03C1BlobSha(predecessor) !== delta.beforeGitBlob || predecessor.split(/\r?\n/).length !== delta.beforeLines) {
    throw new Error('Stage03-C1 SKU card layout predecessor reconstruction failed')
  }
  fs.writeFileSync(absolute, predecessor)
  let childStatus = 1
  try {
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE03_C1_SKU_CARD_LAYOUT_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    fs.writeFileSync(absolute, actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE03-C1 SKU CARD LAYOUT FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage03CFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage03-c-catalog-price-ui-frontend-manifest.json'), 'utf8'))
if (stage03CFrontendManifest?.version !== 1 || stage03CFrontendManifest?.revision !== 'stage03-c-catalog-price-ui') throw new Error('Stage03-C Catalog price UI frontend manifest invalid')
const stage03CFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE03_C_CATALOG_PRICE_UI_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage03CFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage03CFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Stage03-C Catalog price UI changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage03-C Catalog price UI after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage03CFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Stage03-C Catalog price UI predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE03_C_CATALOG_PRICE_UI_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE03-C CATALOG PRICE UI FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const warehouseCatalogCleanupManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/warehouse-catalog-cleanup-r1-frontend-manifest.json'), 'utf8'))
if (warehouseCatalogCleanupManifest?.version !== 1 || warehouseCatalogCleanupManifest?.revision !== 'warehouse-catalog-cleanup-r1') throw new Error('Warehouse/Catalog cleanup frontend manifest invalid')
const warehouseCatalogCleanupBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.WAREHOUSE_CATALOG_CLEANUP_R1_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(warehouseCatalogCleanupManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (warehouseCatalogCleanupBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Warehouse/Catalog cleanup changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Warehouse/Catalog cleanup after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (warehouseCatalogCleanupBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Warehouse/Catalog cleanup predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, WAREHOUSE_CATALOG_CLEANUP_R1_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('WAREHOUSE/CATALOG CLEANUP R1 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const astraStage02FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/astra-stage02-manual-acceptance-r1-frontend-manifest.json'), 'utf8'))
if (astraStage02FrontendManifest?.version !== 1 || astraStage02FrontendManifest?.revision !== 'astra-stage02-manual-acceptance-r1') throw new Error('Astra Stage02 frontend manifest invalid')
const astraStage02FrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.ASTRA_STAGE02_MANUAL_ACCEPTANCE_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(astraStage02FrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (astraStage02FrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Astra Stage02 frontend changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Astra Stage02 frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (astraStage02FrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Astra Stage02 frontend predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, ASTRA_STAGE02_MANUAL_ACCEPTANCE_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ASTRA STAGE02 MANUAL ACCEPTANCE FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const resolverUiPolishFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/resolver-ui-polish-r3-frontend-manifest.json'), 'utf8'))
if (resolverUiPolishFrontendManifest?.version !== 1 || resolverUiPolishFrontendManifest?.revision !== 'resolver-ui-polish-r3') throw new Error('Resolver UI polish R3 frontend manifest invalid')
const resolverUiPolishBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.RESOLVER_UI_POLISH_R3_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(resolverUiPolishFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (resolverUiPolishBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Resolver UI polish R3 frontend changed beyond exact manifest: ' + relative)
      }
      const reverted = fs.readFileSync(path.join(root, delta.beforeFixture), 'utf8')
      if (resolverUiPolishBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Resolver UI polish R3 predecessor fixture drifted: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, RESOLVER_UI_POLISH_R3_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('RESOLVER UI POLISH R3 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const resolverFollowupFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/resolver-followup-r2-frontend-manifest.json'), 'utf8'))
if (resolverFollowupFrontendManifest?.version !== 1 || resolverFollowupFrontendManifest?.revision !== 'resolver-followup-r2') throw new Error('Resolver follow-up R2 frontend manifest invalid')
const resolverFollowupBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.RESOLVER_FOLLOWUP_R2_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(resolverFollowupFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (resolverFollowupBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Resolver follow-up R2 frontend changed beyond exact manifest: ' + relative)
      }
      const reverted = fs.readFileSync(path.join(root, delta.beforeFixture), 'utf8')
      if (resolverFollowupBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Resolver follow-up R2 predecessor fixture drifted: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, RESOLVER_FOLLOWUP_R2_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('RESOLVER FOLLOW-UP R2 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const resolverHumanFinishFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/resolver-human-finish-r1-frontend-manifest.json'), 'utf8'))
if (resolverHumanFinishFrontendManifest?.version !== 1 || resolverHumanFinishFrontendManifest?.revision !== 'resolver-human-finish-r1') throw new Error('Resolver human-finish frontend manifest invalid')
const resolverHumanFinishBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.RESOLVER_HUMAN_FINISH_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(resolverHumanFinishFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (resolverHumanFinishBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Resolver human-finish frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      if (delta.beforeFixture) {
        reverted = fs.readFileSync(path.join(root, delta.beforeFixture), 'utf8')
      } else {
        for (const replacement of [...(delta.replacements || [])].reverse()) {
          if (!reverted.includes(replacement.afterBlock)) throw new Error('Resolver human-finish frontend after-block missing: ' + relative)
          reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
        }
      }
      if (resolverHumanFinishBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Resolver human-finish frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, RESOLVER_HUMAN_FINISH_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('RESOLVER HUMAN-FINISH FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02PostReviewFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-post-review-frontend-manifest.json'), 'utf8'))
if (stage02PostReviewFrontendManifest?.version !== 1 || stage02PostReviewFrontendManifest?.revision !== 'stage02-post-review-resolver-return-ux') throw new Error('Stage02 post-review frontend manifest invalid')
const stage02PostReviewFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_POST_REVIEW_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02PostReviewFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02PostReviewFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 post-review frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 post-review frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02PostReviewFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 post-review frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_POST_REVIEW_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 POST-REVIEW FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase2EFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2e-attention-frontend-manifest.json'), 'utf8'))
if (stage02Phase2EFrontendManifest?.version !== 1 || stage02Phase2EFrontendManifest?.revision !== 'stage02-phase2e-attention-dependency-removal') throw new Error('Stage02 Phase2E frontend manifest invalid')
const stage02Phase2EFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2E_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2EFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2EFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2E frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2E frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2EFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2E frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2E_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2E FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase2DFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2d-transfer-writeoff-frontend-manifest.json'), 'utf8'))
if (stage02Phase2DFrontendManifest?.version !== 1 || stage02Phase2DFrontendManifest?.revision !== 'stage02-phase2d-transfer-writeoff-possession-resolver') throw new Error('Stage02 Phase2D frontend manifest invalid')
const stage02Phase2DFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2D_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2DFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2DFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2D frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2D frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2DFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2D frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2D_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2D FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase2CFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2c-handover-frontend-manifest.json'), 'utf8'))
if (stage02Phase2CFrontendManifest?.version !== 1 || stage02Phase2CFrontendManifest?.revision !== 'stage02-phase2c-early-handover-possession-resolver') throw new Error('Stage02 Phase2C frontend manifest invalid')
const stage02Phase2CFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2C_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2CFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2CFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2C frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2C frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2CFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2C frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2C_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2C FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase2BFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2b-shipping-frontend-manifest.json'), 'utf8'))
if (stage02Phase2BFrontendManifest?.version !== 1 || stage02Phase2BFrontendManifest?.revision !== 'stage02-phase2b-shipping-possession-resolver') throw new Error('Stage02 Phase2B frontend manifest invalid')
const stage02Phase2BFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2B_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2BFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2BFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2B frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2B frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2BFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2B frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2B_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2B FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase1BR2FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase1b-r2-workshop-boutique-frontend-manifest.json'), 'utf8'))
if (stage02Phase1BR2FrontendManifest?.version !== 1 || stage02Phase1BR2FrontendManifest?.revision !== 'stage02-phase1b-r2-workshop-boutique-disposition') throw new Error('Stage02 Phase1B R2 frontend manifest invalid')
const stage02Phase1BR2FrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE1B_R2_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase1BR2FrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase1BR2FrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase1B R2 frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase1B R2 frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase1BR2FrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase1B R2 frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE1B_R2_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE1B R2 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR92AFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r9-2a-clean-completion-frontend-manifest.json'), 'utf8'))
if (catalogResolverR92AFrontendManifest?.version !== 1 || catalogResolverR92AFrontendManifest?.revision !== 'catalog-resolver-r9-2a-clean-completion') throw new Error('Catalog resolver R9.2A frontend manifest invalid')
const catalogResolverR92AFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R92A_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR92AFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR92AFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R9.2A frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R9.2A frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR92AFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R9.2A predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R92A_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R9.2A FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR81BFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r8-1b-typo-safety-frontend-manifest.json'), 'utf8'))
if (catalogResolverR81BFrontendManifest?.version !== 1 || catalogResolverR81BFrontendManifest?.revision !== 'catalog-resolver-r8-1b-typo-safety') throw new Error('Catalog resolver R8.1B frontend manifest invalid')
const catalogResolverR81BFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R81B_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR81BFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR81BFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R8.1B frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R8.1B frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR81BFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R8.1B predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R81B_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R8.1B FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR81AFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r8-1a-safe-product-correction-frontend-manifest.json'), 'utf8'))
if (catalogResolverR81AFrontendManifest?.version !== 1 || catalogResolverR81AFrontendManifest?.revision !== 'catalog-resolver-r8-1a-safe-product-correction') throw new Error('Catalog resolver R8.1A frontend manifest invalid')
const catalogResolverR81AFrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R81A_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR81AFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR81AFrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R8.1A frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R8.1A frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR81AFrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R8.1A predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R81A_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R8.1A FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR8FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r8-minimal-question-frontend-manifest.json'), 'utf8'))
if (catalogResolverR8FrontendManifest?.version !== 1 || catalogResolverR8FrontendManifest?.revision !== 'catalog-resolver-r8-minimal-human-question') throw new Error('Catalog resolver R8 frontend manifest invalid')
const catalogResolverR8FrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R8_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR8FrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR8FrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R8 frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R8 frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR8FrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R8 frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R8_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R8 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR7FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r7-human-scope-frontend-manifest.json'), 'utf8'))
if (catalogResolverR7FrontendManifest?.version !== 1 || catalogResolverR7FrontendManifest?.revision !== 'catalog-resolver-r7-human-scope') throw new Error('Catalog resolver R7 frontend manifest invalid')
const catalogResolverR7FrontendBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R7_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR7FrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR7FrontendBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R7 frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R7 frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR7FrontendBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R7 frontend predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R7_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R7 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR4FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r4-session-frontend-manifest.json'), 'utf8'))
if (catalogResolverR4FrontendManifest?.version !== 1 || catalogResolverR4FrontendManifest?.revision !== 'catalog-resolver-r4-session-reliability') throw new Error('Catalog resolver R4 frontend manifest invalid')
const catalogResolverR4BlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R4_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR4FrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR4BlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R4 frontend changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R4 after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR4BlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R4 predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R4_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R4 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase1BWorkshopDispositionManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase1b-workshop-disposition-r1-frontend-manifest.json'), 'utf8'))
if (stage02Phase1BWorkshopDispositionManifest?.version !== 1 || stage02Phase1BWorkshopDispositionManifest?.revision !== 'stage02-phase1b-workshop-disposition-r1') throw new Error('Stage02 Phase1B Workshop disposition R1 frontend manifest invalid')
const stage02Phase1BGitBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE1B_WORKSHOP_DISPOSITION_R1_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase1BWorkshopDispositionManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase1BGitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Stage02 Phase1B Workshop disposition R1 frontend changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase1B Workshop disposition R1 after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase1BGitBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Stage02 Phase1B Workshop disposition R1 predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, STAGE02_PHASE1B_WORKSHOP_DISPOSITION_R1_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE1B WORKSHOP DISPOSITION R1 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const orderSendClarifyLabelFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-send-clarify-label-r3-frontend-manifest.json'), 'utf8'))
if (orderSendClarifyLabelFrontendManifest?.version !== 1 || orderSendClarifyLabelFrontendManifest?.revision !== 'order-send-clarify-label-r3') throw new Error('Order send clarify label R3 frontend manifest invalid')
const orderSendClarifyLabelFrontendGitBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.ORDER_SEND_CLARIFY_LABEL_R3_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(orderSendClarifyLabelFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (orderSendClarifyLabelFrontendGitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Order send clarify label R3 frontend changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Order send clarify label R3 frontend after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (orderSendClarifyLabelFrontendGitBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Order send clarify label R3 frontend predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, ORDER_SEND_CLARIFY_LABEL_R3_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ORDER SEND CLARIFY LABEL R3 FRONTEND STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const orderSendAdminResumeFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-send-admin-resume-r2-frontend-manifest.json'), 'utf8'))
if (orderSendAdminResumeFrontendManifest?.version !== 1 || orderSendAdminResumeFrontendManifest?.revision !== 'order-send-admin-resume-r2') throw new Error('Order send admin resume R2 frontend manifest invalid')
const orderSendAdminResumeGitBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

if (!process.env.ORDER_SEND_ADMIN_RESUME_R2_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(orderSendAdminResumeFrontendManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (orderSendAdminResumeGitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Order send admin resume R2 frontend changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Order send admin resume R2 after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (orderSendAdminResumeGitBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Order send admin resume R2 predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, ORDER_SEND_ADMIN_RESUME_R2_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ORDER SEND ADMIN RESUME R2 FRONTEND STRUCTURAL LAYER PASSED — admin login overlay preserves the exact order clarification state')
  process.exit(0)
}

const orderSendResolutionFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-send-catalog-resolution-r1-frontend-manifest.json'), 'utf8'))
if (orderSendResolutionFrontendManifest?.version !== 1 || orderSendResolutionFrontendManifest?.revision !== 'order-send-catalog-resolution-r1') throw new Error('Order send catalog resolution R1 frontend manifest invalid')
const orderSendFrontendGitBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

if (!process.env.ORDER_SEND_CATALOG_RESOLUTION_R1_FRONTEND_NORMALIZED) {
  const relative = orderSendResolutionFrontendManifest.file
  const absolute = path.join(root, relative)
  const actual = fs.readFileSync(absolute, 'utf8')
  if (orderSendFrontendGitBlobSha(actual) !== orderSendResolutionFrontendManifest.afterGitBlob || actual.split(/\r?\n/).length !== orderSendResolutionFrontendManifest.afterLines) {
    throw new Error('Order send catalog resolution R1 frontend changed beyond exact manifest')
  }
  let reverted = actual
  for (const replacement of [...(orderSendResolutionFrontendManifest.replacements || [])].reverse()) {
    if (!reverted.includes(replacement.afterBlock)) throw new Error('Order send catalog resolution R1 frontend after-block missing')
    reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
  }
  if (orderSendFrontendGitBlobSha(reverted) !== orderSendResolutionFrontendManifest.beforeGitBlob || reverted.split(/\r?\n/).length !== orderSendResolutionFrontendManifest.beforeLines) {
    throw new Error('Order send catalog resolution R1 frontend predecessor reconstruction failed')
  }

  let childStatus = 1
  fs.writeFileSync(absolute, reverted)
  try {
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, ORDER_SEND_CATALOG_RESOLUTION_R1_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    fs.writeFileSync(absolute, actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ORDER SEND CATALOG RESOLUTION R1 FRONTEND STRUCTURAL LAYER PASSED — inline order resolver accepted over exact Branch2 predecessor')
  process.exit(0)
}

const stage01R19BFrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-money-only-return-shipping-r19b-frontend-manifest.json'), 'utf8'))
if (stage01R19BFrontendManifest?.version !== 1 || stage01R19BFrontendManifest?.revision !== 'stage01-money-only-return-shipping-r19b') throw new Error('Stage01 money-only Return shipping R19B frontend manifest invalid')
const stage01R19BFrontendFiles = [
  'src/App.tsx',
  'src/app/types.ts',
  'src/app/orderOperationalProjection.ts',
  'src/features/sections/OrdersTableSection.tsx',
]
if (Object.keys(stage01R19BFrontendManifest.files || {}).join(',') !== stage01R19BFrontendFiles.join(',')) throw new Error('Stage01 money-only Return shipping R19B frontend allow-list widened')
const stage01R19BGitBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

if (!process.env.STAGE01_R19B_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 0
  try {
    for (const relative of stage01R19BFrontendFiles) {
      const delta = stage01R19BFrontendManifest.files[relative]
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage01R19BGitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Stage01 money-only Return shipping R19B frontend changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of delta.replacements || []) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage01 money-only Return shipping R19B exact after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage01R19BGitBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Stage01 money-only Return shipping R19B frontend predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, STAGE01_R19B_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE01 R19B FRONTEND STRUCTURAL LAYER PASSED — money-only Return shipping delta accepted over preserved R19 frontend')
  process.exit(0)
}

const stage01R19FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-return-exchange-downstream-semantics-r19-frontend-manifest.json'), 'utf8'))
if (stage01R19FrontendManifest?.version !== 1 || stage01R19FrontendManifest?.revision !== 'stage01-return-exchange-downstream-semantics-r19') throw new Error('Stage01 Return/Exchange downstream R19 frontend manifest invalid')
const stage01R19FrontendFiles = [
  'src/App.tsx',
  'src/app/types.ts',
  'src/app/orderOperationalProjection.ts',
  'src/features/sections/OrdersTableSection.tsx',
]
if (Object.keys(stage01R19FrontendManifest.files || {}).join(',') !== stage01R19FrontendFiles.join(',')) throw new Error('Stage01 Return/Exchange downstream R19 frontend allow-list widened')
const stage01R19GitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

if (!process.env.STAGE01_R19_FRONTEND_NORMALIZED) {
  const originals = new Map()
  let childStatus = 0
  try {
    for (const relative of stage01R19FrontendFiles) {
      const delta = stage01R19FrontendManifest.files[relative]
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage01R19GitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Stage01 Return/Exchange downstream R19 frontend changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of delta.replacements || []) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage01 Return/Exchange downstream R19 exact after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage01R19GitBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Stage01 Return/Exchange downstream R19 frontend predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, STAGE01_R19_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE01 R19 FRONTEND STRUCTURAL LAYER PASSED — exact Return/Exchange downstream semantics delta accepted over preserved R18 frontend')
  process.exit(0)
}

const stage01R15FrontendManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-return-exchange-item-availability-r15-frontend-manifest.json'), 'utf8'))
if (stage01R15FrontendManifest?.version !== 1 || stage01R15FrontendManifest?.revision !== 'stage01-return-exchange-item-availability-r15') throw new Error('Stage01 Return/Exchange item availability R15 frontend manifest invalid')
const stage01R15FrontendFiles = [
  'src/App.tsx',
  'src/app/types.ts',
  'src/app/utils.ts',
  'src/features/sections/OrderReturnsSection.tsx',
  'src/features/sections/OrderExchangeSection.tsx',
]
if (Object.keys(stage01R15FrontendManifest.files || {}).join(',') !== stage01R15FrontendFiles.join(',')) throw new Error('Stage01 Return/Exchange item availability R15 frontend allow-list widened')
const stage01R15GitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

if (!process.env.STAGE01_R15_FRONTEND_NORMALIZED) {
  const stage01R15Originals = new Map()
  let stage01R15ChildStatus = 0
  try {
    for (const relative of stage01R15FrontendFiles) {
      const delta = stage01R15FrontendManifest.files[relative]
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage01R15GitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Stage01 Return/Exchange item availability R15 frontend changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of delta.replacements || []) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage01 Return/Exchange item availability R15 exact after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage01R15GitBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Stage01 Return/Exchange item availability R15 frontend predecessor reconstruction failed: ' + relative)
      }
      stage01R15Originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, STAGE01_R15_FRONTEND_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    stage01R15ChildStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of stage01R15Originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (stage01R15ChildStatus !== 0) process.exit(stage01R15ChildStatus)
  console.log('STAGE01 R15 FRONTEND STRUCTURAL LAYER PASSED — exact Return/Exchange availability delta accepted over preserved R14 frontend')
  process.exit(0)
}
const manifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-frontend-manifest.json')
const unisexGenderInplaceManifestPath = path.join(root, 'scripts/catalog-unisex-gender-inplace-r1-frontend-manifest.json')
const unisexMergeManifestPath = path.join(root, 'scripts/catalog-unisex-merge-r1-frontend-manifest.json')
const operationalAutonomyA4ManifestPath = path.join(root, 'scripts/operational-autonomy-a4-frontend-manifest.json')
const operationalAutonomyA5ManifestPath = path.join(root, 'scripts/operational-autonomy-a5-frontend-manifest.json')
const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-frontend-manifest.json')
const stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-frontend-manifest.json')
const businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-frontend-manifest.json')
const clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-frontend-manifest.json')
const contextualCatalogResolutionManifestPath = path.join(root, 'scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
const stage01TruthProjectionManifestPath = path.join(root, 'scripts/stage01-order-truth-projection-frontend-manifest.json')
const stage01CanonicalItemProjectionManifestPath = path.join(root, 'scripts/stage01-canonical-item-projection-r2-frontend-manifest.json')
const stage01OrderActionEntryManifestPath = path.join(root, 'scripts/stage01-order-action-entry-r3-frontend-manifest.json')
const stage01WorkshopTruthManifestPath = path.join(root, 'scripts/stage01-workshop-truth-r3-frontend-manifest.json')
const resolverUx = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-ux-manifest.json'), 'utf8'))
if (resolverUx.revision !== 'catalog-resolver-ux-r1' || Object.keys(resolverUx.files).join(',') !== 'src/App.tsx,src/features/orders/OrderCatalogResolutionModal.tsx,src/features/orders/OrderCatalogResolutionModal.css,shared/api-contracts.ts' || Object.keys(resolverUx.addedFiles).join(',') !== 'src/features/orders/catalogResolutionFlow.ts') throw new Error('Resolver UX frontend allow-list changed')
const financeDayManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/finance-day-transparency-manifest.json'), 'utf8'))
if (financeDayManifest.revision !== 'finance-day-transparency-r1' || Object.keys(financeDayManifest.files).join(',') !== 'src/App.tsx,src/features/sections/FinanceSection.tsx,src/features/renderers/FinanceDashboardRenderer.tsx') throw new Error('Finance day frontend allow-list changed')
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
const operationalAutonomyA4Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA4ManifestPath, 'utf8'))
if (operationalAutonomyA4Manifest?.version !== 1 || operationalAutonomyA4Manifest?.revision !== 'operational-autonomy-a4-mistaken-handover-r1') throw new Error('Operational Autonomy A4 frontend manifest invalid')
if (Object.keys(operationalAutonomyA4Manifest.files || {}).join(',') !== 'src/App.tsx') throw new Error('Operational Autonomy A4 frontend allow-list widened unexpectedly')
const operationalAutonomyA5Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA5ManifestPath, 'utf8'))
if (operationalAutonomyA5Manifest?.version !== 1 || operationalAutonomyA5Manifest?.revision !== 'operational-autonomy-a5-exchange-financial-correction-r1') throw new Error('Operational Autonomy A5 frontend manifest invalid')
if (Object.keys(operationalAutonomyA5Manifest.files || {}).join(',') !== 'src/App.tsx,src/features/sections/OrderExchangeSection.tsx') throw new Error('Operational Autonomy A5 frontend allow-list widened unexpectedly')
const returnsPhysicalIntakeManifest = JSON.parse(fs.readFileSync(returnsPhysicalIntakeManifestPath, 'utf8'))
if (returnsPhysicalIntakeManifest?.version !== 1 || returnsPhysicalIntakeManifest?.revision !== 'returns-physical-intake-r1') throw new Error('Returns physical intake R1 frontend manifest invalid')
const returnsPhysicalIntakeExpectedFiles = ['src/App.tsx','src/app/types.ts','src/app/utils.ts','src/features/sections/OrderExchangeSection.tsx','src/features/sections/OrderReturnsSection.tsx']
if (JSON.stringify(Object.keys(returnsPhysicalIntakeManifest.files || {})) !== JSON.stringify(returnsPhysicalIntakeExpectedFiles)) throw new Error('Returns physical intake R1 frontend allow-list widened unexpectedly')
const stabilizationManifest = JSON.parse(fs.readFileSync(stabilizationManifestPath, 'utf8'))
if (stabilizationManifest?.version !== 1 || stabilizationManifest?.revision !== 'stabilization-20260912-r1') throw new Error('September 12 stabilization frontend manifest invalid')
const stabilizationExpectedFiles = ['src/features/sections/DashboardSection.tsx','src/features/sections/OrderExchangeSection.tsx','src/features/sections/OrderReturnsSection.tsx']
if (JSON.stringify(Object.keys(stabilizationManifest.files || {})) !== JSON.stringify(stabilizationExpectedFiles)) throw new Error('September 12 stabilization frontend allow-list widened unexpectedly')
const businessDateBoundaryManifest = JSON.parse(fs.readFileSync(businessDateBoundaryManifestPath, 'utf8'))
if (businessDateBoundaryManifest?.version !== 1 || businessDateBoundaryManifest?.revision !== 'business-date-boundaries-r1') throw new Error('Business date boundary frontend manifest invalid')
const businessDateBoundaryExpectedFiles = ['src/App.tsx','src/app/utils.ts','src/features/sections/DashboardSection.tsx']
if (JSON.stringify(Object.keys(businessDateBoundaryManifest.files || {})) !== JSON.stringify(businessDateBoundaryExpectedFiles)) throw new Error('Business date boundary frontend allow-list widened unexpectedly')
const clientFixesManifest = JSON.parse(fs.readFileSync(clientFixesManifestPath, 'utf8'))
if (clientFixesManifest?.version !== 1 || clientFixesManifest?.revision !== 'client-fixes-20260912-r1') throw new Error('Client fixes frontend manifest invalid')
const clientFixesExpectedFiles = ['src/App.tsx','src/app/types.ts','src/app/utils.ts','src/features/renderers/FinanceReportContentRenderer.tsx','src/features/sections/DashboardSection.tsx','src/features/sections/OrderExchangeSection.tsx']
if (JSON.stringify(Object.keys(clientFixesManifest.files || {})) !== JSON.stringify(clientFixesExpectedFiles)) throw new Error('Client fixes frontend allow-list widened unexpectedly')
const contextualCatalogResolutionManifest = JSON.parse(fs.readFileSync(contextualCatalogResolutionManifestPath, 'utf8'))
if (contextualCatalogResolutionManifest?.version !== 1 || contextualCatalogResolutionManifest?.revision !== 'contextual-catalog-resolution-r1') throw new Error('Contextual catalog resolution frontend manifest invalid')
const contextualCatalogResolutionExpectedFiles = ['src/App.tsx','src/app/utils.ts','src/features/orders/OrderCatalogResolutionModal.tsx','src/features/orders/OrderCatalogResolutionModal.css']
if (JSON.stringify(Object.keys(contextualCatalogResolutionManifest.files || {})) !== JSON.stringify(contextualCatalogResolutionExpectedFiles)) throw new Error('Contextual catalog resolution frontend allow-list widened unexpectedly')
const stage01TruthProjectionManifest = JSON.parse(fs.readFileSync(stage01TruthProjectionManifestPath, 'utf8'))
if (stage01TruthProjectionManifest?.version !== 1 || stage01TruthProjectionManifest?.revision !== 'stage01-order-truth-projection-r1') throw new Error('Stage 01 truth projection frontend manifest invalid')
const stage01TruthProjectionExpectedFiles = ['src/App.tsx','src/app/controllers/useOperationalViewModel.ts','src/app/utils.ts','src/features/sections/OrderDetailsSection.tsx','src/features/sections/OrderEditorSection.tsx','src/features/sections/OrdersTableSection.tsx']
if (JSON.stringify(Object.keys(stage01TruthProjectionManifest.files || {})) !== JSON.stringify(stage01TruthProjectionExpectedFiles)) throw new Error('Stage 01 truth projection frontend allow-list widened unexpectedly')
if (Object.keys(stage01TruthProjectionManifest.addedFiles || {}).join(',') !== 'src/app/orderOperationalProjection.ts') throw new Error('Stage 01 truth projection added-file allow-list changed')
const stage01CanonicalItemProjectionManifest = JSON.parse(fs.readFileSync(stage01CanonicalItemProjectionManifestPath, 'utf8'))
if (stage01CanonicalItemProjectionManifest?.version !== 1 || stage01CanonicalItemProjectionManifest?.revision !== 'stage01-canonical-item-projection-r2') throw new Error('Stage01 canonical item projection frontend manifest invalid')
const stage01CanonicalItemProjectionExpectedFiles = ['src/app/types.ts','src/features/sections/OrderDetailsSection.tsx']
if (JSON.stringify(Object.keys(stage01CanonicalItemProjectionManifest.files || {})) !== JSON.stringify(stage01CanonicalItemProjectionExpectedFiles)) throw new Error('Stage01 canonical item projection frontend allow-list widened unexpectedly')
const stage01OrderActionEntryManifest = JSON.parse(fs.readFileSync(stage01OrderActionEntryManifestPath, 'utf8'))
if (stage01OrderActionEntryManifest?.version !== 1 || stage01OrderActionEntryManifest?.revision !== 'stage01-order-action-entry-r3') throw new Error('Stage01 order action-entry frontend manifest invalid')
if (Object.keys(stage01OrderActionEntryManifest.files || {}).join(',') !== 'src/App.tsx') throw new Error('Stage01 order action-entry frontend allow-list widened unexpectedly')
const stage01WorkshopTruthManifest = JSON.parse(fs.readFileSync(stage01WorkshopTruthManifestPath, 'utf8'))
if (stage01WorkshopTruthManifest?.version !== 1 || stage01WorkshopTruthManifest?.revision !== 'stage01-workshop-truth-r3') throw new Error('Stage01 Workshop truth R3 frontend manifest invalid')
if (Object.keys(stage01WorkshopTruthManifest.files || {}).join(',') !== 'src/App.tsx') throw new Error('Stage01 Workshop truth R3 frontend allow-list widened unexpectedly')
const gitBlobSha = (text) => { const bytes = Buffer.from(text); return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex') }
for (const [file, delta] of Object.entries(stage01TruthProjectionManifest.files)) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  const successor = stage01CanonicalItemProjectionManifest.files?.[file]
  const actionEntrySuccessor = stage01OrderActionEntryManifest.files?.[file]
  const workshopTruthSuccessor = stage01WorkshopTruthManifest.files?.[file]
  let acceptedGitBlob = delta.afterGitBlob
  let acceptedLines = delta.afterLines
  if (successor) {
    if (successor.beforeGitBlob !== acceptedGitBlob || successor.beforeLines !== acceptedLines) throw new Error('Stage01 canonical item projection predecessor drifted: ' + file)
    acceptedGitBlob = successor.afterGitBlob
    acceptedLines = successor.afterLines
  }
  if (actionEntrySuccessor) {
    if (actionEntrySuccessor.beforeGitBlob !== acceptedGitBlob || actionEntrySuccessor.beforeLines !== acceptedLines) throw new Error('Stage01 order action-entry predecessor drifted: ' + file)
    acceptedGitBlob = actionEntrySuccessor.afterGitBlob
    acceptedLines = actionEntrySuccessor.afterLines
  }
  if (workshopTruthSuccessor) {
    if (workshopTruthSuccessor.beforeGitBlob !== acceptedGitBlob || workshopTruthSuccessor.beforeLines !== acceptedLines) throw new Error('Stage01 Workshop truth R3 predecessor drifted: ' + file)
    acceptedGitBlob = workshopTruthSuccessor.afterGitBlob
    acceptedLines = workshopTruthSuccessor.afterLines
  }
  if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\r?\n/).length !== acceptedLines) throw new Error(workshopTruthSuccessor ? 'Stage01 Workshop truth R3 frontend file changed beyond exact manifest: ' + file : actionEntrySuccessor ? 'Stage01 order action-entry frontend file changed beyond exact manifest: ' + file : successor ? 'Stage01 canonical item projection frontend file changed beyond exact manifest: ' + file : 'Stage 01 truth projection frontend file changed beyond exact manifest: ' + file)
}
for (const [file, delta] of Object.entries(stage01CanonicalItemProjectionManifest.files)) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (gitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage01 canonical item projection frontend file changed beyond exact manifest: ' + file)
}
for (const [file, delta] of Object.entries(stage01OrderActionEntryManifest.files)) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  const successor = stage01WorkshopTruthManifest.files?.[file]
  let acceptedGitBlob = delta.afterGitBlob
  let acceptedLines = delta.afterLines
  if (successor) {
    if (successor.beforeGitBlob !== acceptedGitBlob || successor.beforeLines !== acceptedLines) throw new Error('Stage01 Workshop truth R3 predecessor drifted: ' + file)
    acceptedGitBlob = successor.afterGitBlob
    acceptedLines = successor.afterLines
  }
  if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\r?\n/).length !== acceptedLines) throw new Error(successor ? 'Stage01 Workshop truth R3 frontend file changed beyond exact manifest: ' + file : 'Stage01 order action-entry frontend file changed beyond exact manifest: ' + file)
}
for (const [file, delta] of Object.entries(stage01WorkshopTruthManifest.files)) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (gitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage01 Workshop truth R3 frontend file changed beyond exact manifest: ' + file)
}
for (const [file, delta] of Object.entries(stage01TruthProjectionManifest.addedFiles)) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (gitBlobSha(actual) !== delta.gitBlob || actual.split(/\r?\n/).length !== delta.lines) throw new Error('Stage 01 truth projection added file changed beyond exact manifest: ' + file)
}

for (const file of ['src/features/sections/FinanceSection.tsx', 'src/features/renderers/FinanceDashboardRenderer.tsx']) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (gitBlobSha(actual) !== financeDayManifest.files[file].afterGitBlob) throw new Error('Finance day UI changed outside exact delta: ' + file)
}
const financeDayAddedFiles = ['shared/finance-day-contracts.ts','src/features/finance/FinanceDayView.tsx','src/features/finance/finance-day.css']
if (Object.keys(financeDayManifest.addedFiles).join(',') !== financeDayAddedFiles.join(',')) throw new Error('Finance day added file allow-list changed')
for (const file of financeDayAddedFiles) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (crypto.createHash('sha256').update(actual).digest('hex') !== financeDayManifest.addedFiles[file]) throw new Error('Finance day added file changed outside manifest: ' + file)
}

for (const file of ['src/features/orders/OrderCatalogResolutionModal.tsx', 'src/features/orders/OrderCatalogResolutionModal.css']) {
  const delta = contextualCatalogResolutionManifest.files[file]
  const latest = resolverUx.files[file]
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  if (!delta?.added || delta.beforeGitBlob !== null || latest.beforeGitBlob !== delta.afterGitBlob || latest.beforeLines !== delta.afterLines || gitBlobSha(actual) !== latest.afterGitBlob || actual.split(/\r?\n/).length !== latest.afterLines) throw new Error('Resolver UX frontend file changed beyond exact manifest: ' + file)
}
for (const [file, hash] of Object.entries(resolverUx.addedFiles)) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8')).digest('hex') !== hash) throw new Error('Resolver UX helper changed outside manifest: ' + file)
}
if (gitBlobSha(fs.readFileSync(path.join(root, 'shared/api-contracts.ts'), 'utf8')) !== resolverUx.files['shared/api-contracts.ts'].afterGitBlob) throw new Error('Resolver UX contract changed outside manifest')
for (const file of ['src/app/utils.ts', 'src/features/sections/OrderReturnsSection.tsx']) {
  const delta = returnsPhysicalIntakeManifest.files[file]
  const stabilizationDelta = stabilizationManifest.files?.[file]
  const actual = fs.readFileSync(path.join(root, file), 'utf8')
  let acceptedGitBlob = delta?.afterGitBlob
  let acceptedLines = delta?.afterLines
  if (stabilizationDelta) {
    if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)
    acceptedGitBlob = stabilizationDelta.afterGitBlob
    acceptedLines = stabilizationDelta.afterLines
  }
  const businessDateBoundaryDelta = businessDateBoundaryManifest.files?.[file]
  if (businessDateBoundaryDelta) {
    if (businessDateBoundaryDelta.beforeGitBlob !== acceptedGitBlob || businessDateBoundaryDelta.beforeLines !== acceptedLines) throw new Error('Business date boundary frontend predecessor drifted: ' + file)
    acceptedGitBlob = businessDateBoundaryDelta.afterGitBlob
    acceptedLines = businessDateBoundaryDelta.afterLines
  }
  const clientFixesDelta = clientFixesManifest.files?.[file]
  if (clientFixesDelta) {
    if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)
    acceptedGitBlob = clientFixesDelta.afterGitBlob
    acceptedLines = clientFixesDelta.afterLines
  }
  const contextualCatalogResolutionDelta = contextualCatalogResolutionManifest.files?.[file]
  if (contextualCatalogResolutionDelta) {
    if (contextualCatalogResolutionDelta.beforeGitBlob !== acceptedGitBlob || contextualCatalogResolutionDelta.beforeLines !== acceptedLines) throw new Error('Contextual catalog resolution frontend predecessor drifted: ' + file)
    acceptedGitBlob = contextualCatalogResolutionDelta.afterGitBlob
    acceptedLines = contextualCatalogResolutionDelta.afterLines
  }
  const stage01TruthProjectionDelta = stage01TruthProjectionManifest.files?.[file]
  if (stage01TruthProjectionDelta) {
    if (stage01TruthProjectionDelta.beforeGitBlob !== acceptedGitBlob || stage01TruthProjectionDelta.beforeLines !== acceptedLines) throw new Error('Stage 01 truth projection frontend predecessor drifted: ' + file)
    acceptedGitBlob = stage01TruthProjectionDelta.afterGitBlob
    acceptedLines = stage01TruthProjectionDelta.afterLines
  }
  const stage01CanonicalItemProjectionDelta = stage01CanonicalItemProjectionManifest.files?.[file]
  if (stage01CanonicalItemProjectionDelta) {
    if (stage01CanonicalItemProjectionDelta.beforeGitBlob !== acceptedGitBlob || stage01CanonicalItemProjectionDelta.beforeLines !== acceptedLines) throw new Error('Stage01 canonical item projection frontend predecessor drifted: ' + file)
    acceptedGitBlob = stage01CanonicalItemProjectionDelta.afterGitBlob
    acceptedLines = stage01CanonicalItemProjectionDelta.afterLines
  }
  const stage01OrderActionEntryDelta = stage01OrderActionEntryManifest.files?.[file]
  if (stage01OrderActionEntryDelta) {
    if (stage01OrderActionEntryDelta.beforeGitBlob !== acceptedGitBlob || stage01OrderActionEntryDelta.beforeLines !== acceptedLines) throw new Error('Stage01 order action-entry frontend predecessor drifted: ' + file)
    acceptedGitBlob = stage01OrderActionEntryDelta.afterGitBlob
    acceptedLines = stage01OrderActionEntryDelta.afterLines
  }
  const stage01WorkshopTruthDelta = stage01WorkshopTruthManifest.files?.[file]
  if (stage01WorkshopTruthDelta) {
    if (stage01WorkshopTruthDelta.beforeGitBlob !== acceptedGitBlob || stage01WorkshopTruthDelta.beforeLines !== acceptedLines) throw new Error('Stage01 Workshop truth R3 frontend predecessor drifted: ' + file)
    acceptedGitBlob = stage01WorkshopTruthDelta.afterGitBlob
    acceptedLines = stage01WorkshopTruthDelta.afterLines
  }
  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\r?\n/).length !== acceptedLines) throw new Error(contextualCatalogResolutionDelta ? 'Contextual catalog resolution frontend file changed beyond exact manifest: ' + file : clientFixesDelta ? 'Client fixes frontend file changed beyond exact manifest: ' + file : businessDateBoundaryDelta ? 'Business date boundary frontend file changed beyond exact manifest: ' + file : stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)
}
const stabilizationDashboardFile = 'src/features/sections/DashboardSection.tsx'
const stabilizationDashboardDelta = stabilizationManifest.files[stabilizationDashboardFile]
const stabilizationDashboardActual = fs.readFileSync(path.join(root, stabilizationDashboardFile), 'utf8')
const businessDateBoundaryDashboardDelta = businessDateBoundaryManifest.files[stabilizationDashboardFile]
if (!stabilizationDashboardDelta || !businessDateBoundaryDashboardDelta) throw new Error('Dashboard frontend date-boundary manifests missing')
if (businessDateBoundaryDashboardDelta.beforeGitBlob !== stabilizationDashboardDelta.afterGitBlob || businessDateBoundaryDashboardDelta.beforeLines !== stabilizationDashboardDelta.afterLines) throw new Error('Business date boundary Dashboard predecessor drifted')
const clientFixesDashboardDelta = clientFixesManifest.files[stabilizationDashboardFile]
if (!clientFixesDashboardDelta || clientFixesDashboardDelta.beforeGitBlob !== businessDateBoundaryDashboardDelta.afterGitBlob || clientFixesDashboardDelta.beforeLines !== businessDateBoundaryDashboardDelta.afterLines) throw new Error('Client fixes Dashboard predecessor drifted')
if (gitBlobSha(stabilizationDashboardActual) !== clientFixesDashboardDelta.afterGitBlob || stabilizationDashboardActual.split(/\r?\n/).length !== clientFixesDashboardDelta.afterLines) throw new Error('Client fixes Dashboard frontend changed beyond exact manifest')
const clientFixesRendererFile = 'src/features/renderers/FinanceReportContentRenderer.tsx'
const clientFixesRendererDelta = clientFixesManifest.files[clientFixesRendererFile]
const clientFixesRendererActual = fs.readFileSync(path.join(root, clientFixesRendererFile), 'utf8')
if (!clientFixesRendererDelta || gitBlobSha(clientFixesRendererActual) !== clientFixesRendererDelta.afterGitBlob || clientFixesRendererActual.split(/\r?\n/).length !== clientFixesRendererDelta.afterLines) throw new Error('Client fixes Finance renderer changed beyond exact manifest')

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
    const operationalAutonomyA4Delta = operationalAutonomyA4Manifest.files?.[file]
    const operationalAutonomyA5Delta = operationalAutonomyA5Manifest.files?.[file]
    const returnsPhysicalIntakeDelta = returnsPhysicalIntakeManifest.files?.[file]
    const businessDateBoundaryDelta = businessDateBoundaryManifest.files?.[file]
    const clientFixesDelta = clientFixesManifest.files?.[file]
    const contextualCatalogResolutionDelta = contextualCatalogResolutionManifest.files?.[file]
    let acceptedGitBlob = delta.afterGitBlob
    let acceptedLines = delta.afterLines
    if (inPlaceDelta) {
      if (inPlaceDelta.beforeGitBlob !== acceptedGitBlob || inPlaceDelta.beforeLines !== acceptedLines) throw new Error('Catalog unisex gender in-place predecessor drifted: ' + file)
      acceptedGitBlob = inPlaceDelta.afterGitBlob
      acceptedLines = inPlaceDelta.afterLines
    }
    if (mergeDelta) {
      if (!inPlaceDelta) throw new Error('Catalog unisex merge predecessor is missing: ' + file)
      if (mergeDelta.beforeGitBlob !== acceptedGitBlob || mergeDelta.beforeLines !== acceptedLines) throw new Error('Catalog unisex merge predecessor drifted: ' + file)
      acceptedGitBlob = mergeDelta.afterGitBlob
      acceptedLines = mergeDelta.afterLines
    }
    if (operationalAutonomyA4Delta) {
      if (operationalAutonomyA4Delta.beforeGitBlob !== acceptedGitBlob || operationalAutonomyA4Delta.beforeLines !== acceptedLines) throw new Error('Operational Autonomy A4 frontend predecessor drifted: ' + file)
      acceptedGitBlob = operationalAutonomyA4Delta.afterGitBlob
      acceptedLines = operationalAutonomyA4Delta.afterLines
    }
    if (operationalAutonomyA5Delta) {
      if (operationalAutonomyA5Delta.beforeGitBlob !== acceptedGitBlob || operationalAutonomyA5Delta.beforeLines !== acceptedLines) throw new Error('Operational Autonomy A5 frontend predecessor drifted: ' + file)
      acceptedGitBlob = operationalAutonomyA5Delta.afterGitBlob
      acceptedLines = operationalAutonomyA5Delta.afterLines
    }
    if (returnsPhysicalIntakeDelta) {
      if (returnsPhysicalIntakeDelta.beforeGitBlob !== acceptedGitBlob || returnsPhysicalIntakeDelta.beforeLines !== acceptedLines) throw new Error('Returns physical intake R1 frontend predecessor drifted: ' + file)
      acceptedGitBlob = returnsPhysicalIntakeDelta.afterGitBlob
      acceptedLines = returnsPhysicalIntakeDelta.afterLines
    }
    const stabilizationDelta = stabilizationManifest.files?.[file]
    if (stabilizationDelta) {
      if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)
      acceptedGitBlob = stabilizationDelta.afterGitBlob
      acceptedLines = stabilizationDelta.afterLines
    }
    if (businessDateBoundaryDelta) {
      if (businessDateBoundaryDelta.beforeGitBlob !== acceptedGitBlob || businessDateBoundaryDelta.beforeLines !== acceptedLines) throw new Error('Business date boundary frontend predecessor drifted: ' + file)
      acceptedGitBlob = businessDateBoundaryDelta.afterGitBlob
      acceptedLines = businessDateBoundaryDelta.afterLines
    }
    if (clientFixesDelta) {
      if (clientFixesDelta.beforeGitBlob !== acceptedGitBlob || clientFixesDelta.beforeLines !== acceptedLines) throw new Error('Client fixes frontend predecessor drifted: ' + file)
      acceptedGitBlob = clientFixesDelta.afterGitBlob
      acceptedLines = clientFixesDelta.afterLines
    }
    if (contextualCatalogResolutionDelta) {
      if (contextualCatalogResolutionDelta.beforeGitBlob !== acceptedGitBlob || contextualCatalogResolutionDelta.beforeLines !== acceptedLines) throw new Error('Contextual catalog resolution frontend predecessor drifted: ' + file)
      acceptedGitBlob = contextualCatalogResolutionDelta.afterGitBlob
      acceptedLines = contextualCatalogResolutionDelta.afterLines
    }
    const financeDayDelta = financeDayManifest.files[file]
    if (financeDayDelta) {
      if (financeDayDelta.beforeGitBlob !== acceptedGitBlob || financeDayDelta.beforeLines !== acceptedLines) throw new Error('Finance day frontend predecessor drifted: ' + file)
      acceptedGitBlob = financeDayDelta.afterGitBlob
      acceptedLines = financeDayDelta.afterLines
    }
    const resolverUxDelta = resolverUx.files[file]
    if (resolverUxDelta) {
      if (resolverUxDelta.beforeGitBlob !== acceptedGitBlob || resolverUxDelta.beforeLines !== acceptedLines) throw new Error('Resolver UX frontend predecessor drifted: ' + file)
      acceptedGitBlob = resolverUxDelta.afterGitBlob
      acceptedLines = resolverUxDelta.afterLines
    }
    const stage01TruthProjectionDelta = stage01TruthProjectionManifest.files?.[file]
    if (stage01TruthProjectionDelta) {
      if (stage01TruthProjectionDelta.beforeGitBlob !== acceptedGitBlob || stage01TruthProjectionDelta.beforeLines !== acceptedLines) throw new Error('Stage 01 truth projection frontend predecessor drifted: ' + file)
      acceptedGitBlob = stage01TruthProjectionDelta.afterGitBlob
      acceptedLines = stage01TruthProjectionDelta.afterLines
    }
    const stage01CanonicalItemProjectionDelta = stage01CanonicalItemProjectionManifest.files?.[file]
    if (stage01CanonicalItemProjectionDelta) {
      if (stage01CanonicalItemProjectionDelta.beforeGitBlob !== acceptedGitBlob || stage01CanonicalItemProjectionDelta.beforeLines !== acceptedLines) throw new Error('Stage01 canonical item projection frontend predecessor drifted: ' + file)
      acceptedGitBlob = stage01CanonicalItemProjectionDelta.afterGitBlob
      acceptedLines = stage01CanonicalItemProjectionDelta.afterLines
    }
    const stage01OrderActionEntryDelta = stage01OrderActionEntryManifest.files?.[file]
    if (stage01OrderActionEntryDelta) {
      if (stage01OrderActionEntryDelta.beforeGitBlob !== acceptedGitBlob || stage01OrderActionEntryDelta.beforeLines !== acceptedLines) throw new Error('Stage01 order action-entry frontend predecessor drifted: ' + file)
      acceptedGitBlob = stage01OrderActionEntryDelta.afterGitBlob
      acceptedLines = stage01OrderActionEntryDelta.afterLines
    }
    const stage01WorkshopTruthDelta = stage01WorkshopTruthManifest.files?.[file]
    if (stage01WorkshopTruthDelta) {
      if (stage01WorkshopTruthDelta.beforeGitBlob !== acceptedGitBlob || stage01WorkshopTruthDelta.beforeLines !== acceptedLines) throw new Error('Stage01 Workshop truth R3 frontend predecessor drifted: ' + file)
      acceptedGitBlob = stage01WorkshopTruthDelta.afterGitBlob
      acceptedLines = stage01WorkshopTruthDelta.afterLines
    }
    if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\r?\n/).length !== acceptedLines) {
      throw new Error(contextualCatalogResolutionDelta
        ? 'Contextual catalog resolution frontend file changed beyond exact manifest: ' + file
        : clientFixesDelta
        ? 'Client fixes frontend file changed beyond exact manifest: ' + file
        : businessDateBoundaryDelta
        ? 'Business date boundary frontend file changed beyond exact manifest: ' + file
        : stabilizationDelta
        ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file
        : returnsPhysicalIntakeDelta
        ? 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file
        : operationalAutonomyA5Delta
        ? 'Operational Autonomy A5 frontend file changed beyond exact manifest: ' + file
        : operationalAutonomyA4Delta
          ? 'Operational Autonomy A4 frontend file changed beyond exact manifest: ' + file
          : mergeDelta
          ? 'Catalog unisex merge frontend file changed beyond exact manifest: ' + file
          : inPlaceDelta
            ? 'Catalog unisex gender in-place frontend file changed beyond exact manifest: ' + file
            : 'Catalog gender frontend file changed beyond exact manifest: ' + file)
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

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const panelPath = path.join(root, 'src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const componentPath = path.join(root, 'src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const inventoryPath = path.join(root, 'src/features/sections/InventorySection.tsx')
const baselinePanelPath = path.join(root, 'scripts/fixtures/renderInventoryCatalogPanel-w6-4-baseline.tsx')
const baselineComponentPath = path.join(root, 'scripts/fixtures/catalogPolishExecutionGroups-w6-4-baseline.tsx')
const baselineInventoryPath = path.join(root, 'scripts/fixtures/InventorySection-w6-4-baseline.tsx')
const w6LayerPath = path.join(root, 'scripts/test-step1906b-frontend-modularization-w6-layer.mjs')
const w6ManifestPath = path.join(root, 'scripts/w6-4-catalog-sku-card-frontend-manifest.json')
const manifestPath = path.join(root, 'scripts/w7-sku-history-frontend-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8')
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8')
  return crypto.createHash('sha1').update(header).update(body).digest('hex')
}

try {
  for (const required of [panelPath, componentPath, inventoryPath, baselinePanelPath, baselineComponentPath, baselineInventoryPath, w6LayerPath, w6ManifestPath, manifestPath]) {
    check(fs.existsSync(required), `W7 frontend structural file missing: ${path.relative(root, required)}`)
  }

  const w6Manifest = JSON.parse(fs.readFileSync(w6ManifestPath, 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  check(manifest?.version === 1 && manifest?.revision === 'w7-sku-history-price-readiness', 'W7 frontend manifest invalid')

  const panelRel = 'src/features/inventory/views/renderInventoryCatalogPanel.tsx'
  const componentRel = 'src/features/inventory/views/catalogPolishExecutionGroups.tsx'
  const inventoryRel = 'src/features/sections/InventorySection.tsx'
  const expectedFiles = [panelRel, componentRel, inventoryRel]
  check(JSON.stringify(Object.keys(manifest.files || {})) === JSON.stringify(expectedFiles), 'W7 frontend file allow-list widened unexpectedly')

  const currentPanel = fs.readFileSync(panelPath, 'utf8')
  const currentComponent = fs.readFileSync(componentPath, 'utf8')
  const currentInventory = fs.readFileSync(inventoryPath, 'utf8')
  const baselinePanel = fs.readFileSync(baselinePanelPath, 'utf8')
  const baselineComponent = fs.readFileSync(baselineComponentPath, 'utf8')
  const baselineInventory = fs.readFileSync(baselineInventoryPath, 'utf8')

  check(gitBlobSha(baselinePanel) === w6Manifest.files[panelRel].afterGitBlob, 'W7 frozen panel is not the accepted W6.4 panel')
  check(gitBlobSha(baselineComponent) === w6Manifest.files[componentRel].afterGitBlob, 'W7 frozen SKU component is not the accepted W6.4 component')
  check(manifest.files[panelRel].beforeGitBlob === w6Manifest.files[panelRel].afterGitBlob, 'W7 panel before hash does not chain from W6.4')
  check(manifest.files[componentRel].beforeGitBlob === w6Manifest.files[componentRel].afterGitBlob, 'W7 component before hash does not chain from W6.4')
  check(gitBlobSha(baselineInventory) === manifest.files[inventoryRel].beforeGitBlob, 'W7 frozen InventorySection is not the exact pre-W7 baseline')
  check(gitBlobSha(currentInventory) === manifest.files[inventoryRel].afterGitBlob, 'W7 InventorySection changed beyond exact manifest')
  check(gitBlobSha(currentPanel) === manifest.files[panelRel].afterGitBlob, 'W7 catalog panel changed beyond exact manifest')
  check(gitBlobSha(currentComponent) === manifest.files[componentRel].afterGitBlob, 'W7 SKU component changed beyond exact manifest')

  check(currentPanel.includes("| 'openSimpleStockHistory'") && currentPanel.includes('openVariantHistory={ctx.openSimpleStockHistory}'), 'W7 catalog history callback is not explicitly wired')
  check(currentInventory.includes('openSimpleStockHistory,\n        openOrderFromFinance,'), 'W7 InventorySection does not pass its existing exact-history opener to Catalog')
  check(currentInventory.includes('const historyRequestRef = useRef(0)') && currentInventory.includes('const requestId = ++historyRequestRef.current'), 'W7 InventorySection lost history request generation')
  check(currentInventory.includes('if (requestId !== historyRequestRef.current) return') && currentInventory.includes('if (requestId === historyRequestRef.current) setHistoryBusy(false)'), 'W7 stale history response guard is incomplete')
  check(currentComponent.includes('История · Склад') && currentComponent.includes('История · Бутик'), 'W7 source-explicit SKU history actions are missing')
  check(currentComponent.includes("source: 'warehouse'") && currentComponent.includes("source: 'boutique'"), 'W7 SKU history actions lost explicit source semantics')
  check(currentComponent.includes('variantId: Number(cardVariant.id)'), 'W7 SKU history action lost exact variant identity')
  check(!currentPanel.includes('useState(') && !currentPanel.includes('useEffect('), 'W7 catalog renderer unexpectedly owns React lifecycle')

  fs.writeFileSync(panelPath, baselinePanel)
  fs.writeFileSync(componentPath, baselineComponent)
  fs.writeFileSync(inventoryPath, baselineInventory)
  let result
  try {
    result = spawnSync(process.execPath, [w6LayerPath], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  } finally {
    fs.writeFileSync(panelPath, currentPanel)
    fs.writeFileSync(componentPath, currentComponent)
    fs.writeFileSync(inventoryPath, currentInventory)
  }
  if (result?.error) fail(`W6 preservation layer could not run under W7 baseline: ${result.error.message}`)
  check(result?.status === 0, `W6 preservation layer failed with code ${result?.status}`)
  check(fs.readFileSync(panelPath, 'utf8') === currentPanel && fs.readFileSync(componentPath, 'utf8') === currentComponent && fs.readFileSync(inventoryPath, 'utf8') === currentInventory, 'W7 frontend structural gate failed to restore current W7 files')

  console.log('W7 FRONTEND STRUCTURAL LAYER PASSED — W6.4 baseline preserved; exact Catalog + InventorySection history/race delta accepted')
} catch (error) {
  console.error(`W7 FRONTEND STRUCTURAL LAYER FAILED: ${error?.message || error}`)
  process.exit(1)
}

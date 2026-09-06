import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const overviewPath = path.join(root, 'src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const baselineOverviewPath = path.join(root, 'scripts/fixtures/renderInventoryOverviewPanel-w7-baseline.tsx')
const w7LayerPath = path.join(root, 'scripts/test-step1906b-frontend-modularization-w7-layer.mjs')
const manifestPath = path.join(root, 'scripts/w8-1-stock-overview-frontend-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const gitBlobSha = (text) => {
  const body = Buffer.from(text, 'utf8')
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8')
  return crypto.createHash('sha1').update(header).update(body).digest('hex')
}

try {
  for (const required of [overviewPath, baselineOverviewPath, w7LayerPath, manifestPath]) {
    check(fs.existsSync(required), `W8.1 frontend structural file missing: ${path.relative(root, required)}`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const overviewRel = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
  check(manifest?.version === 1 && manifest?.revision === 'w8-1-stock-overview-completion', 'W8.1 frontend manifest invalid')
  check(JSON.stringify(Object.keys(manifest.files || {})) === JSON.stringify([overviewRel]), 'W8.1 frontend file allow-list widened unexpectedly')
  const currentOverview = fs.readFileSync(overviewPath, 'utf8')
  const baselineOverview = fs.readFileSync(baselineOverviewPath, 'utf8')
  check(gitBlobSha(baselineOverview) === manifest.files[overviewRel].beforeGitBlob, 'W8.1 frozen overview is not exact W7 baseline')
  check(gitBlobSha(currentOverview) === manifest.files[overviewRel].afterGitBlob, 'W8.1 overview changed beyond exact manifest')
  check(currentOverview.includes('data-w8-stock-hierarchy="execution-color-size"'), 'W8.1 hierarchy marker missing')
  check(currentOverview.includes('buildStockBrowseHierarchy(rows'), 'W8.1 exact rows are not grouped for human browsing')
  check(currentOverview.includes('inventory-stock-size-tile warehouse-w3-micro-check-open'), 'W8.1 exact SKU tile lost existing quick-check path')
  check(currentOverview.includes('onClick={() => openConcreteStockCheck(row, primary)}'), 'W8.1 SKU tiles do not open exact physical check')
  check(currentOverview.includes('inventory-stock-result-meta'), 'W8.1 current-result count is missing')
  check(!currentOverview.includes('useState(') && !currentOverview.includes('useEffect('), 'W8.1 renderer unexpectedly owns React lifecycle')

  fs.writeFileSync(overviewPath, baselineOverview)
  let result
  try {
    result = spawnSync(process.execPath, [w7LayerPath], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  } finally {
    fs.writeFileSync(overviewPath, currentOverview)
  }
  if (result?.error) fail(`W7 preservation layer could not run under W8.1 baseline: ${result.error.message}`)
  check(result?.status === 0, `W7 preservation layer failed with code ${result?.status}`)
  check(fs.readFileSync(overviewPath, 'utf8') === currentOverview, 'W8.1 structural gate failed to restore current overview')
  console.log('W8.1 FRONTEND STRUCTURAL LAYER PASSED — W7 baseline preserved; exact Overview presentation delta accepted')
} catch (error) {
  console.error(`W8.1 FRONTEND STRUCTURAL LAYER FAILED: ${error?.message || error}`)
  process.exit(1)
}

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const overviewPath = path.join(root, 'src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const inventoryPath = path.join(root, 'src/features/sections/InventorySection.tsx')
const baselineOverviewPath = path.join(root, 'scripts/fixtures/renderInventoryOverviewPanel-w8-1-baseline.tsx')
const baselineInventoryPath = path.join(root, 'scripts/fixtures/InventorySection-w8-1-baseline.tsx')
const priorLayerPath = path.join(root, 'scripts/test-step1906b-frontend-modularization-w8-layer.mjs')
const manifestPath = path.join(root, 'scripts/w8-2-stock-workspace-frontend-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const gitBlobSha = (text) => { const body = Buffer.from(text, 'utf8'); const header = Buffer.from(`blob ${body.length}\0`, 'utf8'); return crypto.createHash('sha1').update(header).update(body).digest('hex') }

try {
  for (const required of [overviewPath, inventoryPath, baselineOverviewPath, baselineInventoryPath, priorLayerPath, manifestPath]) check(fs.existsSync(required), `W8.2 frontend structural file missing: ${path.relative(root, required)}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const expectedFiles = ['src/features/inventory/views/renderInventoryOverviewPanel.tsx', 'src/features/sections/InventorySection.tsx']
  check(manifest?.version === 1 && manifest?.revision === 'w8-2-stock-workspace-finish', 'W8.2 frontend manifest invalid')
  check(JSON.stringify(Object.keys(manifest.files || {})) === JSON.stringify(expectedFiles), 'W8.2 frontend file allow-list widened unexpectedly')
  const currentOverview = fs.readFileSync(overviewPath, 'utf8')
  const currentInventory = fs.readFileSync(inventoryPath, 'utf8')
  const baselineOverview = fs.readFileSync(baselineOverviewPath, 'utf8')
  const baselineInventory = fs.readFileSync(baselineInventoryPath, 'utf8')
  check(gitBlobSha(baselineOverview) === manifest.files[expectedFiles[0]].beforeGitBlob, 'W8.2 frozen Overview is not exact W8.1 baseline')
  check(gitBlobSha(baselineInventory) === manifest.files[expectedFiles[1]].beforeGitBlob, 'W8.2 frozen InventorySection is not exact W8.1 baseline')
  check(gitBlobSha(currentOverview) === manifest.files[expectedFiles[0]].afterGitBlob, 'W8.2 Overview changed beyond exact manifest')
  check(gitBlobSha(currentInventory) === manifest.files[expectedFiles[1]].afterGitBlob, 'W8.2 InventorySection changed beyond exact manifest')
  check(currentOverview.includes('openConcreteStockDetail') && currentOverview.includes('inventory-stock-routine-disclosure'), 'W8.2 Overview markers missing')
  check(currentInventory.includes('simpleStockReservationsRequestRef') && currentInventory.includes('hasExplicitStockSearch'), 'W8.2 controller markers missing')

  fs.writeFileSync(overviewPath, baselineOverview)
  fs.writeFileSync(inventoryPath, baselineInventory)
  let result
  try {
    result = spawnSync(process.execPath, [priorLayerPath], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  } finally {
    fs.writeFileSync(overviewPath, currentOverview)
    fs.writeFileSync(inventoryPath, currentInventory)
  }
  if (result?.error) fail(`W8.1 preservation layer could not run under W8.2 baseline: ${result.error.message}`)
  check(result?.status === 0, `W8.1 preservation layer failed with code ${result?.status}`)
  check(fs.readFileSync(overviewPath, 'utf8') === currentOverview && fs.readFileSync(inventoryPath, 'utf8') === currentInventory, 'W8.2 structural gate failed to restore current files')
  console.log('W8.2 FRONTEND STRUCTURAL LAYER PASSED — W8.1 baseline preserved; exact stock-workspace + reservation-race delta accepted')
} catch (error) {
  console.error(`W8.2 FRONTEND STRUCTURAL LAYER FAILED: ${error?.message || error}`)
  process.exit(1)
}

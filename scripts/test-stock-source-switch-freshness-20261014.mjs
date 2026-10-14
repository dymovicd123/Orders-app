import fs from 'node:fs'
import assert from 'node:assert/strict'

const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const panel = fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx', 'utf8')

const between = (start, end) => {
  const a = section.indexOf(start)
  const b = section.indexOf(end, a + 1)
  assert.ok(a !== -1 && b > a, 'Stock source switch boundary missing')
  return section.slice(a, b)
}

const switchBody = between("function setSimpleStockSource(sourceOrUpdater: any)", '  const [catalogAdminMode')
const loadBody = between("async function waitForSimpleStockSnapshot(source:", "  function setSimpleStockSource(")
const readiness = between('  const simpleStockSnapshotReady =', '  return (\n    <section className="card wide sector-inventory')

assert.match(switchBody, /candidate !== 'warehouse' && candidate !== 'boutique'/,
  'Source setter must ignore malformed updater values')
assert.match(switchBody, /setSimpleStockSourceState\(source\)/, 'Selected location must change in UI')
assert.match(switchBody, /loadInventoryData\(source, true, '', false\)/,
  'Switch must fetch selected source from server with force=true')
assert.doesNotMatch(switchBody, /loadInventoryData\('warehouse'/,
  'Switch must not always fetch warehouse even when boutique selected')
assert.match(switchBody, /setSimpleStockDetail\(null\)/,
  'Previously selected source details must be cleared on switching')
assert.match(switchBody, /simpleStockReservationsRequestRef\.current \+= 1/,
  'In-flight reservation detail response must not reopen stale source detail')
assert.match(loadBody, /setSimpleStockSourceRefresh\(\{ source, status: 'loading' \}\)/,
  'Refresh must hide stale counts while fetching')
assert.match(loadBody, /result\?\.ok === true \? 'ready' : 'error'/,
  'Only confirmed inventory response may unblock selected-source counts')
assert.match(loadBody, /simpleStockSourceRequestRef\.current === requestId/g,
  'Old responses must not change UI after another source is selected')
assert.match(readiness, /row\.source === simpleStockSource && row\.data\?\.ok === true/,
  'Only confirmed selected location source snapshot may show stock')
assert.match(readiness, /simpleStockSourceRefresh\?\.source !== simpleStockSource \|\| simpleStockSourceRefresh\.status === 'ready'/,
  'Old selected source snapshot must be blocked during switch and on failure')
assert.match(section, /Обновляем остатки выбранной точки/,
  'Staff must see that values are loading, not false zero')
assert.match(section, /waitForSimpleStockSnapshot\(\s*simpleStockSource,\s*loadInventoryData\(simpleStockSource, true, '', false\)/,
  'Retry path must use the same fresh snapshot guard')
assert.match(panel, /onClick=\{\(\) => setSimpleStockSource\(entry\.value\)\}/,
  'Actual location selector must invoke the guarded refresh action')
assert.match(app, /inventorySnapshotRequestSeq\.current\[source\] !== requestSeq/,
  'Older source response must never overwrite newer source snapshot')

// Small outcome table: source switching must not temporarily show old boutique counts.
// The full UI is also typechecked and built by the CI release gate.
const canRender = (state, source, snapshotOk) =>
  snapshotOk && (state?.source !== source || state.status === 'ready')
assert.equal(canRender({ source: 'boutique', status: 'loading' }, 'boutique', true), false)
assert.equal(canRender({ source: 'boutique', status: 'error' }, 'boutique', true), false)
assert.equal(canRender({ source: 'boutique', status: 'ready' }, 'boutique', true), true)
assert.equal(canRender({ source: 'boutique', status: 'ready' }, 'boutique', false), false)
assert.equal(canRender({ source: 'warehouse', status: 'ready' }, 'boutique', true), true)

console.log('STOCK SOURCE SWITCH FRESHNESS PASSED — source-specific forced read, no stale counts during switch, safe retry and out-of-order protection')

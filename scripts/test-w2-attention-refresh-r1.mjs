import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  check(start >= 0, `Marker missing: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(end > start, `End marker missing after: ${startMarker}`)
  return source.slice(start, end)
}

try {
  const pkg = JSON.parse(read('package.json'))
  const app = read('src/App.tsx')
  const warehouseSnapshots = read('src/features/inventory/useWarehouseSnapshots.ts')
  const actions = read('src/features/inventory/useInventoryAttentionActions.ts')
  const recovery = read('src/features/inventory/warehouseRecoveryActions.ts')
  const worker = read('worker/domains/warehouse-attention.ts')

  check(String(pkg.scripts?.['release:check'] || '').includes('node scripts/test-w2-attention-refresh-r1.mjs'), 'R1 regression is not chained into release:check')

  const openPanelStart = app.indexOf('const openInventoryPanel = (panel: InventoryPanel) => {')
  check(openPanelStart >= 0, 'openInventoryPanel missing')
  const openPanel = app.slice(openPanelStart, openPanelStart + 1800)
  check(!openPanel.includes("if (nextPanel === 'attention') void loadWarehouseAttention(true)"), 'Attention still starts a duplicate detail request from navigation')

  check(app.includes('useWarehouseSnapshots({'), 'App is not wired to the Warehouse snapshot controller')
  const loader = between(warehouseSnapshots, '  async function loadWarehouseAttention(details = false, force = false) {', '  async function loadInventoryData(')
  check(loader.includes("const shouldLoadDetails = details || (activeSector === 'inventory' && inventoryPanel === 'attention')"), 'Attention panel does not force detailed data shape')
  check(loader.includes('setWarehouseAttention((current) => current?.items ? current : cached.data)'), 'Cached summary can still erase already loaded detail items')
  const inflight = between(loader, '      if (warehouseAttentionSummaryInFlight) {', '    const requestToken = ++warehouseAttentionRequestToken')
  check(inflight.includes('return await warehouseAttentionSummaryInFlight'), 'Summary in-flight reuse missing')
  check(!inflight.includes('setWarehouseAttention'), 'Summary waiter can still overwrite a newer detailed response')
  check(loader.includes("shouldLoadDetails ? '?details=1&limit=30' : ''"), 'Detailed request is not tied to the effective Attention state')

  const refresh = between(actions, '  async function refreshWarehouseAttention() {', '  useEffect(() => {')
  check(refresh.includes('if (!data?.items) throw new Error'), 'Failed detail load is still silently rendered as an empty problem list')
  const effect = between(actions, "  useEffect(() => {\n    if (activeSector !== 'inventory' || inventoryPanel !== 'attention') return", '  async function openAttentionLifecycle')
  check(effect.includes('void refreshWarehouseAttention()'), 'Attention no longer loads details on panel entry')

  const intake = between(actions, '  async function openAttentionIntake(item: any) {', '  function openAttentionHandover')
  check(intake.includes('else if (!result?.warehouseAttention) await loadWarehouseAttention(true)'), 'Intake still performs a second detailed Attention read when reconciliation already returned refreshed data')
  check(app.includes('createWarehouseRecoveryActions({'), 'Warehouse recovery module no longer connected to App')
  const reconcileStart = recovery.indexOf('  async function reconcileKnownInventoryLifecycle(eventId: number) {')
  check(reconcileStart >= 0, 'reconcileKnownInventoryLifecycle missing')
  const reconcile = recovery.slice(reconcileStart, reconcileStart + 2400)
  check(reconcile.includes('const [attentionData] = await Promise.all(['), 'Intake reconciliation does not retain its already loaded Attention payload')
  check(reconcile.includes('return { ...result, warehouseAttention: attentionData }'), 'Intake reconciliation does not return reusable Attention data')

  check(worker.includes('if (!details) {') && worker.includes('response.items = {'), 'Warehouse Attention API summary/detail contract changed unexpectedly')
  // Call the exact compiled production implementation, not a duplicate simulation.
  const compiled = await build({
    entryPoints: ['src/features/inventory/warehouseRecoveryActions.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
  })
  const { createWarehouseRecoveryActions } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
  )
  const calls = []
  const attentionData = { ok: true, total: 1, counts: { unresolved: 1 }, items: [{ id: 45 }] }
  let attentionReads = 0
  let inventoryReads = 0
  let busyState = false
  let lastMessage = ''
  const recoveryActions = createWarehouseRecoveryActions({
    canManageWarehouse: true, catalogReview: null, catalogReviewBusy: false,
    setCatalogReview: () => {}, setCatalogReviewBusy: () => {},
    inventoryLifecycle: null, inventoryLifecycleBusy: false,
    setInventoryLifecycle: () => {}, setInventoryLifecycleBusy: next => { busyState = next },
    apiFetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' })
      return new Response(JSON.stringify({ ok: true, message: 'Приёмка завершена', pending: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    },
    setError: () => {}, setMessage: next => { lastMessage = next },
    loadInventoryData: async () => { inventoryReads += 1; return { ok: true, items: [] } },
    loadCatalogData: async () => ({ ok: true, products: [], variants: [] }),
    loadReferencesData: async () => null,
    loadWarehouseAttention: async details => {
      assert.equal(details, true, 'Known physical intake must refresh detailed Attention once')
      attentionReads += 1
      return attentionData
    },
  })
  const receipt = await recoveryActions.reconcileKnownInventoryLifecycle(45)
  assert.equal(receipt.warehouseAttention, attentionData, 'The refreshed Attention payload must be returned for reuse')
  assert.equal(attentionReads, 1, 'A known physical intake must not double-fetch detailed warehouse Attention')
  assert.equal(inventoryReads, 2, 'Reconciliation refresh must include Warehouse and Boutique')
  assert.deepEqual(calls.map(call => call.url), [
    '/api/inventory/lifecycle/45/reconcile-known',
    '/api/inventory/lifecycle/pending?limit=60',
  ], 'The physical intake must preserve original POST and pending-reconciliation GET routes')
  assert.equal(calls[0].method, 'POST')
  assert.equal(lastMessage, 'Приёмка завершена')
  assert.equal(busyState, false, 'Completed reconciliation must clear its pending-list loading flag')

  const blockedCalls = []
  let resetLifecycle = false
  const restricted = createWarehouseRecoveryActions({
    canManageWarehouse: false, catalogReview: null, catalogReviewBusy: false,
    setCatalogReview: () => {}, setCatalogReviewBusy: () => {},
    inventoryLifecycle: null, inventoryLifecycleBusy: false,
    setInventoryLifecycle: next => { resetLifecycle = next === null },
    setInventoryLifecycleBusy: () => {},
    apiFetch: async url => { blockedCalls.push(url); throw new Error('Should not contact server') },
    setError: () => {}, setMessage: () => {},
    loadInventoryData: async () => null, loadCatalogData: async () => null,
    loadReferencesData: async () => null, loadWarehouseAttention: async () => null,
  })
  assert.equal(await restricted.loadCatalogReview(true), null)
  assert.equal(await restricted.loadInventoryLifecycle(true), null)
  assert.equal(await restricted.resolveCatalogReviewItem(33, 44), false)
  assert.equal(await restricted.resolveCatalogReviewFacts(33, { productId: 1 }), null)
  assert.equal(resetLifecycle, true, 'No warehouse role must clear privileged pending lifecycle data')
  assert.equal(blockedCalls.length, 0, 'Non-warehouse roles cannot make privileged recovery requests')

  console.log('W2 ATTENTION REFRESH R1 TESTS PASSED — detailed inbox wins summary races, entry has one owner, detail failures are visible, intake reuses its refresh')
} catch (error) {
  console.error(`W2 ATTENTION REFRESH R1 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

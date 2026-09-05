import fs from 'node:fs'
import path from 'node:path'

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
  const actions = read('src/features/inventory/useInventoryAttentionActions.ts')
  const worker = read('worker/domains/warehouse-attention.ts')

  check(String(pkg.scripts?.['release:check'] || '').includes('node scripts/test-w2-attention-refresh-r1.mjs'), 'R1 regression is not chained into release:check')

  const openPanelStart = app.indexOf('const openInventoryPanel = (panel: InventoryPanel) => {')
  check(openPanelStart >= 0, 'openInventoryPanel missing')
  const openPanel = app.slice(openPanelStart, openPanelStart + 1800)
  check(!openPanel.includes("if (nextPanel === 'attention') void loadWarehouseAttention(true)"), 'Attention still starts a duplicate detail request from navigation')

  const loader = between(app, '  async function loadWarehouseAttention(details = false, force = false) {', '  async function loadInventoryData(')
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
  const reconcileStart = app.indexOf('  async function reconcileKnownInventoryLifecycle(eventId: number) {')
  check(reconcileStart >= 0, 'reconcileKnownInventoryLifecycle missing')
  const reconcile = app.slice(reconcileStart, reconcileStart + 2400)
  check(reconcile.includes('const [attentionData] = await Promise.all(['), 'Intake reconciliation does not retain its already loaded Attention payload')
  check(reconcile.includes('return { ...result, warehouseAttention: attentionData }'), 'Intake reconciliation does not return reusable Attention data')

  check(worker.includes('if (!details) {') && worker.includes('response.items = {'), 'Warehouse Attention API summary/detail contract changed unexpectedly')
  console.log('W2 ATTENTION REFRESH R1 TESTS PASSED — detailed inbox wins summary races, entry has one owner, detail failures are visible, intake reuses its refresh')
} catch (error) {
  console.error(`W2 ATTENTION REFRESH R1 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

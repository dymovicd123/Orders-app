import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const section = read('src/features/sections/InventorySection.tsx')
const attention = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const actions = read('src/features/inventory/useInventoryAttentionActions.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const stocktake = read('worker/domains/inventory-stocktake.ts')
const manifest = JSON.parse(read('scripts/w3-2-natural-recovery-frontend-manifest.json'))
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')

const between = (text, start, end) => {
  const a = text.indexOf(start)
  check(a >= 0, `Missing start: ${start}`)
  const b = text.indexOf(end, a + start.length)
  check(b > a, `Missing end: ${end}`)
  return text.slice(a, b)
}

check(section.includes('const warehousePendingIntakeCount = Number(warehouseAttention?.counts?.intake || 0)'), 'known intake count is not separated')
check(section.includes('const warehouseClarificationCount = Number(warehouseAttention?.counts?.handover || 0)') && section.includes('warehouseAttention?.counts?.lifecycle') && section.includes('warehouseAttention?.counts?.catalog'), 'clarification badge is not limited to true ambiguity')
const nav = between(section, '<div className="warehouse-w2-secondary">', '</div>\n              </div>')
check(nav.includes('Ожидают приёма') && nav.includes("setAttentionCategory('intake')"), 'known intake has no separate secondary entry')
check(nav.includes('Нужно уточнить') && nav.includes("? 'handover' : 'identify'"), 'clarification navigation does not select only true ambiguity')
check(!nav.includes('warehouseAttention?.total'), 'legacy all-problem total still drives clarification badge')

check(attention.includes("type AttentionCategory = 'handover' | 'intake' | 'identify'"), 'Attention still treats count/revision as recovery categories')
check(!attention.includes("value: 'count'") && !attention.includes("value: 'revision'"), 'count/revision tabs remain in clarification')
check(!attention.includes('items.shortages') && !attention.includes('items.stocktakes'), 'shortage/stocktake content remains inside clarification')
check(attention.includes("isIntake ? 'Ожидают приёма' : 'Нужно уточнить'"), 'intake and clarification are not presented as separate human surfaces')
check(attention.includes('если вы сейчас не рядом со складом или не уверены — просто оставьте её как есть'), 'intake UI became coercive instead of optional')
check(attention.includes('Нехватка и ревизии решаются в своих обычных разделах'), 'natural recovery location is not explained')

check(!actions.includes('openAttentionShortage') && !actions.includes('openAttentionStocktake'), 'obsolete recovery actions remain wired')
const quick = between(actions, '  async function applyQuickStocktake', '  async function refreshWarehouseAttention')
check(!quick.includes('loadWarehouseAttention('), 'successful quick check still spends a detailed Attention read')
check(quick.includes('const successNotice') && quick.includes('Остаток сохранён; список обновится при следующем обновлении.'), 'post-write refresh can still make a successful check look failed')
const intake = between(actions, '  async function openAttentionIntake', '  function openAttentionHandover')
check(intake.includes('else if (!result?.warehouseAttention) await loadWarehouseAttention(true)'), 'intake no longer reuses an already returned Attention payload')

const disposition = between(lifecycle, 'export async function inventoryLifecycleDeferredInboundDisposition(', 'export async function supersedeInventoryLifecycleInboundWithoutStockChange')
const laterPos = disposition.indexOf('SELECT id FROM inventory_stock_checks')
const boundaryPos = disposition.indexOf('trustedInventoryFullStocktakeBoundary')
check(laterPos >= 0 && boundaryPos > laterPos, 'newer exact physical fact is still ignored until after full-stocktake boundary')
check(disposition.includes('if (checkLaterPhysical && exactVariantId > 0 && createdAt)'), 'fresh-event read optimization missing')
check(lifecycle.includes("inventoryLifecycleDeferredInboundDisposition(db, event, exactVariantId, false)"), 'fresh Workshop intake pays an unnecessary historical-check read')

const quickBatch = between(stocktake, 'export async function quickInventoryStocktakeBatch(', 'export async function quickInventoryStocktake(')
check(quickBatch.includes('supersedeKnownWorkshopInbound') && quickBatch.includes("status = 'pending' AND direction = 'in' AND is_workshop = 1"), 'quick physical fact does not retire older known Workshop intake')
check(quickBatch.includes('await db.batch([guard, updateExisting, insertMissing, insertMovements, insertChecks, supersedeKnownWorkshopInbound])'), 'physical fact and intake retirement are not atomic')
const completion = between(stocktake, 'export async function completeInventoryStocktakeSession(', 'export async function cancelInventoryStocktakeSession')
check(completion.includes("UPDATE inventory_lifecycle_events") && completion.includes("datetime(i.counted_at) >= datetime(inventory_lifecycle_events.created_at)"), 'completed stocktake does not use per-SKU count time to retire older intake safely')
check(completion.includes("is_workshop = 1"), 'stocktake recovery is not narrowly scoped to known Workshop inbound')

check(manifest.version === 1 && manifest.revision === 'w3-2-natural-recovery', 'W3.2 frontend manifest invalid')
check(Boolean(manifest.frontend?.attentionReturnChange), 'W3.2 Attention preservation delta missing')
check(preservation.includes('w3NaturalRecoveryPath') && preservation.includes('W3.2 Attention baseline'), 'frontend preservation chain is unaware of W3.2')

check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.2 NATURAL RECOVERY PASSED — clarification is true ambiguity, intake is separate, and newer physical facts retire stale known intake without extra Attention reads')

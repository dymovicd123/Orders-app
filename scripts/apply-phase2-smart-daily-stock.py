from pathlib import Path


def read(file):
    return Path(file).read_text(encoding='utf-8')


def write(file, text):
    path = Path(file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def replace_one(text, before, after, label):
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f'Phase 2 patch target count {count}: {label}')
    return text.replace(before, after, 1)

# 1) Routine recommendation read becomes worker-safe while mutations/revision stay admin-only.
file = 'worker/index.ts'
text = read(file)
text = replace_one(text, """      if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await listInventoryCycleCountSuggestions(env.DB, url));
      }""", """      if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {
        return json(await listInventoryCycleCountSuggestions(env.DB, url));
      }""", 'cycle-count recommendation read gate')
write(file, text)

# 2) Controller: reuse existing safe exact quick-check; do not add React hooks.
file = 'src/features/sections/InventorySection.tsx'
text = read(file)
text = replace_one(text,
"import { useInventoryAttentionActions } from '../inventory/useInventoryAttentionActions'",
"import { useInventoryAttentionActions } from '../inventory/useInventoryAttentionActions'\nimport { runRoutineCycleCount } from '../inventory/routineCycleCount'",
'routine helper import')
text = replace_one(text, """  const stocktakeActiveForSelectedSource = stocktakeActiveSessions.find((entry: any) => entry.source === stocktakeSource) || null
  const cycleCountFilledCount = Object.values(cycleCountValues).filter((value) => value !== '').length

  async function refreshCycleCountSuggestions(source: StocktakeSource = stocktakeSource, keepNotice = false) {
    if (!isAdmin) return""", """  const stocktakeActiveForSelectedSource = stocktakeActiveSessions.find((entry: any) => entry.source === stocktakeSource) || null
  const cycleCountFilledCount = Object.values(cycleCountValues).filter((value) => value !== '').length
  const submitRoutineCycleCount = (row: any, countedQuantity: number) => runRoutineCycleCount({ row, countedQuantity, source: simpleStockSource, busy: cycleCountBusy, quickInventoryStocktake, refreshInventoryModule, refreshSuggestions: refreshCycleCountSuggestions, setBusy: setCycleCountBusy, setNotice: setCycleCountNotice, setData: setCycleCountData, setValues: setCycleCountValues })

  async function refreshCycleCountSuggestions(source: StocktakeSource = stocktakeSource, keepNotice = false, limit = 12) {""", 'routine submit wrapper and loader signature')
text = replace_one(text, """      const data = await loadInventoryCycleCounts(source, 12)
      if (seq !== cycleCountLoadSeq.current) return
      setCycleCountData(data)""", """      const data = await loadInventoryCycleCounts(source, limit <= 5 ? 12 : limit)
      if (seq !== cycleCountLoadSeq.current) return
      setCycleCountData(limit <= 5 ? {
        ...data,
        items: (data.items || []).filter((row: any) => !(row.lastCheckedAt && row.daysSinceCheck === 0 && row.movementsSinceCheck === 0)).slice(0, limit),
      } : data)""", 'routine capped recommendation batch')
text = replace_one(text, """  useEffect(() => {
    if (inventoryPanel !== 'stocktake' || !isAdmin || stocktakeSession) return
    setCycleCountValues({})
    void refreshCycleCountSuggestions(stocktakeSource)
  }, [inventoryPanel, isAdmin, stocktakeSource, stocktakeSession?.id])""", """  useEffect(() => {
    if (inventoryPanel === 'overview' && activeSector === 'inventory') {
      setCycleCountValues({})
      void refreshCycleCountSuggestions(simpleStockSource, false, 5)
      return
    }
    if (inventoryPanel !== 'stocktake' || !isAdmin || stocktakeSession) return
    setCycleCountValues({})
    void refreshCycleCountSuggestions(stocktakeSource)
  }, [inventoryPanel, activeSector, isAdmin, simpleStockSource, stocktakeSource, stocktakeSession?.id])""", 'overview recommendation load effect')
text = replace_one(text, """        applyQuickStocktake,
        formatMoney,""", """        applyQuickStocktake,
        cycleCountBusy,
        cycleCountData,
        cycleCountLoading,
        cycleCountNotice,
        cycleCountValues,
        formatMoney,""", 'overview routine state props')
text = replace_one(text, """        quickStocktakeValues,
        refreshInventoryModule,""", """        quickStocktakeValues,
        refreshCycleCountSuggestions,
        refreshInventoryModule,""", 'overview routine refresh prop')
text = replace_one(text, """        simpleStockStats,
        sourceLabel""", """        simpleStockStats,
        sourceLabel,
        submitRoutineCycleCount""", 'overview routine submit prop')
write(file, text)

# 3) Pure async routine action.
write('src/features/inventory/routineCycleCount.ts', r'''type RoutineCycleCountArgs = {
  row: any
  countedQuantity: number
  source: 'warehouse' | 'boutique'
  busy: boolean
  quickInventoryStocktake: (input: { source: 'warehouse' | 'boutique'; variantId: number; expectedQuantity: number; countedQuantity: number }) => Promise<any>
  refreshInventoryModule: (force?: boolean) => Promise<any>
  refreshSuggestions: (source: 'warehouse' | 'boutique', keepNotice?: boolean, limit?: number) => Promise<any>
  setBusy: (value: boolean) => void
  setNotice: (value: string) => void
  setData: (update: any) => void
  setValues: (update: any) => void
}

export async function runRoutineCycleCount(args: RoutineCycleCountArgs) {
  const { row, countedQuantity, source, busy, quickInventoryStocktake, refreshInventoryModule, refreshSuggestions, setBusy, setNotice, setData, setValues } = args
  if (busy) return
  const numeric = Number(countedQuantity)
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
    setNotice('Укажите целое фактическое количество 0 или больше.')
    return
  }
  setBusy(true)
  setNotice('')
  try {
    const result = await quickInventoryStocktake({ source, variantId: Number(row.variantId), expectedQuantity: Number(row.physical || 0), countedQuantity: numeric })
    if (!result?.ok) {
      setNotice(result?.message || 'Остаток изменился. Обновите данные и пересчитайте позицию.')
      if (result?.code === 'changed') {
        setValues((current: any) => ({ ...current, [String(row.variantId)]: '' }))
        await refreshInventoryModule(true)
        await refreshSuggestions(source, true, 5)
      }
      return
    }
    setData((current: any) => current?.source === source ? { ...current, items: (current.items || []).filter((item: any) => Number(item.variantId) !== Number(row.variantId)) } : current)
    setValues((current: any) => ({ ...current, [String(row.variantId)]: '' }))
    setNotice(Boolean(result.changed) ? `Фактическое количество «${row.productName}» сохранено.` : `Совпадение «${row.productName}» подтверждено.`)
    await refreshInventoryModule(true)
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Не удалось сохранить короткую сверку.')
  } finally {
    setBusy(false)
  }
}
''')

# 4) Overview helper.
file = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
text = read(file)
text = replace_one(text, """  | 'applyQuickStocktake'
  | 'formatMoney'""", """  | 'applyQuickStocktake'
  | 'cycleCountBusy'
  | 'cycleCountData'
  | 'cycleCountLoading'
  | 'cycleCountNotice'
  | 'cycleCountValues'
  | 'formatMoney'""", 'overview routine context keys A')
text = replace_one(text, """  | 'quickStocktakeValues'
  | 'refreshInventoryModule'""", """  | 'quickStocktakeValues'
  | 'refreshCycleCountSuggestions'
  | 'refreshInventoryModule'""", 'overview routine context keys B')
text = replace_one(text, """  | 'simpleStockStats'
  | 'sourceLabel'""", """  | 'simpleStockStats'
  | 'sourceLabel'
  | 'submitRoutineCycleCount'""", 'overview routine context keys C')
helper = r'''

function renderRoutineCycleCountCue(ctx: PanelContext) {
  const { cycleCountBusy, cycleCountData, cycleCountLoading, cycleCountNotice, cycleCountValues, isAdmin, openInventoryPanel, refreshCycleCountSuggestions, setCycleCountValues, simpleStockSource, submitRoutineCycleCount } = ctx as any
  const current = cycleCountData?.source === simpleStockSource ? cycleCountData : null
  if (!current && !cycleCountLoading && !cycleCountNotice) return null
  if (current?.blockedByStocktake) return (
    <section className="inventory-cycle-count-card is-calm" data-smart-daily-stock="routine">
      <div className="inventory-cycle-count-state"><div><strong>Незавершённая ревизия блокирует короткие сверки</strong><span>Пока ревизия этой точки не завершена или не отменена, система не меняет физический факт отдельными проверками.</span></div>{isAdmin ? <button className="secondary compact" type="button" onClick={() => openInventoryPanel('stocktake')}>Открыть ревизию</button> : null}</div>
    </section>
  )
  const rows = (current?.items || []).slice(0, 5)
  if (!rows.length) return cycleCountNotice ? <div className="inventory-cycle-count-notice" data-smart-daily-stock="routine">{cycleCountNotice}</div> : null
  return (
    <section className="inventory-cycle-count-card is-calm" data-smart-daily-stock="routine">
      <div className="inventory-cycle-count-head"><div><span className="stocktake-step-kicker">Поддержание точности</span><strong>Полезно сверить сейчас</strong><small>Небольшая пачка позиций, которые стоит проверить по пути. Это не обязательная очередь.</small></div><button className="ghost compact" type="button" disabled={cycleCountBusy || cycleCountLoading} onClick={() => void refreshCycleCountSuggestions(simpleStockSource, false, 5)}>{cycleCountLoading ? 'Обновляю…' : 'Другие позиции'}</button></div>
      <div className="inventory-cycle-count-list">
        {rows.map((row: any) => {
          const value = cycleCountValues[String(row.variantId)] ?? ''
          const attrs = [row.material !== 'СТАНДАРТ' ? row.material : '', row.length !== 'СТАНДАРТ' ? row.length : '', row.gender, row.color, row.size].filter(Boolean).join(' · ')
          return <div className={`inventory-cycle-count-row is-routine ${Number(row.free || 0) < 0 ? 'needs-attention' : ''}`} key={`routine-cycle-${row.variantId}`}>
            <div className="inventory-cycle-count-name"><strong>{row.productName}</strong><span>{attrs || 'Стандартная комбинация'}</span><small>{(row.reasons || [])[0] || 'Полезно подтвердить физический остаток'}</small></div>
            <div className="inventory-cycle-count-system"><span>На месте <strong>{row.physical}</strong></span>{Number(row.reserved || 0) ? <span>В заказах <strong>{row.reserved}</strong></span> : null}</div>
            <div className="inventory-routine-cycle-actions"><button className="secondary compact" type="button" disabled={cycleCountBusy} onClick={() => void submitRoutineCycleCount(row, Number(row.physical || 0))}>Совпадает: {row.physical}</button><details className="inventory-routine-cycle-other"><summary>Другое количество</summary><div className="inventory-routine-cycle-edit"><input aria-label={`Фактическое количество ${row.productName}`} type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(event) => { const raw = event.target.value; if (raw === '') return setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: '' })); const parsed = Number(raw); if (Number.isFinite(parsed)) setCycleCountValues((state: any) => ({ ...state, [String(row.variantId)]: String(Math.max(0, Math.trunc(parsed))) })) }} /><button className="primary compact" type="button" disabled={cycleCountBusy || value === ''} onClick={() => void submitRoutineCycleCount(row, Number(value))}>Сохранить факт</button></div></details></div>
          </div>
        })}
      </div>
      {cycleCountNotice ? <div className="inventory-cycle-count-notice">{cycleCountNotice}</div> : null}
    </section>
  )
}
'''
text = replace_one(text, '\n\nexport function renderInventoryOverviewPanel(ctx: PanelContext) {', helper + '\nexport function renderInventoryOverviewPanel(ctx: PanelContext) {', 'overview routine helper insertion')
text = replace_one(text, """                    </div>
    
                    <div className="inventory-calm-filters">""", """                    </div>

                    {renderRoutineCycleCountCue(ctx)}
    
                    <div className="inventory-calm-filters">""", 'overview routine cue placement')
write(file, text)

# 5) Responsive styling.
file = 'src/styles/188i-cycle-counts.css'
text = read(file)
addition = r'''
.inventory-cycle-count-row.is-routine{grid-template-columns:minmax(220px,1fr) auto minmax(190px,auto)}
.inventory-routine-cycle-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
.inventory-routine-cycle-other{position:relative}
.inventory-routine-cycle-other>summary{cursor:pointer;font-size:10px;font-weight:700;color:var(--muted-text,#64748b);list-style:none}
.inventory-routine-cycle-other>summary::-webkit-details-marker{display:none}
.inventory-routine-cycle-edit{display:flex;gap:6px;align-items:center;margin-top:6px;padding:7px;border-radius:9px;background:var(--panel-subtle,#f8fafc)}
.inventory-routine-cycle-edit input{width:68px!important;min-width:0!important;text-align:center;font-weight:700}
@media(max-width:820px){.inventory-cycle-count-row.is-routine{grid-template-columns:minmax(0,1fr)}.inventory-cycle-count-row.is-routine .inventory-cycle-count-system{grid-column:1;justify-content:flex-start}.inventory-routine-cycle-actions{justify-content:flex-start}.inventory-routine-cycle-actions>.secondary{flex:1 1 auto}}
@media(max-width:560px){.inventory-routine-cycle-actions{display:grid;grid-template-columns:1fr}.inventory-routine-cycle-actions>.secondary,.inventory-routine-cycle-other{width:100%}.inventory-routine-cycle-edit{display:grid;grid-template-columns:76px 1fr}.inventory-routine-cycle-edit .primary{width:100%}}
'''
if '.inventory-cycle-count-row.is-routine' not in text:
    text += addition
write(file, text)

# 6) Regression and release wiring.
write('scripts/test-phase2-smart-daily-stock.mjs', r'''import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
function section(text, startMarker, endMarker) { const start = text.indexOf(startMarker); check(start >= 0, `Section start missing: ${startMarker}`); const end = text.indexOf(endMarker, start + startMarker.length); check(end > start, `Section end missing: ${endMarker}`); return text.slice(start, end) }

try {
  const worker = read('worker/index.ts')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const routine = read('src/features/inventory/routineCycleCount.ts')
  const css = read('src/styles/188i-cycle-counts.css')
  const pkg = JSON.parse(read('package.json'))
  const readRoute = section(worker, "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET')", "if (url.pathname === '/api/inventory/cycle-counts/apply' && request.method === 'POST')")
  const batchRoute = section(worker, "if (url.pathname === '/api/inventory/cycle-counts/apply' && request.method === 'POST')", "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET')")
  const fullRoute = section(worker, "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'POST')", "if (url.pathname === '/api/inventory/stocktakes/quick-batch' && request.method === 'POST')")
  const exactRoute = section(worker, "if (url.pathname === '/api/inventory/stocktakes/quick' && request.method === 'POST')", 'const inventoryStocktakeMatch')
  check(!readRoute.includes('requireAdminAccess'), 'Routine recommendations remain admin-only')
  check(batchRoute.includes('requireAdminAccess'), 'Admin cycle batch mutation was opened')
  check(fullRoute.includes('requireAdminAccess'), 'Full/selective revision creation was opened')
  check(!exactRoute.includes('requireAdminAccess'), 'Safe exact quick check is no longer available to workers')
  check(worker.includes('request = withAuthenticatedHeaders(request, authUser)'), 'Server-owned access role headers are not enforced')
  const loader = section(inventory, 'async function refreshCycleCountSuggestions', 'async function submitCycleCount')
  check(loader.includes('limit = 12'), 'Routine loader has no explicit batch limit')
  check(loader.includes('limit <= 5 ? 12 : limit'), 'Routine loader does not keep enough candidates for filtering')
  check(loader.includes('row.lastCheckedAt && row.daysSinceCheck === 0 && row.movementsSinceCheck === 0'), 'Just-confirmed SKU suppression is missing')
  check(!loader.includes('if (!isAdmin) return'), 'Routine loader still blocks workers')
  check(inventory.includes("inventoryPanel === 'overview'"), 'Routine suggestions are not loaded in Остатки')
  check(inventory.includes('refreshCycleCountSuggestions(simpleStockSource, false, 5)'), 'Остатки does not request a five-item attention budget')
  check(inventory.includes('runRoutineCycleCount'), 'Routine exact-confirm action is not wired')
  check(routine.includes('await quickInventoryStocktake({'), 'Routine action does not reuse exact quick check')
  check(routine.includes('items: (current.items || []).filter((item: any) => Number(item.variantId) !== Number(row.variantId))'), 'Confirmed SKU does not disappear immediately')
  check(routine.includes("result?.code === 'changed'"), 'Stale race does not force a refresh/recount')
  check(overview.includes('data-smart-daily-stock="routine"'), 'Smart Daily Stock Truth is absent from Остатки')
  check(overview.includes('Полезно сверить сейчас'), 'Routine cue wording is missing')
  check(overview.includes('Совпадает:'), 'One-tap matching action is missing')
  check(overview.includes('Другое количество'), 'Mismatch action is missing')
  check(overview.includes('Незавершённая ревизия блокирует короткие сверки'), 'Active-revision explanation is missing')
  check(overview.includes('(row.reasons || [])[0]'), 'Routine view does not reduce each SKU to one dominant reason')
  check(!section(overview, 'function renderRoutineCycleCountCue', 'export function renderInventoryOverviewPanel').includes('recommendedCount'), 'Routine view exposes the total backlog')
  check(css.includes('.inventory-cycle-count-row.is-routine') && css.includes('@media(max-width:560px)'), 'Routine batch has no small-screen layout')
  check(String(pkg.scripts?.['release:check'] || '').includes('test-phase2-smart-daily-stock.mjs'), 'Phase 2 regression is not wired into release:check')
  console.log('PHASE 2 SMART DAILY STOCK TRUTH TESTS PASSED — manager-safe read, 5-item Остатки batch, one-tap match, mismatch entry, stale guard and calm blocker are enforced')
} catch (error) { console.error(`PHASE 2 SMART DAILY STOCK TRUTH TESTS FAILED: ${error?.message || error}`); process.exit(1) }
''')

file = 'package.json'
text = read(file)
text = replace_one(text,
'"release:check": "node scripts/release-check.mjs && node scripts/test-phase1c-workshop-return-safety.mjs && node scripts/test-stocktake-functional-acceptance.mjs"',
'"release:check": "node scripts/release-check.mjs && node scripts/test-phase1c-workshop-return-safety.mjs && node scripts/test-phase2-smart-daily-stock.mjs && node scripts/test-stocktake-functional-acceptance.mjs"',
'release check Phase 2 wiring')
write(file, text)

# 7) Preservation tests normalize only the audited Phase 2 deltas.
file = 'scripts/test-step1906a-worker-modularization.mjs'
text = read(file)
text = replace_one(text, """  const normalizedRouter = currentRouter
    .replace(/\\n\\s*orderCreateSaveIntegrity:""", """  const normalizedRouter = currentRouter
    .replace(
      "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {\\n        return json(await listInventoryCycleCountSuggestions(env.DB, url));\\n      }",
      "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {\\n        const denied = requireAdminAccess(request);\\n        if (denied) return denied;\\n        return json(await listInventoryCycleCountSuggestions(env.DB, url));\\n      }",
    )
    .replace(/\\n\\s*orderCreateSaveIntegrity:""", 'worker preservation Phase 2 normalization')
write(file, text)

file = 'scripts/test-step1906b-frontend-modularization.mjs'
text = read(file)
text = replace_one(text, """    let text = expression.getText(parsed.source)
    if (panel.allowedTransform === 'String(field)->field')""", """    let text = expression.getText(parsed.source)
    if (panel.func === 'renderInventoryOverviewPanel') text = text.replace('{renderRoutineCycleCountCue(ctx)}', '')
    if (panel.allowedTransform === 'String(field)->field')""", 'frontend preservation Phase 2 normalization')
text = replace_one(text, "check(lineCount('src/features/sections/InventorySection.tsx') <= 2550,", "check(lineCount('src/features/sections/InventorySection.tsx') <= 2580,", 'Inventory controller Phase 2 budget')
write(file, text)

# Temporary capture helper is no longer needed.
Path('scripts/capture-phase2-smart-daily-stock-baseline.mjs').unlink(missing_ok=True)
print('PHASE 2 SMART DAILY STOCK PATCH APPLIED')

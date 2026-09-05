from pathlib import Path
import json

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

renderer_path = 'src/features/inventory/views/renderInventoryStocktakePanel.tsx'
section_path = 'src/features/sections/InventorySection.tsx'
css_path = 'src/styles/w5-3-selective-queue.css'
preservation_path = 'scripts/test-step1906b-frontend-modularization.mjs'
w52_test_path = 'scripts/test-w5-2-short-check.mjs'
w53_test_path = 'scripts/test-w5-3-selective-queue.mjs'
package_path = 'package.json'
doc_path = 'docs/continuation/W5_3R_UNIFIED_CHECK_20260905.md'

renderer = read(renderer_path)

# Retire the duplicated old short-check card from the Check page. The same low-risk
# one-click cycle-count flow remains in Остатки; Check now has one selection workflow.
start_marker = '                              <section className={`inventory-cycle-count-card ${Number(cycleCountData?.recommendedCount || 0) > 0 ? \'has-recommendations\' : \'is-calm\'}`}>'
end_marker = '                              <div className="stocktake-start-modes stocktake-start-modes-v5">'
start = renderer.find(start_marker)
end = renderer.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('W5.3R: old stocktake short-check block not found')
renderer = renderer[:start] + renderer[end:]

renderer = renderer.replace(
"  const selectiveQueueIsLarge = selectedStocktakePositionCount > 20\n",
"  const selectiveQueueIsLarge = selectedStocktakePositionCount > 20\n"
"  const recommendationData = cycleCountData?.source === stocktakeSource ? cycleCountData : null\n"
"  const recommendedProductIds = new Set((recommendationData?.items || []).map((row: any) => Number(row.productId || 0)).filter(Boolean))\n"
"  const recommendedStocktakeProducts = (stocktakeSelectableProducts || []).filter((product: any) => recommendedProductIds.has(Number(product.productId))).slice(0, 6)\n"
"  const unselectedRecommendedProducts = recommendedStocktakeProducts.filter((product: any) => !stocktakeSelectedProductIds.includes(Number(product.productId)))\n"
)

old_intro = "<p>{stocktakeActiveForSelectedSource ? 'Новая проверка этой точки недоступна, пока текущая не завершена или не отменена.' : 'Для обычной сверки выберите только нужные товары. Полную проверку запускайте, когда действительно пересчитываете всю точку.'}</p>"
new_intro = "<p>{stocktakeActiveForSelectedSource ? 'Новая проверка этой точки недоступна, пока текущая не завершена или не отменена.' : 'Выберите несколько товаров или запустите полную проверку точки.'}</p>"
if old_intro not in renderer:
    raise SystemExit('W5.3R: stocktake intro baseline not found')
renderer = renderer.replace(old_intro, new_intro, 1)

picker_marker = '                                <div className="stocktake-selective-picker stocktake-selective-picker-v5 stocktake-selective-picker-w5">\n                                  <div className="stocktake-selective-head">'
recommendations = '''                                <div className="stocktake-selective-picker stocktake-selective-picker-v5 stocktake-selective-picker-w5">
                                  <div className={`stocktake-selective-recommendations ${recommendedStocktakeProducts.length ? 'has-items' : 'is-calm'}`}>
                                    <div className="stocktake-selective-recommendations-head">
                                      <div>
                                        <span className="stocktake-step-kicker">Рекомендуем проверить</span>
                                        <strong>{cycleCountLoading && !recommendationData ? 'Подбираю товары…' : recommendedStocktakeProducts.length ? `${recommendedStocktakeProducts.length} ${recommendedStocktakeProducts.length === 1 ? 'товар' : recommendedStocktakeProducts.length < 5 ? 'товара' : 'товаров'}` : recommendationData ? 'Сейчас отдельных рекомендаций нет' : cycleCountNotice ? 'Не удалось подобрать рекомендации' : 'Подбираю товары…'}</strong>
                                        <small>{recommendedStocktakeProducts.length ? 'Подобраны по давности проверки, движениям и прошлым расхождениям.' : recommendationData ? 'Выберите нужные товары ниже.' : cycleCountNotice ? 'Товары ниже можно выбрать вручную.' : 'Список появится автоматически.'}</small>
                                      </div>
                                      {unselectedRecommendedProducts.length ? <button className="secondary compact stocktake-recommended-add-all" type="button" onClick={() => setStocktakeSelectedProductIds((current) => Array.from(new Set([...current, ...unselectedRecommendedProducts.map((product: any) => Number(product.productId))])))}>Добавить все</button> : (!recommendationData && cycleCountNotice ? <button className="secondary compact" type="button" disabled={cycleCountLoading} onClick={() => void refreshCycleCountSuggestions(stocktakeSource)}>{cycleCountLoading ? 'Загружаю…' : 'Повторить'}</button> : null)}
                                    </div>
                                    {recommendedStocktakeProducts.length ? <div className="stocktake-recommended-products">{recommendedStocktakeProducts.map((product: any) => {
                                      const selected = stocktakeSelectedProductIds.includes(Number(product.productId))
                                      return <button type="button" className={`stocktake-recommended-product ${selected ? 'is-selected' : ''}`} key={`stocktake-recommended-${product.productId}`} onClick={() => setStocktakeSelectedProductIds((current) => selected ? current.filter((id) => id !== Number(product.productId)) : [...current, Number(product.productId)])}><span><strong>{product.productName}</strong><small>{product.positionCount} поз.</small></span><b>{selected ? '✓ Выбрано' : 'Добавить'}</b></button>
                                    })}</div> : null}
                                  </div>
                                  <div className="stocktake-selective-head">'''
if picker_marker not in renderer:
    raise SystemExit('W5.3R: selective picker marker not found')
renderer = renderer.replace(picker_marker, recommendations, 1)

renderer = renderer.replace("'Соберите короткую проверку'", "'Соберите проверку'")
renderer = renderer.replace("{selectiveQueueIsLarge ? <div className=\"stocktake-selective-size-note\">Получилась довольно большая проверка. Можно начать как есть или убрать часть товаров и проверить их позже.</div> : <div className=\"stocktake-selective-size-note is-calm\">Короткую проверку можно закончить быстрее, а остальные товары добавить в следующий раз.</div>}", "{selectiveQueueIsLarge ? <div className=\"stocktake-selective-size-note\">Получилась довольно большая проверка. Можно начать как есть или убрать часть товаров и проверить их позже.</div> : null}")

# Remove no-longer-used direct short-check form values from this renderer's local destructuring.
for name in ['    cycleCountBusy,\n', '    cycleCountFilledCount,\n', '    cycleCountOpen,\n', '    cycleCountValues,\n', '    submitCycleCount,\n']:
    renderer = renderer.replace(name, '')

write(renderer_path, renderer)

section = read(section_path)
old_effect = '''  useEffect(() => {
    if (inventoryPanel === 'overview' && cycleCountData && cycleCountData.source !== simpleStockSource) {
      setCycleCountData(null)
      setCycleCountValues({})
    }
    if (inventoryPanel !== 'stocktake' || !isAdmin || stocktakeSession) return
    setCycleCountValues({})
    void refreshCycleCountSuggestions(stocktakeSource)
  }, [inventoryPanel, activeSector, isAdmin, simpleStockSource, stocktakeSource, stocktakeSession?.id, cycleCountData?.source])
'''
new_effect = '''  useEffect(() => {
    if (inventoryPanel === 'overview' && cycleCountData && cycleCountData.source !== simpleStockSource) {
      setCycleCountData(null)
      setCycleCountValues({})
    }
    if (inventoryPanel !== 'stocktake' || stocktakeSession || stocktakeStartMode !== 'selective') return
    if (cycleCountLoading || cycleCountData?.source === stocktakeSource || (!cycleCountData && cycleCountNotice)) return
    setCycleCountValues({})
    void refreshCycleCountSuggestions(stocktakeSource)
  }, [inventoryPanel, activeSector, simpleStockSource, stocktakeSource, stocktakeStartMode, stocktakeSession?.id, cycleCountData?.source, cycleCountLoading, cycleCountNotice])
'''
if old_effect not in section:
    raise SystemExit('W5.3R: cycle-count preload effect baseline not found')
section = section.replace(old_effect, new_effect, 1)
write(section_path, section)

css = read(css_path)
css += '''

/* W5.3R — recommendations are part of the same selective-check picker. */
.stocktake-selective-recommendations{display:grid;gap:10px;padding:12px;border:1px solid #dbe4f0;border-radius:13px;background:#fbfdff}
.stocktake-selective-recommendations.has-items{border-color:#bfdbfe;background:#f8fbff}
.stocktake-selective-recommendations-head{display:flex;align-items:center;justify-content:space-between;gap:14px;min-width:0}
.stocktake-selective-recommendations-head>div{display:grid;gap:3px;min-width:0}
.stocktake-selective-recommendations-head strong{font-size:14px;color:#0f172a}
.stocktake-selective-recommendations-head small{font-size:11px;line-height:1.4;color:#64748b}
.stocktake-recommended-products{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.stocktake-recommended-product{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;min-height:46px;padding:9px 10px;border:1px solid #dbe4f0;border-radius:10px;background:#fff;text-align:left;cursor:pointer}
.stocktake-recommended-product>span{display:grid;gap:2px;min-width:0}
.stocktake-recommended-product strong{font-size:12px;color:#0f172a;overflow-wrap:anywhere}
.stocktake-recommended-product small{font-size:10px;color:#64748b}
.stocktake-recommended-product b{font-size:11px;color:#2563eb;white-space:nowrap}
.stocktake-recommended-product.is-selected{border-color:#93c5fd;background:#eff6ff}
.stocktake-recommended-product.is-selected b{color:#1d4ed8}
.stocktake-e-start-button{min-height:48px;font-weight:800}

@media(max-width:680px){
  .stocktake-selective-recommendations{padding:10px}
  .stocktake-selective-recommendations-head{display:grid;grid-template-columns:1fr;gap:9px}
  .stocktake-selective-recommendations-head>button{width:100%;min-height:42px}
  .stocktake-recommended-products{grid-template-columns:1fr}
  .stocktake-recommended-product{min-height:48px}
  .stocktake-start-submit .stocktake-e-start-button{width:100%;min-height:50px}
}

@media(max-width:420px){
  .stocktake-recommended-product{align-items:flex-start}
  .stocktake-recommended-product b{white-space:normal;text-align:right}
}
'''
write(css_path, css)

# W5.2 remains protected in Остатки, where the small one-click physical check actually belongs.
w52_test = '''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const stocktake = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
const section = read('src/features/sections/InventorySection.tsx')
const css = read('src/styles/w5-2-short-check.css')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const w5 = JSON.parse(read('scripts/w5-checking-ux-frontend-manifest.json'))
const w52 = JSON.parse(read('scripts/w5-2-short-check-frontend-manifest.json'))

check(overview.includes('function renderRoutineCycleCountCue'), 'Short-check routine disappeared from Остатки')
check(overview.includes('Да, на месте {row.physical}'), 'Normal quick-check row has no one-click physical confirmation')
check(overview.includes("const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0"), 'Risk classification changed')
check(overview.includes('inventory-cycle-count-system is-blind'), 'Risk row no longer stays blind-first')
check(overview.includes('Сначала посчитайте физически'), 'Blind-first explanation missing')
check(overview.includes('submitRoutineCycleCount(row, Number(row.physical || 0))'), 'Quick confirmation no longer has the explicit routine submit owner')
check(overview.includes('Нет, другое количество'), 'Alternative physical count action missing')
check(!stocktake.includes('Это подсказка, а не блокировка работы.'), 'Conversation-derived copy leaked into Check UI')

check(section.includes("import '../../styles/w5-2-short-check.css'"), 'W5.2 responsive CSS not loaded')
for (const marker of ['@media(max-width:680px)', '@media(max-width:420px)', '.inventory-cycle-count-quick-confirm{', '.inventory-cycle-count-save-button{', 'min-height:50px']) {
  check(css.includes(marker), `W5.2 mobile/tap marker missing: ${marker}`)
}

check(w52.version === 1 && w52.revision === 'w5-2-short-check', 'W5.2 frontend manifest invalid')
check(w52.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.before === w5.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.after, 'W5.2 frontend preservation must chain from exact W5.1 renderer hash')
check(preservation.includes('w5ShortCheckPath') && preservation.includes('W5.2 short-check panel baseline hash mismatch'), '1906B preservation does not enforce W5.2 exact delta')

check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'Frozen Arrival add-position action changed')

console.log('W5.2 SHORT CHECK PASSED — quick physical check preserved in Остатки; risky rows remain blind-first')
'''
write(w52_test_path, w52_test)

w53 = read(w53_test_path)
w53 = w53.replace("  'Соберите короткую проверку',", "  'Соберите проверку',")
w53 = w53.replace("  'Получилась довольно большая проверка. Можно начать как есть или убрать часть товаров',", "  'Получилась довольно большая проверка. Можно начать как есть или убрать часть товаров',")
write(w53_test_path, w53)

preservation = read(preservation_path)
preservation = preservation.replace(
"const w5SelectiveQueuePath = path.join(root, 'scripts/w5-3-selective-queue-frontend-manifest.json')\n",
"const w5SelectiveQueuePath = path.join(root, 'scripts/w5-3-selective-queue-frontend-manifest.json')\nconst w5UnifiedCheckPath = path.join(root, 'scripts/w5-3r-unified-check-frontend-manifest.json')\n"
)
preservation = preservation.replace(
"  const w5SelectiveQueue = fs.existsSync(w5SelectiveQueuePath) ? JSON.parse(fs.readFileSync(w5SelectiveQueuePath, 'utf8')) : null\n",
"  const w5SelectiveQueue = fs.existsSync(w5SelectiveQueuePath) ? JSON.parse(fs.readFileSync(w5SelectiveQueuePath, 'utf8')) : null\n  const w5UnifiedCheck = fs.existsSync(w5UnifiedCheckPath) ? JSON.parse(fs.readFileSync(w5UnifiedCheckPath, 'utf8')) : null\n"
)
preservation = preservation.replace(
"  if (w5SelectiveQueue) check(w5SelectiveQueue.version === 1 && w5SelectiveQueue.revision === 'w5-3-selective-queue', 'W5.3 selective queue frontend manifest invalid')\n",
"  if (w5SelectiveQueue) check(w5SelectiveQueue.version === 1 && w5SelectiveQueue.revision === 'w5-3-selective-queue', 'W5.3 selective queue frontend manifest invalid')\n  if (w5UnifiedCheck) check(w5UnifiedCheck.version === 1 && w5UnifiedCheck.revision === 'w5-3r-unified-check', 'W5.3R unified check frontend manifest invalid')\n"
)
chain = '''    const w5SelectiveQueueChange = w5SelectiveQueue?.frontend?.panelReturnChanges?.[panel.func]
    if (w5SelectiveQueueChange) {
      check(w5SelectiveQueueChange.before === expectedPanelHash, `${panel.func}: W5.3 selective queue panel baseline hash mismatch`)
      expectedPanelHash = w5SelectiveQueueChange.after
    }
'''
chain_new = chain + '''    const w5UnifiedCheckChange = w5UnifiedCheck?.frontend?.panelReturnChanges?.[panel.func]
    if (w5UnifiedCheckChange) {
      check(w5UnifiedCheckChange.before === expectedPanelHash, `${panel.func}: W5.3R unified check panel baseline hash mismatch`)
      expectedPanelHash = w5UnifiedCheckChange.after
    }
'''
if chain not in preservation:
    raise SystemExit('W5.3R: preservation W5.3 chain not found')
preservation = preservation.replace(chain, chain_new, 1)
preservation = preservation.replace('W5/W5.2/W5.3 delta', 'W5/W5.2/W5.3/W5.3R delta')
write(preservation_path, preservation)

package = json.loads(read(package_path))
release = package['scripts']['release:check']
if 'test-w5-3r-unified-check.mjs' not in release:
    release += ' && node scripts/test-w5-3r-unified-check.mjs'
package['scripts']['release:check'] = release
write(package_path, json.dumps(package, ensure_ascii=False, indent=2) + '\n')

write(doc_path, '''# W5.3R — Unified Check, 2026-09-05

## Why
The Check start screen had two competing workflows: an older `Короткая проверка` card and the newer selective stocktake queue. The result looked like two generations of UI stacked together, recommendations could appear only after a manual refresh in some sessions, and the copy included implementation/conversation rationale that did not help the operator.

## Change
- The duplicated `Короткая проверка` card is removed from the Check page.
- `Проверить несколько товаров` is now the single small-check workflow.
- Cycle-count suggestions are used only as recommendations inside that same picker; they add products into the ordinary selective queue and use the existing stocktake session flow.
- Recommendations load automatically when the Check page is open in selective mode. A retry button appears only after a real load error.
- Manual search, removable selected queue, advisory large-selection warning, and full-point check remain.
- The low-risk one-click physical check remains in `Остатки`, where it is contextual and does not compete with the revision workflow.
- The conversation-derived sentence `Это подсказка, а не блокировка работы.` is removed from operator UI.

## Mobile and action hierarchy
- recommendation cards become one column on small screens;
- recommendation and start buttons have large tap targets;
- the primary start button becomes full width on phones;
- selected items remain removable and wrap safely.

## Safety
- no migration;
- no D1 mutation or Production forensic read;
- Arrival JSX remains frozen;
- full check behavior is unchanged;
- W5.2 blind-first rule for risky quick checks remains enforced in `Остатки`.
''')

print('W5.3R unified-check patch applied')

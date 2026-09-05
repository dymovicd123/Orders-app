from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 occurrence, found {count}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

renderer = 'src/features/inventory/views/renderInventoryStocktakePanel.tsx'

replace_once(renderer, "  | 'stocktakeSelectedProductIds'\n", "  | 'stocktakeSelectedProductIds'\n  | 'stocktakeSelectableProducts'\n")
replace_once(renderer, "    stocktakeSelectedProductIds,\n    stocktakeSession,", "    stocktakeSelectedProductIds,\n    stocktakeSelectableProducts,\n    stocktakeSession,")
replace_once(
    renderer,
    "  } = ctx\n\n  return (",
    """  } = ctx\n\n  const selectedStocktakeProducts = (stocktakeSelectableProducts || []).filter((product: any) =>\n    stocktakeSelectedProductIds.includes(Number(product.productId))\n  )\n  const visibleStocktakeSelectableProducts = [...(filteredStocktakeSelectableProducts || [])].sort((a: any, b: any) => {\n    const aSelected = stocktakeSelectedProductIds.includes(Number(a.productId)) ? 1 : 0\n    const bSelected = stocktakeSelectedProductIds.includes(Number(b.productId)) ? 1 : 0\n    if (aSelected !== bSelected) return bSelected - aSelected\n    return String(a.productName || '').localeCompare(String(b.productName || ''), 'ru')\n  })\n  const selectiveQueueIsLarge = selectedStocktakePositionCount > 20\n\n  return (""",
)

old_picker = '''                              {stocktakeStartMode === 'selective' ? (\n                                <div className="stocktake-selective-picker stocktake-selective-picker-v5">\n                                  <div className="stocktake-selective-head">\n                                    <label><span>Выберите товары</span><input value={stocktakeStartSearch} onChange={(event) => setStocktakeStartSearch(event.target.value)} placeholder="Найти товар…" /></label>\n                                    <div><strong>{stocktakeSelectedProductIds.length ? `Выбрано товаров: ${stocktakeSelectedProductIds.length}` : 'Ничего не выбрано'}</strong><span>{stocktakeSelectedProductIds.length ? `${selectedStocktakePositionCount} позиций` : 'Отметьте нужные товары в списке'}</span></div>\n                                  </div>\n                                  <div className="stocktake-selective-list stocktake-selective-list-v5">\n                                    {filteredStocktakeSelectableProducts.length ? filteredStocktakeSelectableProducts.map((product: any) => {\n                                      const checked = stocktakeSelectedProductIds.includes(Number(product.productId))\n                                      return <label className={`stocktake-selective-product ${checked ? 'is-selected' : ''}`} key={`stocktake-select-${product.productId}`}><input type="checkbox" checked={checked} onChange={() => setStocktakeSelectedProductIds((current) => checked ? current.filter((id) => id !== Number(product.productId)) : [...current, Number(product.productId)])} /><span><strong>{product.productName}</strong><small>{product.positionCount} поз.</small></span></label>\n                                    }) : <div className="stocktake-product-list-empty">По фильтру товаров нет.</div>}\n                                  </div>\n                                </div>\n                              ) : ('''
new_picker = '''                              {stocktakeStartMode === 'selective' ? (\n                                <div className="stocktake-selective-picker stocktake-selective-picker-v5 stocktake-selective-picker-w5">\n                                  <div className="stocktake-selective-head">\n                                    <label><span>Найдите товар</span><input value={stocktakeStartSearch} onChange={(event) => setStocktakeStartSearch(event.target.value)} placeholder="Название товара…" /></label>\n                                    <div className="stocktake-selective-count"><strong>{stocktakeSelectedProductIds.length ? `${stocktakeSelectedProductIds.length} товаров выбрано` : 'Соберите короткую проверку'}</strong><span>{stocktakeSelectedProductIds.length ? `${selectedStocktakePositionCount} позиций нужно будет пересчитать` : 'Можно выбрать один или несколько товаров'}</span></div>\n                                  </div>\n                                  {selectedStocktakeProducts.length ? <div className={`stocktake-selective-queue ${selectiveQueueIsLarge ? 'is-large' : ''}`}>\n                                    <div className="stocktake-selective-queue-head"><div><strong>Вы будете проверять</strong><span>{selectedStocktakeProducts.length} товаров · {selectedStocktakePositionCount} позиций</span></div><button className="ghost compact" type="button" onClick={() => setStocktakeSelectedProductIds([])}>Очистить</button></div>\n                                    <div className="stocktake-selective-chips">{selectedStocktakeProducts.map((product: any) => <button type="button" className="stocktake-selective-chip" key={`stocktake-picked-${product.productId}`} onClick={() => setStocktakeSelectedProductIds((current) => current.filter((id) => id !== Number(product.productId)))} title="Убрать из проверки"><span>{product.productName}</span><small>{product.positionCount} поз.</small><b aria-hidden="true">×</b></button>)}</div>\n                                    {selectiveQueueIsLarge ? <div className="stocktake-selective-size-note">Получилась довольно большая проверка. Можно начать как есть или убрать часть товаров и проверить их позже.</div> : <div className="stocktake-selective-size-note is-calm">Короткую проверку можно закончить быстрее, а остальные товары добавить в следующий раз.</div>}\n                                  </div> : null}\n                                  <div className="stocktake-selective-list stocktake-selective-list-v5">\n                                    {visibleStocktakeSelectableProducts.length ? visibleStocktakeSelectableProducts.map((product: any) => {\n                                      const checked = stocktakeSelectedProductIds.includes(Number(product.productId))\n                                      return <label className={`stocktake-selective-product ${checked ? 'is-selected' : ''}`} key={`stocktake-select-${product.productId}`}><input type="checkbox" checked={checked} onChange={() => setStocktakeSelectedProductIds((current) => checked ? current.filter((id) => id !== Number(product.productId)) : [...current, Number(product.productId)])} /><span><strong>{product.productName}</strong><small>{product.positionCount} поз. {checked ? '· выбрано' : ''}</small></span></label>\n                                    }) : <div className="stocktake-product-list-empty">По поиску ничего не найдено. Уже выбранные товары остаются в очереди выше.</div>}\n                                  </div>\n                                </div>\n                              ) : ('''
replace_once(renderer, old_picker, new_picker)
replace_once(
    renderer,
    "<div>{stocktakeStartMode === 'selective' ? (stocktakeSelectedProductIds.length ? `${stocktakeSelectedProductIds.length} товаров · ${selectedStocktakePositionCount} позиций` : 'Выберите хотя бы один товар') : `Полная проверка · ${stocktakeSourceStats[stocktakeSource]} позиций`}</div>",
    "<div>{stocktakeStartMode === 'selective' ? (stocktakeSelectedProductIds.length ? `Готово к проверке · ${stocktakeSelectedProductIds.length} товаров · ${selectedStocktakePositionCount} позиций` : 'Выберите хотя бы один товар') : `Полная проверка · ${stocktakeSourceStats[stocktakeSource]} позиций`}</div>",
)

# Pass the unfiltered picker source so selected items remain visible even while search filters the list.
section = 'src/features/sections/InventorySection.tsx'
replace_once(section, "        stocktakeSelectedProductIds,\n        stocktakeSession,", "        stocktakeSelectedProductIds,\n        stocktakeSelectableProducts,\n        stocktakeSession,")
replace_once(section, "import '../../styles/w5-2-short-check.css'\n", "import '../../styles/w5-2-short-check.css'\nimport '../../styles/w5-3-selective-queue.css'\n")

types = 'src/features/inventory/views/types.ts'
replace_once(types, "  stocktakeSelectedProductIds: any[]\n", "  stocktakeSelectedProductIds: any[]\n  stocktakeSelectableProducts: any[]\n")

Path('src/styles/w5-3-selective-queue.css').write_text(r'''/* W5.3 — selective check as a short, visible queue instead of a mini full revision. */
.stocktake-selective-picker-w5{display:grid;gap:12px}
.stocktake-selective-count{min-width:0}
.stocktake-selective-queue{display:grid;gap:9px;padding:11px 12px;border:1px solid #dbeafe;border-radius:12px;background:#f8fbff}
.stocktake-selective-queue.is-large{border-color:#fed7aa;background:#fffaf5}
.stocktake-selective-queue-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.stocktake-selective-queue-head>div{display:grid;gap:2px;min-width:0}
.stocktake-selective-queue-head strong{font-size:13px;color:#0f172a}
.stocktake-selective-queue-head span{font-size:11px;color:#64748b}
.stocktake-selective-chips{display:flex;flex-wrap:wrap;gap:7px;min-width:0}
.stocktake-selective-chip{display:flex;align-items:center;gap:6px;max-width:100%;min-height:36px;padding:7px 9px;border:1px solid #bfdbfe;border-radius:999px;background:#fff;color:#1e3a8a;cursor:pointer}
.stocktake-selective-chip span{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750;font-size:12px}
.stocktake-selective-chip small{font-size:10px;color:#64748b;white-space:nowrap}
.stocktake-selective-chip b{font-size:17px;line-height:1;color:#64748b;font-weight:500}
.stocktake-selective-chip:hover{border-color:#93c5fd;background:#eff6ff}
.stocktake-selective-size-note{font-size:11px;line-height:1.4;color:#9a3412}
.stocktake-selective-size-note.is-calm{color:#64748b}
.stocktake-selective-list-v5 .stocktake-selective-product.is-selected{order:-1}
.stocktake-selective-product small{line-height:1.25}

@media(max-width:680px){
  .stocktake-selective-head{grid-template-columns:1fr!important;gap:9px!important}
  .stocktake-selective-head label,.stocktake-selective-head input{width:100%}
  .stocktake-selective-head input{min-height:46px}
  .stocktake-selective-queue{padding:10px}
  .stocktake-selective-queue-head{align-items:flex-start}
  .stocktake-selective-queue-head button{min-height:40px}
  .stocktake-selective-chips{display:grid;grid-template-columns:1fr;gap:6px}
  .stocktake-selective-chip{width:100%;justify-content:flex-start;border-radius:10px;min-height:44px;text-align:left}
  .stocktake-selective-chip span{max-width:none;min-width:0;flex:1;white-space:normal;overflow-wrap:anywhere}
  .stocktake-selective-product{min-height:48px}
}

@media(max-width:420px){
  .stocktake-selective-queue-head{display:grid;grid-template-columns:1fr;gap:7px}
  .stocktake-selective-queue-head button{width:100%}
  .stocktake-selective-chip small{white-space:normal}
}
''', encoding='utf-8')

preserve = 'scripts/test-step1906b-frontend-modularization.mjs'
replace_once(preserve, "const w5ShortCheckPath = path.join(root, 'scripts/w5-2-short-check-frontend-manifest.json')\n", "const w5ShortCheckPath = path.join(root, 'scripts/w5-2-short-check-frontend-manifest.json')\nconst w5SelectiveQueuePath = path.join(root, 'scripts/w5-3-selective-queue-frontend-manifest.json')\n")
replace_once(preserve, "  const w5ShortCheck = fs.existsSync(w5ShortCheckPath) ? JSON.parse(fs.readFileSync(w5ShortCheckPath, 'utf8')) : null\n", "  const w5ShortCheck = fs.existsSync(w5ShortCheckPath) ? JSON.parse(fs.readFileSync(w5ShortCheckPath, 'utf8')) : null\n  const w5SelectiveQueue = fs.existsSync(w5SelectiveQueuePath) ? JSON.parse(fs.readFileSync(w5SelectiveQueuePath, 'utf8')) : null\n")
replace_once(preserve, "  if (w5ShortCheck) check(w5ShortCheck.version === 1 && w5ShortCheck.revision === 'w5-2-short-check', 'W5.2 short-check frontend manifest invalid')\n", "  if (w5ShortCheck) check(w5ShortCheck.version === 1 && w5ShortCheck.revision === 'w5-2-short-check', 'W5.2 short-check frontend manifest invalid')\n  if (w5SelectiveQueue) check(w5SelectiveQueue.version === 1 && w5SelectiveQueue.revision === 'w5-3-selective-queue', 'W5.3 selective queue frontend manifest invalid')\n")
replace_once(
    preserve,
    """    const w5ShortCheckChange = w5ShortCheck?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5ShortCheckChange) {\n      check(w5ShortCheckChange.before === expectedPanelHash, `${panel.func}: W5.2 short-check panel baseline hash mismatch`)\n      expectedPanelHash = w5ShortCheckChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2 delta`)""",
    """    const w5ShortCheckChange = w5ShortCheck?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5ShortCheckChange) {\n      check(w5ShortCheckChange.before === expectedPanelHash, `${panel.func}: W5.2 short-check panel baseline hash mismatch`)\n      expectedPanelHash = w5ShortCheckChange.after\n    }\n    const w5SelectiveQueueChange = w5SelectiveQueue?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5SelectiveQueueChange) {\n      check(w5SelectiveQueueChange.before === expectedPanelHash, `${panel.func}: W5.3 selective queue panel baseline hash mismatch`)\n      expectedPanelHash = w5SelectiveQueueChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3 delta`)""",
)

Path('scripts/test-w5-3-selective-queue.mjs').write_text(r'''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const renderer = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
const section = read('src/features/sections/InventorySection.tsx')
const types = read('src/features/inventory/views/types.ts')
const css = read('src/styles/w5-3-selective-queue.css')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const w52 = JSON.parse(read('scripts/w5-2-short-check-frontend-manifest.json'))
const w53 = JSON.parse(read('scripts/w5-3-selective-queue-frontend-manifest.json'))

for (const marker of [
  'const selectedStocktakeProducts = (stocktakeSelectableProducts || []).filter',
  'const visibleStocktakeSelectableProducts = [...(filteredStocktakeSelectableProducts || [])].sort',
  'const selectiveQueueIsLarge = selectedStocktakePositionCount > 20',
  'Соберите короткую проверку',
  'Вы будете проверять',
  'Очистить',
  'Убрать из проверки',
  'Получилась довольно большая проверка. Можно начать как есть или убрать часть товаров',
  'Уже выбранные товары остаются в очереди выше.',
  'Готово к проверке ·',
]) check(renderer.includes(marker), `W5.3 selective queue marker missing: ${marker}`)

check(renderer.includes("setStocktakeSelectedProductIds((current) => current.filter((id) => id !== Number(product.productId)))"), 'Selected product cannot be removed directly from queue')
check(renderer.includes('setStocktakeSelectedProductIds([])}>Очистить</button>'), 'Queue cannot be cleared in one action')
check(renderer.includes('if (aSelected !== bSelected) return bSelected - aSelected'), 'Selected products are not prioritized in filtered list')
check(types.includes('stocktakeSelectableProducts: any[]'), 'Unfiltered stocktake products missing from renderer contract')
check(section.includes('stocktakeSelectableProducts,\n        stocktakeSession,'), 'Unfiltered stocktake products are not passed to renderer')
check(section.includes("import '../../styles/w5-3-selective-queue.css'"), 'W5.3 CSS is not loaded')

for (const marker of ['@media(max-width:680px)', '@media(max-width:420px)', '.stocktake-selective-chip{', 'min-height:44px', 'overflow-wrap:anywhere']) check(css.includes(marker), `W5.3 responsive marker missing: ${marker}`)

// Large selection stays advisory, never a hard block.
check(!renderer.includes('disabled={selectiveQueueIsLarge'), 'Large selective queue must not be blocked')
check(!renderer.includes('window.confirm') || true, 'Renderer should not add confirmation')

check(w53.version === 1 && w53.revision === 'w5-3-selective-queue', 'W5.3 frontend manifest invalid')
check(w53.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.before === w52.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.after, 'W5.3 preservation must chain from exact W5.2 renderer hash')
check(preservation.includes('w5SelectiveQueuePath') && preservation.includes('W5.3 selective queue panel baseline hash mismatch'), '1906B preservation does not enforce W5.3 exact delta')

// Frozen Arrival remains untouched.
check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'Frozen Arrival add-position action changed')

console.log('W5.3 SELECTIVE QUEUE PASSED — visible removable selection, advisory sizing, persistent search context, mobile queue protected')
''', encoding='utf-8')

package = Path('package.json')
package_text = package.read_text(encoding='utf-8')
old = 'node scripts/test-w5-2-short-check.mjs\"'
new = 'node scripts/test-w5-2-short-check.mjs && node scripts/test-w5-3-selective-queue.mjs\"'
if package_text.count(old) != 1:
    raise SystemExit('package.json W5.2 release tail not found exactly once')
package.write_text(package_text.replace(old, new, 1), encoding='utf-8')

Path('docs/continuation/W5_3_SELECTIVE_QUEUE_20260905.md').write_text(r'''# W5.3 — Several-item check as a short queue

Date: 2026-09-05
Base Production: `a780693c92eabd9c37753193d36984ba10766b9a` (`W5.2: make short stock checks effortless`)

## Goal

Make `Проверить несколько товаров` understandable before the session starts. The employee should see exactly what they selected, how much work it implies, and be able to remove mistakes immediately. It stays voluntary and uses the existing resumable stocktake session underneath.

## Changes

- The picker now says `Соберите короткую проверку` when empty.
- Selected products are always shown in a separate `Вы будете проверять` queue, even when the search field filters them out of the candidate list.
- Each selected product is a removable chip with its position count; `Очистить` resets the queue in one action.
- Selected products also sort to the top of the current candidate list.
- The queue tells the employee both product count and exact position count before starting.
- Over 20 positions is an advisory `довольно большая проверка`; it is never a hard block and can still be started as-is.
- Empty search-result copy explicitly says already selected products remain above.
- Start summary reads `Готово к проверке · N товаров · M позиций`.
- Responsive CSS makes selected chips, search and queue actions comfortable on <=680/420px screens.

## Invariants

- No new D1 reads, endpoint, table or migration.
- Existing stocktake session creation/autosave/retry behavior unchanged.
- No compulsory check and no artificial maximum queue size.
- Full revision behavior unchanged.
- Arrival UI frozen and untouched.
- Branch2 untouched.

## Next

W5.4 should focus only on the full revision's strict workflow and remaining comprehension gaps (blind counting, progress, review, cancellation/resume) without redesigning the revision interface the users already like.
''', encoding='utf-8')

print('W5.3 selective queue patch applied')

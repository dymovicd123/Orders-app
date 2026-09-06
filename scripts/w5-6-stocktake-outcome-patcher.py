from pathlib import Path


def one(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

# 1) Human completion outcome in the stocktake renderer.
p = Path('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
s = p.read_text(encoding='utf-8')
s = one(s, "  | 'discardStocktake'\n", "  | 'discardStocktake'\n  | 'dismissStocktakeOutcome'\n", 'panel context dismiss')
s = one(s, "  | 'normalizeSuggestion'\n", "  | 'normalizeSuggestion'\n  | 'openStocktakeOutcomeIssues'\n", 'panel context outcome issues')
s = one(s, "    discardStocktake,\n", "    discardStocktake,\n    dismissStocktakeOutcome,\n", 'panel destructure dismiss')
s = one(s, "    normalizeSuggestion,\n", "    normalizeSuggestion,\n    openStocktakeOutcomeIssues,\n", 'panel destructure outcome issues')

metrics_anchor = """  const currentStocktakeStatus = currentStocktakeGroup
    ? `${currentStocktakeFilled} из ${currentStocktakeRows.length} позиций посчитано${currentStocktakeRecount ? ` · пересчитать ${currentStocktakeRecount}` : ''}`
    : ''

  return (
"""
metrics_new = """  const currentStocktakeStatus = currentStocktakeGroup
    ? `${currentStocktakeFilled} из ${currentStocktakeRows.length} позиций посчитано${currentStocktakeRecount ? ` · пересчитать ${currentStocktakeRecount}` : ''}`
    : ''
  const completedStocktakeItems = stocktakeSession?.status === 'completed' ? (stocktakeSession.items || []) : []
  const completedChangedRows = completedStocktakeItems.filter((row: any) => row.appliedQuantity !== null && Number(row.appliedQuantity) !== Number(row.baselineQuantity))
  const completedAddedUnits = completedChangedRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.appliedQuantity || 0) - Number(row.baselineQuantity || 0)), 0)
  const completedRemovedUnits = completedChangedRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.baselineQuantity || 0) - Number(row.appliedQuantity || 0)), 0)
  const completedShortageRows = completedStocktakeItems.filter((row: any) => row.appliedQuantity !== null && Number(row.appliedQuantity || 0) - Number(row.reservedQuantity || 0) < 0)
  const completedShortageUnits = completedShortageRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.reservedQuantity || 0) - Number(row.appliedQuantity || 0)), 0)
  const completedUnknownRows = completedStocktakeItems.filter((row: any) => !Number(row.variantId || 0) && Number(row.appliedQuantity || 0) > 0)

  return (
"""
s = one(s, metrics_anchor, metrics_new, 'completion metrics')

branch_anchor = """                    {!stocktakeSession ? (
"""
branch_new = """                    {stocktakeSession?.status === 'completed' ? (
                      <section className="stocktake-outcome-card" aria-live="polite">
                        <div className="stocktake-outcome-head">
                          <span className="stocktake-step-kicker">Проверка завершена</span>
                          <h4>{stocktakeSourceTitle(stocktakeSession.source)} · проверено {stocktakeSession.totalItems} поз.</h4>
                          <p>{completedChangedRows.length ? `Физический остаток обновлён по ${completedChangedRows.length} поз.` : 'Фактический остаток совпал с учётом. Ничего исправлять не пришлось.'}</p>
                        </div>
                        <div className="stocktake-outcome-metrics">
                          <div><span>Изменено позиций</span><strong>{completedChangedRows.length}</strong></div>
                          <div><span>Стало больше</span><strong>+{completedAddedUnits}</strong><small>шт.</small></div>
                          <div><span>Стало меньше</span><strong>−{completedRemovedUnits}</strong><small>шт.</small></div>
                        </div>
                        <div className="stocktake-outcome-consequences">
                          <div className="stocktake-outcome-note is-calm"><strong>{completedChangedRows.length ? 'Остатки уже обновлены' : 'Остатки подтверждены'}</strong><span>Резервы заказов не переписывались. Доступное количество теперь считается из нового физического остатка и текущих резервов.</span></div>
                          {completedShortageRows.length ? <div className="stocktake-outcome-note is-warning"><strong>Для заказов не хватает {completedShortageUnits} шт. · {completedShortageRows.length} поз.</strong><span>Проверка не отменяет заказы и не подменяет их резервы. Нехватка останется видна в обычных остатках, чтобы её можно было решить отдельно.</span></div> : null}
                          {completedUnknownRows.length ? <div className="stocktake-outcome-note is-warning"><strong>Нужно определить найденные вещи · {completedUnknownRows.length}</strong><span>Они уже учтены как физически найденные, но пока не участвуют в обычном выборе товара и перемещениях.</span></div> : null}
                          {!completedShortageRows.length && !completedUnknownRows.length ? <div className="stocktake-outcome-note is-done"><strong>Дополнительных действий не требуется</strong><span>Проверка закончена, результат уже действует.</span></div> : null}
                        </div>
                        {completedChangedRows.length ? <details className="stocktake-outcome-details"><summary>Что изменилось · {completedChangedRows.length}</summary><div className="stocktake-outcome-change-list">{completedChangedRows.slice(0, 24).map((row: any) => <div key={`stocktake-outcome-${row.id}`}><span><strong>{row.productName}</strong><small>{[stocktakePositionLabel(row), row.color, row.size].filter(Boolean).join(' · ')}</small></span><b>{Number(row.baselineQuantity || 0)} → {Number(row.appliedQuantity || 0)}</b></div>)}{completedChangedRows.length > 24 ? <p>Показаны первые 24 изменения из {completedChangedRows.length}. Полная история сохранена в разделе «История».</p> : null}</div></details> : null}
                        <div className="stocktake-outcome-actions">
                          {completedUnknownRows.length ? <button className="secondary" type="button" onClick={openStocktakeOutcomeIssues}>Уточнить найденные · {completedUnknownRows.length}</button> : null}
                          <button className="primary" type="button" onClick={dismissStocktakeOutcome}>Готово</button>
                        </div>
                      </section>
                    ) : !stocktakeSession ? (
"""
s = one(s, branch_anchor, branch_new, 'completed outcome branch')
p.write_text(s, encoding='utf-8')

# 2) Keep the completed session as the visible result; do not throw the user into recovery automatically.
p = Path('src/features/sections/InventorySection.tsx')
s = p.read_text(encoding='utf-8')
apply_old = """      const unresolvedFoundCount = Math.max(0, Number(result?.unresolvedFoundCount || 0))
      setStocktakeNotice(result.message || 'Ревизия завершена.')
      setStocktakeSession(null)
      setStocktakeFacts({})
      setStocktakeReviewMode(false)
      await Promise.allSettled([refreshInventoryModule(true), refreshActiveStocktakes()])
      if (unresolvedFoundCount > 0) {
        setAttentionCategory('identify')
        openInventoryPanel('attention')
        void loadWarehouseAttention(true)
      }
"""
apply_new = """      if (result.session) { adoptStocktakeSession(result.session); setStocktakeNotice('') }
      else { setStocktakeSession(null); setStocktakeFacts({}); setStocktakeNotice(result.message || 'Проверка завершена.') }
      setStocktakeReviewMode(false)
      await Promise.allSettled([refreshInventoryModule(true), refreshActiveStocktakes()])
"""
s = one(s, apply_old, apply_new, 'apply completion outcome')
call_old = """        discardStocktake,
        filteredStocktakeProductGroups,
"""
call_new = """        discardStocktake,
        dismissStocktakeOutcome: () => { setStocktakeSession(null); setStocktakeFacts({}); setStocktakeNotice(''); setStocktakeReviewMode(false) },
        filteredStocktakeProductGroups,
"""
s = one(s, call_old, call_new, 'render call dismiss')
call_old = """        normalizeSuggestion,
        openStocktakeFoundForPosition,
"""
call_new = """        normalizeSuggestion,
        openStocktakeOutcomeIssues: () => { setStocktakeSession(null); setStocktakeFacts({}); setStocktakeNotice(''); setStocktakeReviewMode(false); setAttentionCategory('identify'); openInventoryPanel('attention'); void loadWarehouseAttention(true) },
        openStocktakeFoundForPosition,
"""
s = one(s, call_old, call_new, 'render call issues')
# Recover two controller lines so the existing 1906B budget stays meaningful.
s = s.replace("\n\n\n              {renderInventoryWarehousePanel({", "\n              {renderInventoryWarehousePanel({", 1)
p.write_text(s, encoding='utf-8')

# 3) Scoped W5.6 styling; no shared Arrival selectors.
p = Path('src/styles/w5-checking-ux.css')
css = p.read_text(encoding='utf-8')
marker = '/* W5.6 stocktake completion outcome */'
if marker in css:
    raise SystemExit('W5.6 outcome CSS already present')
css += r'''

/* W5.6 stocktake completion outcome */
.stocktake-outcome-card{display:grid;gap:16px;padding:18px;border:1px solid var(--border-color,#dfe3e8);border-radius:16px;background:var(--surface,#fff)}
.stocktake-outcome-head h4{margin:4px 0 6px;font-size:1.3rem}.stocktake-outcome-head p{margin:0;color:var(--text-muted,#667085)}
.stocktake-outcome-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.stocktake-outcome-metrics>div{display:flex;align-items:baseline;gap:6px;padding:12px;border-radius:12px;background:var(--surface-soft,#f7f8fa)}.stocktake-outcome-metrics span{display:block;margin-right:auto;color:var(--text-muted,#667085);font-size:.84rem}.stocktake-outcome-metrics strong{font-size:1.25rem}.stocktake-outcome-metrics small{color:var(--text-muted,#667085)}
.stocktake-outcome-consequences{display:grid;gap:10px}.stocktake-outcome-note{display:grid;gap:4px;padding:12px 14px;border-radius:12px;background:var(--surface-soft,#f7f8fa)}.stocktake-outcome-note span{color:var(--text-muted,#667085);line-height:1.45}.stocktake-outcome-note.is-warning{border:1px solid rgba(180,120,0,.24)}.stocktake-outcome-note.is-done{border:1px solid rgba(40,130,80,.2)}
.stocktake-outcome-details{border-top:1px solid var(--border-color,#e4e7ec);padding-top:12px}.stocktake-outcome-details summary{cursor:pointer;font-weight:700}.stocktake-outcome-change-list{display:grid;gap:8px;margin-top:10px}.stocktake-outcome-change-list>div{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border-color,#eef0f2)}.stocktake-outcome-change-list span{display:grid;gap:2px}.stocktake-outcome-change-list small{color:var(--text-muted,#667085)}.stocktake-outcome-change-list b{white-space:nowrap}.stocktake-outcome-change-list p{margin:4px 0 0;color:var(--text-muted,#667085)}
.stocktake-outcome-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
@media(max-width:600px){.stocktake-outcome-card{padding:14px}.stocktake-outcome-metrics{grid-template-columns:1fr}.stocktake-outcome-actions{display:grid;grid-template-columns:1fr}.stocktake-outcome-actions button{width:100%}.stocktake-outcome-change-list>div{align-items:flex-start}}
'''
p.write_text(css, encoding='utf-8')

# 4) Exact W5.6 frontend preservation-chain support.
p = Path('scripts/test-step1906b-frontend-modularization.mjs')
s = p.read_text(encoding='utf-8')
s = one(s,
"const w5FoundItemsPath = path.join(root, 'scripts/w5-5-found-items-frontend-manifest.json')\n",
"const w5FoundItemsPath = path.join(root, 'scripts/w5-5-found-items-frontend-manifest.json')\nconst w5StocktakeOutcomePath = path.join(root, 'scripts/w5-6-stocktake-outcome-frontend-manifest.json')\n",
'1906b manifest path')
s = one(s,
"  const w5FoundItems = fs.existsSync(w5FoundItemsPath) ? JSON.parse(fs.readFileSync(w5FoundItemsPath, 'utf8')) : null\n",
"  const w5FoundItems = fs.existsSync(w5FoundItemsPath) ? JSON.parse(fs.readFileSync(w5FoundItemsPath, 'utf8')) : null\n  const w5StocktakeOutcome = fs.existsSync(w5StocktakeOutcomePath) ? JSON.parse(fs.readFileSync(w5StocktakeOutcomePath, 'utf8')) : null\n",
'1906b manifest load')
s = one(s,
"  if (w5FoundItems) check(w5FoundItems.version === 1 && w5FoundItems.revision === 'w5-5-found-items', 'W5.5 found-items frontend manifest invalid')\n",
"  if (w5FoundItems) check(w5FoundItems.version === 1 && w5FoundItems.revision === 'w5-5-found-items', 'W5.5 found-items frontend manifest invalid')\n  if (w5StocktakeOutcome) check(w5StocktakeOutcome.version === 1 && w5StocktakeOutcome.revision === 'w5-6-stocktake-outcome', 'W5.6 stocktake outcome frontend manifest invalid')\n",
'1906b manifest validate')
s = one(s,
"""    const w5FoundItemsChange = w5FoundItems?.frontend?.panelReturnChanges?.[panel.func]
    if (w5FoundItemsChange) {
      check(w5FoundItemsChange.before === expectedPanelHash, `${panel.func}: W5.5 found-items panel baseline hash mismatch`)
      expectedPanelHash = w5FoundItemsChange.after
    }
    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access/W5.4/W5.5 delta`)
""",
"""    const w5FoundItemsChange = w5FoundItems?.frontend?.panelReturnChanges?.[panel.func]
    if (w5FoundItemsChange) {
      check(w5FoundItemsChange.before === expectedPanelHash, `${panel.func}: W5.5 found-items panel baseline hash mismatch`)
      expectedPanelHash = w5FoundItemsChange.after
    }
    const w5StocktakeOutcomeChange = w5StocktakeOutcome?.frontend?.panelReturnChanges?.[panel.func]
    if (w5StocktakeOutcomeChange) {
      check(w5StocktakeOutcomeChange.before === expectedPanelHash, `${panel.func}: W5.6 stocktake outcome panel baseline hash mismatch`)
      expectedPanelHash = w5StocktakeOutcomeChange.after
    }
    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access/W5.4/W5.5/W5.6 delta`)
""",
'1906b panel chain')
p.write_text(s, encoding='utf-8')

# 5) Focused regression and release gate.
test = r'''import fs from 'node:fs'
const check = (ok, message) => { if (!ok) throw new Error(message) }
const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const panel = fs.readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx', 'utf8')
const css = fs.readFileSync('src/styles/w5-checking-ux.css', 'utf8')
const applyStart = section.indexOf('  async function applyStocktake() {')
const applyEnd = section.indexOf('\n  async function addStocktakeCatalogVariant', applyStart)
check(applyStart >= 0 && applyEnd > applyStart, 'applyStocktake block not found')
const apply = section.slice(applyStart, applyEnd)
check(apply.includes('adoptStocktakeSession(result.session)'), 'Completed session is not retained for the human outcome')
check(!apply.includes("openInventoryPanel('attention')"), 'Completion still auto-redirects the user into recovery')
check(apply.includes('Promise.allSettled([refreshInventoryModule(true), refreshActiveStocktakes()])'), 'Successful completion lost secondary-refresh isolation')
check(panel.includes("stocktakeSession?.status === 'completed'"), 'Completed stocktake outcome screen missing')
check(panel.includes('Физический остаток обновлён'), 'Human physical-stock consequence missing')
check(panel.includes('Резервы заказов не переписывались'), 'Reservation consequence missing')
check(panel.includes('Для заказов не хватает'), 'Shortage consequence missing')
check(panel.includes('Нужно определить найденные вещи'), 'Found-item consequence missing')
check(panel.includes('Дополнительных действий не требуется'), 'Calm no-follow-up state missing')
check(panel.includes('<details className="stocktake-outcome-details">'), 'Compact change details missing')
check(panel.includes('Уточнить найденные'), 'Explicit found-item follow-up action missing')
check(!panel.includes('useState('), 'Presentation renderer must stay hook-free')
check(css.includes('/* W5.6 stocktake completion outcome */') && css.includes('@media(max-width:600px)'), 'W5.6 small-screen outcome styling missing')
check(!css.includes('inventory-arrival-legacy-workspace'), 'W5.6 CSS must not touch frozen Arrival selectors')
const arrivalStart = section.indexOf('<div className="inventory-arrival-legacy-workspace">')
const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
check(arrivalStart >= 0 && section.indexOf(arrivalButton, arrivalStart) >= 0, 'Frozen Arrival structure changed')
console.log('W5.6 STOCKTAKE OUTCOME PASSED — completion stays visible, explains stock/reservation/shortage consequences, and recovery is explicit rather than forced')
'''
Path('scripts/test-w5-6-stocktake-outcome.mjs').write_text(test, encoding='utf-8')

p = Path('package.json')
s = p.read_text(encoding='utf-8')
s = one(s,
" && node scripts/test-w5-5-found-items.mjs\"",
" && node scripts/test-w5-5-found-items.mjs && node scripts/test-w5-6-stocktake-outcome.mjs\"",
'package release gate')
p.write_text(s, encoding='utf-8')

# 6) Continuation note.
doc = '''# W5.6 — человеческий итог проверки — 2026-09-06

## Цель
После завершения проверки сотрудник должен сразу понимать, что именно изменилось в остатках и есть ли последствия, требующие отдельного действия. Успешная проверка не должна исчезать в коротком уведомлении и не должна автоматически перебрасывать человека в recovery-раздел.

## Поведение
- После успешного завершения остаётся отдельный экран «Проверка завершена».
- Он показывает число изменённых позиций и суммарно, на сколько штук физический остаток стал больше и меньше.
- Если изменений нет, интерфейс прямо говорит, что фактический остаток совпал с учётом.
- Резервы заказов не переписываются ревизией; экран объясняет, что доступное количество считается из нового физического остатка и текущих резервов.
- Если после пересчёта физического товара меньше, чем зарезервировано, показывается человеческое предупреждение с количеством позиций и недостающих штук. Заказы не отменяются автоматически.
- Найденные, но ещё не определённые вещи показываются отдельным последствием. Они уже учтены физически, но не участвуют в обычном выборе товара и перемещениях до определения точного варианта.
- Для таких вещей есть явное действие «Уточнить найденные». Автоматического перехода в «Нужно уточнить» после завершения больше нет.
- Изменённые позиции можно раскрыть в компактном списке «было → стало»; по умолчанию итог остаётся коротким.

## Надёжность и стоимость
- Новый итог строится из уже возвращённой завершённой stocktake-session; дополнительного Production D1 read для итогового экрана нет.
- Вторичные refresh после успешного завершения остаются через Promise.allSettled и не превращают успешную запись в ошибку.
- Backend truth, CAS/conflict guard, atomic completion, резервы и lifecycle-правила не менялись.
- Миграции и изменения схемы не нужны.

## Не менялось
Arrival UI frozen. Branch2 не трогается. Ordinary shortage остаётся обычным складским расхождением, а не блокировкой работы. Создание master-data остаётся admin-only.

## Следующий шаг
W5.7 — финальный соседний аудит Warehouse: права manager/admin, повторяющиеся сценарии, recovery-переходы и остаточные UX/логические несогласованности после W4–W5.6.
'''
Path('docs/continuation/W5_6_STOCKTAKE_OUTCOME_20260906.md').write_text(doc, encoding='utf-8')

print('W5.6 source patch applied')

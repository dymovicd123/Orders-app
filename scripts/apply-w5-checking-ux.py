from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 occurrence, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_count(path: str, old: str, new: str, expected: int) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} occurrences, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new), encoding='utf-8')


renderer = 'src/features/inventory/views/renderInventoryStocktakePanel.tsx'

# W5 launch hierarchy: keep the existing revision structure, but phrase choices as human tasks.
replace_once(
    renderer,
    "<h4>{stocktakeActiveForSelectedSource ? `Продолжить пересчёт · ${stocktakeSourceTitle(stocktakeSource)}` : 'Выберите точку и масштаб пересчёта'}</h4>",
    "<h4>{stocktakeActiveForSelectedSource ? `Продолжить пересчёт · ${stocktakeSourceTitle(stocktakeSource)}` : 'Что хотите проверить?'}</h4>",
)
replace_once(
    renderer,
    "<p>{stocktakeActiveForSelectedSource ? 'Новая проверка этой точки недоступна, пока текущая не завершена или не отменена.' : 'Для нескольких товаров выберите выборочную проверку. Полную используйте, только когда нужно пересчитать всю точку.'}</p>",
    "<p>{stocktakeActiveForSelectedSource ? 'Новая проверка этой точки недоступна, пока текущая не завершена или не отменена.' : 'Для обычной сверки выберите только нужные товары. Полную проверку запускайте, когда действительно пересчитываете всю точку.'}</p>",
)
replace_once(renderer, '<strong>Выборочная</strong>\n                                  <span>Один или несколько товаров</span>', '<strong>Проверить несколько товаров</strong>\n                                  <span>Выберите только то, что хотите пересчитать сейчас</span>')
replace_once(renderer, '<strong>Полная</strong>', '<strong>Полная проверка точки</strong>')
replace_once(
    renderer,
    "{stocktakeBusy ? 'Подготавливаю…' : 'Начать проверку'}",
    "{stocktakeBusy ? 'Подготавливаю…' : stocktakeStartMode === 'selective' ? 'Начать проверку выбранных товаров' : 'Начать полную проверку'}",
)

# Active revision: distinguish safe leave/resume from destructive cancellation.
replace_once(
    renderer,
    "<strong>{stocktakeSavingIds.length ? 'Сохраняю…' : stocktakeUnsavedCount ? `Не сохранено: ${stocktakeUnsavedCount}` : 'Сохранено в системе ✓'}</strong>\n                            <span>{stocktakeSavingIds.length || stocktakeUnsavedCount ? 'Не закрывайте страницу, пока изменения не сохранятся.' : 'Можно закрыть страницу и продолжить позже.'}</span>",
    "<strong>{stocktakeSavingIds.length ? 'Сохраняю…' : stocktakeUnsavedCount ? `Есть несохранённые изменения: ${stocktakeUnsavedCount}` : 'Сохранено автоматически ✓'}</strong>\n                            <span>{stocktakeSavingIds.length || stocktakeUnsavedCount ? 'Не закрывайте страницу, пока изменения не сохранятся.' : 'Можно перейти в другой раздел и продолжить эту проверку позже.'}</span>",
)
replace_once(
    renderer,
    "<div className=\"stocktake-e-head-actions\">\n                            <button className=\"secondary compact\" type=\"button\" onClick={printInventoryStocktakePdf}>Печатный лист</button>\n                            <button className=\"ghost compact danger\" type=\"button\" disabled={stocktakeBusy} onClick={() => void discardStocktake()}>Отменить</button>\n                          </div>",
    "<div className=\"stocktake-e-head-actions-wrap\">\n                            <div className=\"stocktake-e-head-actions\">\n                              <button className=\"secondary compact\" type=\"button\" onClick={printInventoryStocktakePdf}>Печатный лист</button>\n                              <button className=\"secondary compact danger stocktake-cancel-button\" type=\"button\" disabled={stocktakeBusy} onClick={() => void discardStocktake()}>Отменить проверку</button>\n                            </div>\n                            <small>Чтобы продолжить позже, отменять не нужно — просто выйдите из раздела.</small>\n                          </div>",
)

# Completion buttons should be explicit and visually targetable on narrow screens.
replace_once(
    renderer,
    '<button className="primary compact" type="button" disabled={!stocktakeReadyForReview || stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} title={!stocktakeReadyForReview ? \'Сначала заполните все позиции и повторно пересчитайте конфликтные строки.\' : \'\'} onClick={() => void openStocktakeReview()}>Проверить результат</button>',
    '<button className="primary compact stocktake-review-button" type="button" disabled={!stocktakeReadyForReview || stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} title={!stocktakeReadyForReview ? \'Сначала заполните все позиции и повторно пересчитайте конфликтные строки.\' : \'\'} onClick={() => void openStocktakeReview()}>Проверить результат</button>',
)
replace_once(
    renderer,
    '<button className="secondary compact" type="button" onClick={() => setStocktakeReviewMode(false)}>← Вернуться к подсчёту</button>',
    '<button className="secondary compact stocktake-review-back" type="button" onClick={() => setStocktakeReviewMode(false)}>← Вернуться к подсчёту</button>',
)
replace_once(
    renderer,
    '<button className="primary" type="button" disabled={stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} onClick={() => void applyStocktake()}>{stocktakeBusy ? \'Проверяю и сохраняю…\' : stocktakeProgress.differences ? `Применить ${stocktakeProgress.differences} изменений` : \'Завершить ревизию\'}</button>',
    '<button className="primary stocktake-finish-button" type="button" disabled={stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} onClick={() => void applyStocktake()}>{stocktakeBusy ? \'Проверяю и сохраняю…\' : stocktakeProgress.differences ? `Применить ${stocktakeProgress.differences} изменений` : \'Завершить проверку\'}</button>',
)

# Unify the short-check truth rule with the already accepted Overview behavior:
# risky rows are blind-first; ordinary rows may show the expected physical amount.
replace_once(
    renderer,
    "const attrs = [row.material !== 'СТАНДАРТ' ? row.material : '', row.length !== 'СТАНДАРТ' ? row.length : '', row.gender, row.color, row.size].filter(Boolean).join(' · ')\n                                        return <div className={`inventory-cycle-count-row ${value !== '' ? 'is-filled' : ''} ${Number(row.free || 0) < 0 ? 'needs-attention' : ''}`} key={`cycle-count-${row.variantId}`}>",
    "const attrs = [row.material !== 'СТАНДАРТ' ? row.material : '', row.length !== 'СТАНДАРТ' ? row.length : '', row.gender, row.color, row.size].filter(Boolean).join(' · ')\n                                        const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0\n                                        return <div className={`inventory-cycle-count-row ${value !== '' ? 'is-filled' : ''} ${needsIndependentCount ? 'needs-attention' : ''}`} key={`cycle-count-${row.variantId}`}>",
)
replace_once(
    renderer,
    '<div className="inventory-cycle-count-system"><span>На месте <strong>{row.physical}</strong></span>{Number(row.reserved || 0) ? <span>В заказах <strong>{row.reserved}</strong></span> : null}</div>',
    '<div className={`inventory-cycle-count-system ${needsIndependentCount ? \'is-blind\' : \'\'}`}>{needsIndependentCount ? <span><strong>Сначала посчитайте физически</strong></span> : <span>По системе: <strong>{row.physical}</strong> на месте</span>}{Number(row.reserved || 0) ? <span>В заказах <strong>{row.reserved}</strong></span> : null}</div>',
)
replace_once(
    renderer,
    '<label><span>Факт</span><input type="number" min="0" step="1" inputMode="numeric" value={value} placeholder="—"',
    '<label><span>{needsIndependentCount ? \'Введите факт\' : \'Факт\'}</span><input aria-label={`Фактическое количество ${row.productName}`} type="number" min="0" step="1" inputMode="numeric" value={value} placeholder={needsIndependentCount ? \'Посчитайте\' : \'—\'}',
)

# Human wording for destructive cancel confirmation/notice.
section = 'src/features/sections/InventorySection.tsx'
replace_once(
    section,
    "if (!window.confirm('Отменить текущую ревизию? Уже введённые числа останутся только в истории отменённой сессии и не изменят остатки.')) return",
    "if (!window.confirm('Отменить текущую проверку? Введённые числа останутся только в истории отменённой проверки и не изменят остатки. Если хотите продолжить позже, отменять не нужно.')) return",
)
replace_once(section, "setStocktakeNotice('Ревизия отменена. Остатки не изменялись.')", "setStocktakeNotice('Проверка отменена. Остатки не изменялись.')")
replace_once(section, "setStocktakeNotice('Для выборочной ревизии отметьте хотя бы один товар.')", "setStocktakeNotice('Для проверки нескольких товаров выберите хотя бы один товар.')")

# Load the W5 layer after the existing stocktake styles.
replace_once(
    section,
    "import '../../styles/188k1-stocktake-inline-add.css'\n",
    "import '../../styles/188k1-stocktake-inline-add.css'\nimport '../../styles/w5-checking-ux.css'\n",
)

Path('src/styles/w5-checking-ux.css').write_text(r'''/* W5 — Checking UX. Preserve the proven stocktake layout while making task hierarchy,
   destructive cancel, completion and small-screen actions easier to understand. */
.stocktake-e-start-v5 .stocktake-start-intro h4{font-size:20px;letter-spacing:-.01em}
.stocktake-start-modes-v5 .stocktake-start-mode{min-height:76px;justify-content:center}
.stocktake-start-modes-v5 .stocktake-start-mode strong{font-size:14px;line-height:1.25}
.stocktake-e-start-button,.stocktake-review-button,.stocktake-finish-button{min-height:44px;font-weight:800}
.stocktake-e-head-actions-wrap{display:grid;justify-items:end;gap:5px;min-width:0}
.stocktake-e-head-actions-wrap>small{max-width:280px;text-align:right;color:#64748b;font-size:10px;line-height:1.35}
.stocktake-e-head-actions{flex-wrap:wrap;justify-content:flex-end}
.stocktake-cancel-button{min-height:38px!important;border-color:#fecaca!important;background:#fff!important;color:#b91c1c!important;font-weight:750!important}
.stocktake-cancel-button:hover{border-color:#fca5a5!important;background:#fff7f7!important;color:#991b1b!important}
.stocktake-e-save-state strong{font-weight:800}
.stocktake-sticky-progress .stocktake-review-button{white-space:normal;line-height:1.2}
.stocktake-e-review-head .stocktake-review-back{min-height:38px;white-space:normal}
.stocktake-e-review-actions .stocktake-finish-button{flex:none;min-width:210px;white-space:normal}
.inventory-cycle-count-system.is-blind{justify-content:flex-start!important;color:#92400e}
.inventory-cycle-count-system.is-blind strong{color:#92400e}

@media(max-width:980px){
  .stocktake-e-active-head{grid-template-columns:minmax(0,1fr) auto!important;align-items:start!important}
  .stocktake-e-save-state{grid-column:1/2;grid-row:2;justify-self:stretch!important}
  .stocktake-e-head-actions-wrap{grid-column:2/3;grid-row:1/3;align-self:stretch;align-content:start}
}

@media(max-width:680px){
  .stocktake-e-head{padding:14px 12px 10px!important}
  .stocktake-e-head h3{font-size:19px}
  .stocktake-e-start-v5{padding:12px!important}
  .stocktake-start-modes-v5 .stocktake-start-mode{min-height:68px;padding:12px 13px!important}
  .stocktake-start-submit{gap:10px!important}
  .stocktake-e-start-button{width:100%;min-height:48px}
  .stocktake-e-active-head{display:grid!important;grid-template-columns:1fr!important;gap:10px!important;padding:12px!important}
  .stocktake-e-save-state,.stocktake-e-head-actions-wrap{grid-column:1!important;grid-row:auto!important;width:100%}
  .stocktake-e-head-actions-wrap{justify-items:stretch}
  .stocktake-e-head-actions{display:grid!important;grid-template-columns:1fr 1fr;gap:8px;width:100%}
  .stocktake-e-head-actions button{width:100%;min-width:0;min-height:44px!important;white-space:normal}
  .stocktake-e-head-actions-wrap>small{max-width:none;text-align:left;font-size:11px}
  .stocktake-sticky-progress{gap:8px!important}
  .stocktake-sticky-progress .stocktake-review-button{width:100%;min-height:46px}
  .stocktake-e-review-head .stocktake-review-back{width:100%;min-height:44px}
  .stocktake-e-review-actions{gap:10px!important}
  .stocktake-e-review-actions .stocktake-finish-button{width:100%;min-width:0;min-height:48px}
  .inventory-cycle-count-row>label{min-width:0}
  .inventory-cycle-count-row input{max-width:100%}
}

@media(max-width:420px){
  .stocktake-e-head-actions{grid-template-columns:1fr}
  .stocktake-e-active-head h4{font-size:17px!important;overflow-wrap:anywhere}
  .stocktake-e-active-head p{overflow-wrap:anywhere}
  .stocktake-sticky-progress-main strong{font-size:12px}
}
''', encoding='utf-8')

# Extend strict frontend preservation with one exact W5 stocktake renderer delta.
preserve = 'scripts/test-step1906b-frontend-modularization.mjs'
replace_once(
    preserve,
    "const w4HumanOperationsPath = path.join(root, 'scripts/w4-human-operations-frontend-manifest.json')\n",
    "const w4HumanOperationsPath = path.join(root, 'scripts/w4-human-operations-frontend-manifest.json')\nconst w5CheckingUxPath = path.join(root, 'scripts/w5-checking-ux-frontend-manifest.json')\n",
)
replace_once(
    preserve,
    "  const w4HumanOperations = fs.existsSync(w4HumanOperationsPath) ? JSON.parse(fs.readFileSync(w4HumanOperationsPath, 'utf8')) : null\n",
    "  const w4HumanOperations = fs.existsSync(w4HumanOperationsPath) ? JSON.parse(fs.readFileSync(w4HumanOperationsPath, 'utf8')) : null\n  const w5CheckingUx = fs.existsSync(w5CheckingUxPath) ? JSON.parse(fs.readFileSync(w5CheckingUxPath, 'utf8')) : null\n",
)
replace_once(
    preserve,
    "  if (w4HumanOperations) check(w4HumanOperations.version === 1 && w4HumanOperations.revision === 'w4-human-operations', 'W4 human operations frontend manifest invalid')\n",
    "  if (w4HumanOperations) check(w4HumanOperations.version === 1 && w4HumanOperations.revision === 'w4-human-operations', 'W4 human operations frontend manifest invalid')\n  if (w5CheckingUx) check(w5CheckingUx.version === 1 && w5CheckingUx.revision === 'w5-checking-ux', 'W5 checking UX frontend manifest invalid')\n",
)
replace_once(
    preserve,
    """    const w4PanelChange = w4HumanOperations?.frontend?.panelReturnChanges?.[panel.func]\n    if (w4PanelChange) {\n      check(w4PanelChange.before === expectedPanelHash, `${panel.func}: W4 human operations panel baseline hash mismatch`)\n      expectedPanelHash = w4PanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4 delta`)""",
    """    const w4PanelChange = w4HumanOperations?.frontend?.panelReturnChanges?.[panel.func]\n    if (w4PanelChange) {\n      check(w4PanelChange.before === expectedPanelHash, `${panel.func}: W4 human operations panel baseline hash mismatch`)\n      expectedPanelHash = w4PanelChange.after\n    }\n    const w5PanelChange = w5CheckingUx?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5PanelChange) {\n      check(w5PanelChange.before === expectedPanelHash, `${panel.func}: W5 checking UX panel baseline hash mismatch`)\n      expectedPanelHash = w5PanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5 delta`)""",
)

# Focused regression.
Path('scripts/test-w5-checking-ux.mjs').write_text(r'''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const renderer = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
const section = read('src/features/sections/InventorySection.tsx')
const css = read('src/styles/w5-checking-ux.css')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')

for (const marker of [
  'Что хотите проверить?',
  'Проверить несколько товаров',
  'Полная проверка точки',
  'Начать проверку выбранных товаров',
  'Начать полную проверку',
  'Сохранено автоматически ✓',
  'Отменить проверку',
  'Чтобы продолжить позже, отменять не нужно',
  'stocktake-review-button',
  'stocktake-finish-button',
]) check(renderer.includes(marker), `W5 stocktake UI marker missing: ${marker}`)

check(!renderer.includes('ghost compact danger\" type=\"button\" disabled={stocktakeBusy} onClick={() => void discardStocktake()}>Отменить</button>'), 'Old easy-to-miss cancel action returned')
check(renderer.includes("const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0"), 'Risk-sensitive short check is not blind-first')
check(renderer.includes("needsIndependentCount ? <span><strong>Сначала посчитайте физически</strong></span>"), 'Risk-sensitive short check still leaks the expected physical number')
check(section.includes("Если хотите продолжить позже, отменять не нужно."), 'Cancel confirmation does not distinguish leave/resume from destructive cancel')
check(section.includes("import '../../styles/w5-checking-ux.css'"), 'W5 checking CSS is not loaded')

for (const marker of [
  '@media(max-width:680px)',
  '@media(max-width:420px)',
  '.stocktake-e-head-actions button{width:100%',
  '.stocktake-e-start-button{width:100%;min-height:48px}',
  '.stocktake-e-review-actions .stocktake-finish-button{width:100%',
  '.stocktake-cancel-button{min-height:38px',
]) check(css.includes(marker), `W5 small-screen/action marker missing: ${marker}`)

check(preservation.includes('w5CheckingUxPath'), 'Frontend preservation does not load W5 manifest')
check(preservation.includes('W5 checking UX panel baseline hash mismatch'), 'Frontend preservation does not enforce exact W5 panel delta')

// Frozen Arrival remains untouched.
check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'Frozen Arrival add-position action changed')

console.log('W5 CHECKING UX PASSED — clearer hierarchy/cancel/completion, blind-first risk rows, small-screen actions protected')
''', encoding='utf-8')

# Release gate.
package = Path('package.json')
package_text = package.read_text(encoding='utf-8')
old = 'node scripts/test-w4-human-operations.mjs\"'
new = 'node scripts/test-w4-human-operations.mjs && node scripts/test-w5-checking-ux.mjs\"'
if package_text.count(old) != 1:
    raise SystemExit('package.json W4 release tail not found exactly once')
package.write_text(package_text.replace(old, new, 1), encoding='utf-8')

Path('docs/continuation/W5_0_W5_1_CHECKING_UX_20260905.md').write_text(r'''# W5.0 / W5.1 — Checking source audit and interface foundation

Date: 2026-09-05
Base Production: `40ea799cdaa35f1d39a7fa78687ebeeb115e2f61` (`W4: simplify Warehouse Operations for people`)

## W5.0 source audit

The existing revision engine is worth preserving. It already has server-backed resumable sessions, per-row autosave, a blind counting flow, a pre-apply review, stale/conflict handling and a cancellation path that does not apply entered counts. The main W5 risk is therefore not a missing stocktake engine; it is that several human tasks are presented at similar visual weight and important state/actions are easy to overlook.

Observed UX problems before W5.1:

- active revision cancellation was a small `ghost compact danger` action labelled only `Отменить`;
- safe leave/resume and destructive cancel were explained separately enough that users could reasonably confuse them;
- launch choices used the technical-ish scale labels `Выборочная` / `Полная` instead of describing what the person is doing;
- the short-check surface inside `Проверка` still showed the system physical quantity even for negative/free-shortage or prior-difference rows, while the accepted quick-check in `Остатки` already used blind-first behavior for the same risk class;
- mobile CSS existed and was generally good, but the active-session action cluster and review/completion controls did not have an explicit W5 tap-target/stacking contract.

No Production D1 reads were needed for this audit.

## W5.1 interface foundation

- Keep the existing revision counting layout and data model.
- Start screen now asks `Что хотите проверить?` and describes human tasks: `Проверить несколько товаров` or `Полная проверка точки`.
- Start button names the selected consequence instead of generic `Начать проверку`.
- Active session says `Сохранено автоматически` and explicitly tells the user that they can leave and resume later.
- Destructive action is now `Отменить проверку`, visually discoverable but secondary to completion. A visible note says that leaving the section does not require cancellation.
- Review and finish actions receive dedicated classes and mobile tap-target rules.
- Risk-sensitive short-check rows (negative availability or a prior difference) are blind-first, matching the already accepted routine check in `Остатки`.
- A W5 responsive layer stacks the active action cluster, review/back button and final action on small screens, with larger tap targets and no forced horizontal button row.

## Deliberate non-changes

- No migration and no Warehouse truth/business-rule change.
- No new D1 read or preload.
- No change to stocktake autosave/retry/idempotency implementation.
- No change to full-stocktake conflict/CAS behavior.
- No change to Arrival UI.
- Branch2 untouched.
- No points, streaks or mandatory checking.

## Next W5 work

Continue with W5.2/W5.3 after this interface foundation: unify the short-check interaction itself, then make the several-item check feel like a short voluntary queue rather than a miniature full revision. Full revision behavior should remain strict where independent counting is materially important.
''', encoding='utf-8')

print('W5 checking UX patch applied')

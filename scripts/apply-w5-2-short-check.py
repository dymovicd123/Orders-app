from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 occurrence, found {count}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

renderer = 'src/features/inventory/views/renderInventoryStocktakePanel.tsx'

replace_once(
    renderer,
    "<div className=\"inventory-cycle-count-summary\"><span><strong>{cycleCountData.recommendedCount}</strong> {Number(cycleCountData.recommendedCount) === 1 ? 'позиция просит внимания' : 'позиций просят внимания'}</span><button className=\"secondary compact\" type=\"button\" disabled={cycleCountLoading || cycleCountBusy || cycleCountData?.source !== stocktakeSource} onClick={() => { setCycleCountOpen((current) => !current); setCycleCountValues({}); setCycleCountNotice('') }}>{cycleCountOpen ? 'Свернуть' : 'Проверить сейчас'}</button></div>",
    "<div className=\"inventory-cycle-count-summary\"><span><strong>{cycleCountData.recommendedCount}</strong> {Number(cycleCountData.recommendedCount) === 1 ? 'позиция просит внимания' : 'позиций просят внимания'}</span><button className={cycleCountOpen ? 'secondary compact' : 'primary compact inventory-cycle-count-open-button'} type=\"button\" disabled={cycleCountLoading || cycleCountBusy || cycleCountData?.source !== stocktakeSource} onClick={() => { setCycleCountOpen((current) => !current); setCycleCountValues({}); setCycleCountNotice('') }}>{cycleCountOpen ? 'Свернуть' : 'Проверить сейчас'}</button></div>",
)

replace_once(
    renderer,
    "<div className={`inventory-cycle-count-system ${needsIndependentCount ? 'is-blind' : ''}`}>{needsIndependentCount ? <span><strong>Сначала посчитайте физически</strong></span> : <span>По системе: <strong>{row.physical}</strong> на месте</span>}{Number(row.reserved || 0) ? <span>В заказах <strong>{row.reserved}</strong></span> : null}</div>\n                                          <label><span>{needsIndependentCount ? 'Введите факт' : 'Факт'}</span><input aria-label={`Фактическое количество ${row.productName}`} type=\"number\" min=\"0\" step=\"1\" inputMode=\"numeric\" value={value} placeholder={needsIndependentCount ? 'Посчитайте' : '—'}",
    "<div className={`inventory-cycle-count-system ${needsIndependentCount ? 'is-blind' : ''}`}>{needsIndependentCount ? <span><strong>Сначала посчитайте физически</strong></span> : <span>По системе: <strong>{row.physical}</strong> на месте</span>}{Number(row.reserved || 0) ? <span>В заказах <strong>{row.reserved}</strong></span> : null}</div>\n                                          {!needsIndependentCount ? <button className={`secondary compact inventory-cycle-count-quick-confirm ${value === String(Math.max(0, Math.trunc(Number(row.physical || 0)))) ? 'is-confirmed' : ''}`} type=\"button\" disabled={cycleCountBusy} onClick={() => setCycleCountValues((current) => ({ ...current, [String(row.variantId)]: String(Math.max(0, Math.trunc(Number(row.physical || 0)))) }))}>{value === String(Math.max(0, Math.trunc(Number(row.physical || 0)))) ? '✓ Подтверждено' : `Да, на месте ${Math.max(0, Math.trunc(Number(row.physical || 0)))}`}</button> : null}\n                                          <label><span>{needsIndependentCount ? 'Введите факт' : 'Другое количество'}</span><input aria-label={`Фактическое количество ${row.productName}`} type=\"number\" min=\"0\" step=\"1\" inputMode=\"numeric\" value={value} placeholder={needsIndependentCount ? 'Посчитайте' : 'Если отличается'}",
)

replace_once(
    renderer,
    "<div className=\"inventory-cycle-count-actions\"><button className=\"primary\" type=\"button\" disabled={!cycleCountFilledCount || cycleCountBusy} onClick={() => void submitCycleCount()}>{cycleCountBusy ? 'Сохраняю…' : `Сохранить проверку${cycleCountFilledCount ? ` · ${cycleCountFilledCount}` : ''}`}</button><span>Совпавшие количества тоже запоминаются как проверенные.</span></div>",
    "<div className=\"inventory-cycle-count-actions inventory-cycle-count-actions-w5\"><button className=\"primary inventory-cycle-count-save-button\" type=\"button\" disabled={!cycleCountFilledCount || cycleCountBusy} onClick={() => void submitCycleCount()}>{cycleCountBusy ? 'Сохраняю…' : `Сохранить проверенные позиции${cycleCountFilledCount ? ` · ${cycleCountFilledCount}` : ''}`}</button><span>Сохранятся только строки, где вы подтвердили или ввели фактическое количество. Совпадения тоже запоминаются как свежая проверка.</span></div>",
)

section = 'src/features/sections/InventorySection.tsx'
replace_once(
    section,
    "import '../../styles/w5-checking-ux.css'\n",
    "import '../../styles/w5-checking-ux.css'\nimport '../../styles/w5-2-short-check.css'\n",
)

Path('src/styles/w5-2-short-check.css').write_text(r'''/* W5.2 — quick physical check: one obvious safe confirmation for normal rows,
   blind-first for risky rows, and large mobile tap targets. */
.inventory-cycle-count-open-button{min-height:42px;font-weight:800;white-space:normal}
.inventory-cycle-count-quick-confirm{min-height:40px;justify-self:stretch;font-weight:750;white-space:normal;line-height:1.2}
.inventory-cycle-count-quick-confirm.is-confirmed{border-color:#86efac!important;background:#f0fdf4!important;color:#166534!important}
.inventory-cycle-count-actions-w5{align-items:flex-start!important}
.inventory-cycle-count-save-button{min-height:46px;font-weight:800;white-space:normal;line-height:1.2}
.inventory-cycle-count-actions-w5>span{max-width:560px;line-height:1.4}

@media(max-width:680px){
  .inventory-cycle-count-summary{align-items:stretch!important}
  .inventory-cycle-count-summary button{width:100%;min-height:46px}
  .inventory-cycle-count-row{grid-template-columns:1fr!important;gap:10px!important}
  .inventory-cycle-count-quick-confirm{width:100%;min-height:46px}
  .inventory-cycle-count-row>label{width:100%}
  .inventory-cycle-count-row>label input{width:100%!important;min-height:46px}
  .inventory-cycle-count-actions-w5{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
  .inventory-cycle-count-save-button{width:100%;min-height:50px}
}

@media(max-width:420px){
  .inventory-cycle-count-summary{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
  .inventory-cycle-count-system{flex-wrap:wrap}
}
''', encoding='utf-8')

preserve = 'scripts/test-step1906b-frontend-modularization.mjs'
replace_once(
    preserve,
    "const w5CheckingUxPath = path.join(root, 'scripts/w5-checking-ux-frontend-manifest.json')\n",
    "const w5CheckingUxPath = path.join(root, 'scripts/w5-checking-ux-frontend-manifest.json')\nconst w5ShortCheckPath = path.join(root, 'scripts/w5-2-short-check-frontend-manifest.json')\n",
)
replace_once(
    preserve,
    "  const w5CheckingUx = fs.existsSync(w5CheckingUxPath) ? JSON.parse(fs.readFileSync(w5CheckingUxPath, 'utf8')) : null\n",
    "  const w5CheckingUx = fs.existsSync(w5CheckingUxPath) ? JSON.parse(fs.readFileSync(w5CheckingUxPath, 'utf8')) : null\n  const w5ShortCheck = fs.existsSync(w5ShortCheckPath) ? JSON.parse(fs.readFileSync(w5ShortCheckPath, 'utf8')) : null\n",
)
replace_once(
    preserve,
    "  if (w5CheckingUx) check(w5CheckingUx.version === 1 && w5CheckingUx.revision === 'w5-checking-ux', 'W5 checking UX frontend manifest invalid')\n",
    "  if (w5CheckingUx) check(w5CheckingUx.version === 1 && w5CheckingUx.revision === 'w5-checking-ux', 'W5 checking UX frontend manifest invalid')\n  if (w5ShortCheck) check(w5ShortCheck.version === 1 && w5ShortCheck.revision === 'w5-2-short-check', 'W5.2 short-check frontend manifest invalid')\n",
)
replace_once(
    preserve,
    """    const w5PanelChange = w5CheckingUx?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5PanelChange) {\n      check(w5PanelChange.before === expectedPanelHash, `${panel.func}: W5 checking UX panel baseline hash mismatch`)\n      expectedPanelHash = w5PanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5 delta`)""",
    """    const w5PanelChange = w5CheckingUx?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5PanelChange) {\n      check(w5PanelChange.before === expectedPanelHash, `${panel.func}: W5 checking UX panel baseline hash mismatch`)\n      expectedPanelHash = w5PanelChange.after\n    }\n    const w5ShortCheckChange = w5ShortCheck?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5ShortCheckChange) {\n      check(w5ShortCheckChange.before === expectedPanelHash, `${panel.func}: W5.2 short-check panel baseline hash mismatch`)\n      expectedPanelHash = w5ShortCheckChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2 delta`)""",
)

Path('scripts/test-w5-2-short-check.mjs').write_text(r'''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const renderer = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
const section = read('src/features/sections/InventorySection.tsx')
const css = read('src/styles/w5-2-short-check.css')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const w5 = JSON.parse(read('scripts/w5-checking-ux-frontend-manifest.json'))
const w52 = JSON.parse(read('scripts/w5-2-short-check-frontend-manifest.json'))

check(renderer.includes("cycleCountOpen ? 'secondary compact' : 'primary compact inventory-cycle-count-open-button'"), 'Short-check entry action is not promoted when closed')
check(renderer.includes("!needsIndependentCount ? <button className={`secondary compact inventory-cycle-count-quick-confirm"), 'Normal short-check rows have no one-click physical confirmation')
check(renderer.includes('`Да, на месте ${Math.max(0, Math.trunc(Number(row.physical || 0)))}`'), 'Quick confirmation does not state the exact physical fact')
check(renderer.includes("needsIndependentCount ? 'Введите факт' : 'Другое количество'"), 'Alternative count field is not clearly explained')
check(renderer.includes('Сохранить проверенные позиции'), 'Short-check save action is not human-readable')
check(renderer.includes('Сохранятся только строки, где вы подтвердили или ввели фактическое количество.'), 'Short-check consequence copy missing')

// Critical truth invariant: risky rows remain blind-first and never receive the system-value quick-confirm button.
const riskMarker = "const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0"
check(renderer.includes(riskMarker), 'Risk classification changed')
check(renderer.includes("{!needsIndependentCount ? <button"), 'Quick confirm is not gated away from risky rows')
check(renderer.includes("needsIndependentCount ? <span><strong>Сначала посчитайте физически</strong></span>"), 'Risk row no longer stays blind-first')

// One click only records local form state; the existing submit action remains the sole mutation owner.
const quickStart = renderer.indexOf('{!needsIndependentCount ? <button')
const quickEnd = renderer.indexOf('</button> : null}', quickStart)
check(quickStart >= 0 && quickEnd > quickStart, 'Quick-confirm button block missing')
const quickBlock = renderer.slice(quickStart, quickEnd)
check(quickBlock.includes('setCycleCountValues'), 'Quick confirm does not set local count state')
check(!quickBlock.includes('submitCycleCount'), 'Quick confirm must not write immediately')
check(renderer.includes('onClick={() => void submitCycleCount()}'), 'Existing explicit short-check submit owner disappeared')

check(section.includes("import '../../styles/w5-2-short-check.css'"), 'W5.2 responsive CSS not loaded')
for (const marker of ['@media(max-width:680px)', '@media(max-width:420px)', '.inventory-cycle-count-quick-confirm{', '.inventory-cycle-count-save-button{', 'min-height:50px']) {
  check(css.includes(marker), `W5.2 mobile/tap marker missing: ${marker}`)
}

check(w52.version === 1 && w52.revision === 'w5-2-short-check', 'W5.2 frontend manifest invalid')
check(w52.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.before === w5.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.after, 'W5.2 frontend preservation must chain from exact W5.1 renderer hash')
check(preservation.includes('w5ShortCheckPath') && preservation.includes('W5.2 short-check panel baseline hash mismatch'), '1906B preservation does not enforce W5.2 exact delta')

// Frozen Arrival remains intact.
check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'Frozen Arrival add-position action changed')

console.log('W5.2 SHORT CHECK PASSED — one-click normal confirmation, blind-first risk rows, explicit save, mobile tap targets')
''', encoding='utf-8')

package = Path('package.json')
package_text = package.read_text(encoding='utf-8')
old = 'node scripts/test-w5-checking-ux.mjs\"'
new = 'node scripts/test-w5-checking-ux.mjs && node scripts/test-w5-2-short-check.mjs\"'
if package_text.count(old) != 1:
    raise SystemExit('package.json W5.1 release tail not found exactly once')
package.write_text(package_text.replace(old, new, 1), encoding='utf-8')

Path('docs/continuation/W5_2_SHORT_CHECK_20260905.md').write_text(r'''# W5.2 — Short physical check

Date: 2026-09-05
Base Production: `4d96abe35037ec1baabb4bfb85969672974fb40d` (`W5.1: clarify Warehouse checking flow`)

## Goal

Make the small voluntary check genuinely fast without weakening physical truth. A normal row should take one obvious tap when the system amount is visibly correct. A risky row must still be independently counted before the system amount can influence the answer.

## Changes

- `Проверить сейчас` is the prominent action while the short check is closed; `Свернуть` becomes secondary once it is open.
- Normal rows get one explicit local confirmation: `Да, на месте N`.
- Tapping that confirmation only fills the local fact field. It does not write inventory immediately.
- If the real amount differs, the same row exposes `Другое количество`.
- Risky rows (negative availability or a previous difference) keep the W5.1 blind-first rule and do not get a system-value quick-confirm action.
- The only write remains the existing `submitCycleCount()` action, now labelled `Сохранить проверенные позиции · N`.
- Consequence copy states that only rows with a confirmed/entered physical fact are saved; equal counts are still recorded as a fresh check.
- Mobile layout makes open/save/quick-confirm/input actions full-width and >=46–50px where appropriate.

## Invariants

- No new endpoint, table, migration or background read.
- No immediate mutation on quick confirmation.
- Existing cycle-count reconciliation remains the sole mutation path.
- Risky rows stay blind-first.
- Full revision/session logic unchanged.
- Arrival UI frozen and untouched.
- Branch2 untouched.

## Next

W5.3 should simplify `Проверить несколько товаров` into a short, understandable voluntary queue while retaining the existing safe resumable stocktake session underneath.
''', encoding='utf-8')

print('W5.2 short-check patch applied')

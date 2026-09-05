import fs from 'node:fs'
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

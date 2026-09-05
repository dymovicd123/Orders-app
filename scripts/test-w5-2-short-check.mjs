import fs from 'node:fs'
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

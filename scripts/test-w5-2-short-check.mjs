import fs from 'node:fs'
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

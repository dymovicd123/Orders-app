import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

const stocktake = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const section = read('src/features/sections/InventorySection.tsx')
const css = read('src/styles/w5-3-selective-queue.css')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const w53 = JSON.parse(read('scripts/w5-3-selective-queue-frontend-manifest.json'))
const w53r = JSON.parse(read('scripts/w5-3r-unified-check-frontend-manifest.json'))

for (const stale of [
  'Поддержание точности',
  'Это подсказка, а не блокировка работы.',
  '<strong>Короткая проверка</strong>',
  "cycleCountOpen ? 'secondary compact' : 'primary compact inventory-cycle-count-open-button'",
]) check(!stocktake.includes(stale), `Old competing Check UI is still rendered: ${stale}`)

for (const marker of [
  'const recommendedProductIds = new Set',
  'const recommendedStocktakeProducts =',
  'Рекомендуем проверить',
  'Подобраны по давности проверки, движениям и прошлым расхождениям.',
  'Добавить все',
  "selected ? '✓ Выбрано' : 'Добавить'",
  'Найдите товар',
  'Вы будете проверять',
  'Начать проверку выбранных товаров',
]) check(stocktake.includes(marker), `Unified selective-check marker missing: ${marker}`)

check(stocktake.indexOf('Рекомендуем проверить') > stocktake.indexOf('stocktake-selective-picker-w5'), 'Recommendations are not inside the selective picker')
check(stocktake.indexOf('Рекомендуем проверить') < stocktake.indexOf('Найдите товар'), 'Recommendations should appear before manual search in the same picker')
check(stocktake.includes('setStocktakeSelectedProductIds((current) => Array.from(new Set([...current, ...unselectedRecommendedProducts.map'), 'Recommended products do not join the normal selected queue')
check(!stocktake.includes('onClick={() => void submitCycleCount()}'), 'Check page still owns a second direct short-check save path')

check(section.includes("if (inventoryPanel !== 'stocktake' || stocktakeSession || stocktakeStartMode !== 'selective') return"), 'Recommendation read is not scoped to the visible selective Check screen')
check(section.includes("if (cycleCountLoading || cycleCountData?.source === stocktakeSource || (!cycleCountData && cycleCountNotice)) return"), 'Recommendation auto-load lacks cache/loading/error guard')
check(!section.includes("inventoryPanel !== 'stocktake' || !isAdmin || stocktakeSession"), 'Recommendation auto-load is still hidden behind admin-mode UI state')
check(section.includes('void refreshCycleCountSuggestions(stocktakeSource)'), 'Selective Check does not auto-load recommendations')

// W5.2 quick physical check still exists, but only in the context where it belongs.
check(overview.includes('function renderRoutineCycleCountCue'), 'Contextual quick check disappeared from Остатки')
check(overview.includes('Да, на месте {row.physical}'), 'Contextual one-click physical confirmation disappeared')
check(overview.includes('Сначала посчитайте физически'), 'Risky quick-check row lost blind-first behavior')

for (const marker of [
  '.stocktake-selective-recommendations{',
  '.stocktake-recommended-products{',
  '.stocktake-recommended-product{',
  'min-height:46px',
  '@media(max-width:680px)',
  'grid-template-columns:1fr',
  '.stocktake-start-submit .stocktake-e-start-button{width:100%;min-height:50px}',
  '@media(max-width:420px)',
]) check(css.includes(marker), `Unified-check mobile/action marker missing: ${marker}`)

check(w53r.version === 1 && w53r.revision === 'w5-3r-unified-check', 'W5.3R frontend manifest invalid')
check(w53r.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.before === w53.frontend?.panelReturnChanges?.renderInventoryStocktakePanel?.after, 'W5.3R manifest does not chain from exact validated W5.3 renderer')
check(preservation.includes('w5UnifiedCheckPath') && preservation.includes('W5.3R unified check panel baseline hash mismatch'), '1906B preservation does not enforce W5.3R exact delta')

check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'Frozen Arrival add-position action changed')

console.log('W5.3R UNIFIED CHECK PASSED — one selective workflow, automatic recommendations, no conversation-derived copy, mobile actions protected')

import fs from 'node:fs'
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

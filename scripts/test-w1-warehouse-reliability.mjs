import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const windowAfter = (text, marker, size = 7000) => {
  const from = text.indexOf(marker)
  check(from >= 0, `Missing marker: ${marker}`)
  return text.slice(from, from + size)
}

const app = read('src/App.tsx')
const css = read('src/styles/187-inventory-health.css')
const catalog = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const catalogAdminModes = read('src/features/inventory/views/catalogLegacyAdminModes.tsx')
const catalogSurface = `${catalog}\n${catalogAdminModes}`

const openPanel = windowAfter(app, 'const openInventoryPanel = (panel: InventoryPanel) => {', 1200)
check(openPanel.includes("nextPanel === 'catalog' || nextPanel === 'settings'"), 'manager navigation does not preserve structural/admin panel guard')
check(!openPanel.includes("nextPanel !== 'overview' && nextPanel !== 'attention'"), 'stale manager blanket navigation guard returned')

check(css.includes('.inventory-tabs-step187.is-manager {\n  grid-template-columns: repeat(5, minmax(0, 1fr));\n}'), 'manager Warehouse nav is not horizontal on desktop')
check(css.includes('.inventory-tabs-step187.is-manager {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }'), 'manager Warehouse nav has no medium responsive grid')
check(css.includes('.inventory-tabs-step187.is-manager {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }'), 'manager Warehouse nav has no small responsive grid')

for (const marker of ['Уточнить товары', 'Нужно уточнить, какой это товар', 'система не смогла безопасно определить точный товар или вариант']) {
  check(catalogSurface.toLowerCase().includes(marker.toLowerCase()), `human Catalog Review explanation missing: ${marker}`)
}
check(catalog.includes("renderLegacyInventoryCatalogPanel(ctx as any)"), 'W6.2 Catalog must keep delegated admin/recovery modes reachable')

for (const [label, marker] of [
  ['auto reconcile', 'async function reconcileCatalogReview'],
  ['resolve facts', 'async function resolveCatalogReviewFacts'],
  ['exclude', 'async function excludeCatalogReviewItem'],
  ['legacy link', 'async function resolveCatalogReviewItem'],
]) {
  const block = windowAfter(app, marker)
  check(block.includes('settleCatalogReviewRefreshes(['), `${label}: successful mutation can still be turned into refresh failure`)
  check(block.includes('Изменение сохранено, но часть экрана не обновилась.'), `${label}: partial refresh message missing`)
}
check(app.includes('Promise.allSettled(tasks)'), 'Catalog Review refresh isolation helper missing')

console.log('W1 WAREHOUSE RELIABILITY TESTS PASSED — manager routine panels open, nav is horizontal, delegated Catalog Review wording is preserved, and successful catalog-review mutations survive secondary refresh failures')

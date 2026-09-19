import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const utils = read('src/app/utils.ts')
  const returns = read('src/features/sections/OrderReturnsSection.tsx')
  const exchange = read('src/features/sections/OrderExchangeSection.tsx')
  const domain = read('worker/domains/returns-exchanges.ts')
  const lifecycle = read('worker/domains/lifecycle.ts')

  check(utils.includes("physicalState: (item.sourceType === 'workshop' ? 'no_stock' : 'pending')"), 'Workshop Return no longer defaults to no-stock')
  check(utils.includes("oldPhysicalState: firstItem?.sourceType === 'workshop' ? 'no_stock' : 'pending'"), 'Workshop Exchange no longer defaults to no-stock')

  check(!returns.includes("item.sourceType !== 'workshop' ? <option value=\"boutique\">"), 'Return form still hides Boutique for Workshop items')
  check(!returns.includes("!item.isWorkshop ? <option value=\"boutique\">"), 'Return receipt history still hides Boutique for Workshop items')
  check((returns.match(/<option value="boutique">/g) || []).length >= 2, 'Return flow no longer exposes explicit Boutique destination in form and receipt history')
  check(returns.includes('явно выберите «Склад» или «Бутик»'), 'Return flow does not explain explicit Workshop destination')

  check(!exchange.includes("!effectiveOldItemIsWorkshop ? <option value=\"boutique\">"), 'Exchange form still hides Boutique for Workshop old items')
  check(!exchange.includes("!entry.oldIsWorkshop ? <option value=\"boutique\">"), 'Exchange receipt history still hides Boutique for Workshop old items')
  check((exchange.match(/<option value="boutique">/g) || []).length >= 3, 'Exchange flow no longer exposes Boutique as an explicit old-item destination')
  check(!exchange.includes('Для вещи из Цеха Бутик недоступен.'), 'Exchange still tells users Boutique is forbidden for Workshop returns')
  check(exchange.includes('явно выберите «Склад» или «Бутик»'), 'Exchange flow does not explain explicit Workshop destination')

  check(!domain.includes("isWorkshop && inventorySource === 'boutique'"), 'Return backend still rejects explicit Workshop -> Boutique intake')
  check(!domain.includes("oldItemIsWorkshop && oldReturnSource === 'boutique'"), 'Exchange backend still rejects explicit Workshop -> Boutique intake')
  check(!domain.includes("isWorkshop && destination === 'boutique'"), 'Deferred physical receipt backend still rejects Workshop -> Boutique')
  check(domain.includes("const trackedInventorySource = physicalState === 'warehouse' || physicalState === 'boutique' ? physicalState : null"), 'Return backend lost explicit destination derivation')
  check(domain.includes("const trackedOldReturnSource = oldPhysicalState === 'warehouse' || oldPhysicalState === 'boutique' ? oldPhysicalState : 'none'"), 'Exchange backend lost explicit destination derivation')
  check(domain.includes("inventorySource: destination as 'warehouse' | 'boutique'"), 'Physical receipt no longer persists the chosen Warehouse/Boutique lifecycle destination')
  check(lifecycle.includes("normalizeSourceType(event.inventory_source) === 'warehouse' ? 'Склад' : 'Бутик'"), 'Lifecycle resolution is no longer destination-agnostic between Warehouse and Boutique')

  console.log('STAGE02 PHASE1B R2 WORKSHOP BOUTIQUE DISPOSITION TESTS PASSED — Workshop returns remain no-stock by default, while Warehouse and Boutique are both explicit, freshness-safe inventory destinations.')
} catch (error) {
  console.error(`STAGE02 PHASE1B R2 WORKSHOP BOUTIQUE DISPOSITION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

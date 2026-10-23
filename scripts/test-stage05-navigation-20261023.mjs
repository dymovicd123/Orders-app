import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const ui=readFileSync(new URL('../src/features/inventory/views/InventoryDemandStatistics.tsx',import.meta.url),'utf8')
const sql=readFileSync(new URL('../worker/domains/warehouse-demand.ts',import.meta.url),'utf8')
const css=readFileSync(new URL('../src/features/inventory/views/inventory-demand-statistics.css',import.meta.url),'utf8')
assert.ok(ui.includes('Все оформленные заказы') && ui.includes('Только отправленные товары'),
 'Explicit scope selection should distinguish demand from actual handover')
assert.ok(ui.includes("useState<Scope>('orders')"), 'Default should show all ordered demand')
assert.ok(ui.includes('response.periodOrderCount') && ui.includes('response.periodShippedOrderCount'),
 'Explain why ordered and shipped counts are different')
assert.ok(!ui.includes('inventory-demand-tabs'), 'Remove cramped tiny navigation tabs')
assert.ok(ui.includes("analysisCard('product'") && ui.includes("analysisCard('color'") && ui.includes("analysisCard('size'"),
 'Show models, colors and sizes together')
assert.ok(ui.includes('demand-dialog'), 'Use focused detail panel instead of nested appended blocks')
assert.ok(ui.includes("selection?.kind==='product'?selection.name"), 'Model should lead straight to variants')
assert.ok(ui.includes('Эти два фильтра меняют все показатели'), 'Make scope of filters clear')
assert.ok(ui.includes('Поиск меняет только список моделей'), 'Make search scope clear')
assert.ok(ui.includes('unitPrice') && ui.includes('orderTotal'), 'Show source item price and total clearly')
assert.ok(sql.includes("url.searchParams.get('scope') === 'shipped'") && sql.includes("scope === 'orders'") && sql.includes("o.shipping_status = 'sent'"),
 'Backend must distinguish sent-only filtering from the ordered default')
assert.ok(sql.includes("o.order_date BETWEEN") && sql.includes("o.shipping_status = 'sent'"), 'Use correct dates for each type')
assert.ok(css.includes('.demand-scope') && css.includes('.demand-dialog'), 'Styles for prominent scope and drawer')
console.log('STAGE05_DEMAND_DASHBOARD_SCOPE_FILTERS_AND_CLEAR_DETAILS_PASSED')

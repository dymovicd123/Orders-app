import fs from 'node:fs'
import assert from 'node:assert/strict'
const read = p => fs.readFileSync(p,'utf8')
const header=read('src/features/sections/OrdersHeaderSection.tsx')
const css=read('src/styles/order-stock-attention-banner.css')
const issues=read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const inventory=read('src/features/sections/InventorySection.tsx')
const backend=read('worker/domains/warehouse-attention.ts')
const history=read('worker/domains/inventory-stocktake.ts')
const timeline=read('src/features/inventory/views/StockVariantTimeline.tsx')
const contract=read('shared/api-contracts.ts')

// The orders banner only alerts about *current* active-reservation shortages.
assert.match(header,/shortageCount/)
assert.match(header,/warehouseAttention\?\.counts\?\.shortage/)
assert.match(header,/случаев.*нехватки по активным заказам/)
assert.match(header,/Открыть случаи и действия/)
assert.doesNotMatch(header,/shippedCount|shippedUntracked|stockConcerns|при уже выполненной отправке/)
assert.match(css,/orders-stock-attention-counts/)

// Warehouse attention must preserve specific problem-resolution actions.
assert.match(issues,/openAttentionHistory\(item\)/)
assert.match(issues,/По системе не хватает/)
assert.match(issues,/Посмотреть историю/)
assert.match(issues,/Корректировка после пересчёта/)
assert.match(issues,/openAttentionCorrection\(item\)/)
assert.doesNotMatch(issues,/Посмотреть данные учёта/)
assert.equal((issues.match(/onClick=\{\(\) => openAttentionHistory\(item\)\}/g)||[]).length,1,
 'Only actionable current shortage needs a link in Warehouse Attention')
assert.match(issues,/Старые отправки остаются в истории товара/)
assert.match(issues,/Number\(item.variantId\) > 0/)
assert.match(inventory,/openSimpleStockHistory\(\{/)
assert.match(inventory,/source: item.source === 'boutique'/)
assert.match(inventory,/variantId: Number\(item.variantId\)/)

// Historical outbound evidence is not an actionable task but MUST remain in SKU History.
assert.doesNotMatch(backend,/shippedUntracked|shippedUntrackedCountRow|shippedUntrackedRows/)
assert.match(backend,/FROM inventory_reservations/)
assert.match(history,/FROM inventory_operation_evidence e/)
assert.match(history,/AS unexplained_quantity/)
assert.match(timeline,/movement\.unexplainedQuantity/)
assert.match(timeline,/Это исторический факт/)
assert.match(contract,/shortage:\s*number/)
assert.doesNotMatch(contract,/WarehouseAttentionShippedUntrackedItem|shippedUntracked/)
assert.doesNotMatch(issues,/saveInventoryMovement\(/)
console.log('W12.4 STOCK CASES PASSED — live SKU shortage actions, historical movements preserved, no hidden stock writes')

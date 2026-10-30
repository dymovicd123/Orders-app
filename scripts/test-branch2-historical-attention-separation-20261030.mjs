// A shipped-order stock discrepancy is forensic evidence, not a live warehouse task.
// Never delete evidence/movements or disguise active reservation shortages as historic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(path, 'utf8')
const backend = read('worker/domains/warehouse-attention.ts')
const actions = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const shell = read('src/features/sections/InventorySection.tsx')
const orderHeader = read('src/features/sections/OrdersHeaderSection.tsx')
const contract = read('shared/api-contracts.ts')
const historyRead = read('worker/domains/inventory-stocktake.ts')
const timeline = read('src/features/inventory/views/StockVariantTimeline.tsx')
const stocktake = read('worker/domains/inventory-stocktake.ts')

assert.doesNotMatch(backend, /shippedUntracked|shippedUntrackedCountRow|shippedUntrackedRows/)
assert.doesNotMatch(backend, /evidence\.operation_type\s*=\s*'shipping'/)
assert.match(backend, /FROM inventory_reservations/)
assert.match(backend, /r\.status\s*=\s*'active'/)
assert.match(backend, /fetchOrderStockHandoverRows\(/)
assert.match(backend, /counts\.shortage\s*\+/)
assert.doesNotMatch(backend, /counts\.shortage\s*\+\s*counts\.shippedUntracked/)

assert.doesNotMatch(actions, /shippedUntracked|is-shipped-untracked|Историческая нехватка при отправке/)
assert.match(actions, /shortage:\s*Number\(counts\?\.shortage\s*\|\|\s*0\)/)
assert.match(actions, /openAttentionHistory\(item\)/)
assert.match(actions, /openAttentionOrder\(item\)/)
assert.match(actions, /openAttentionCorrection\(item\)/)
assert.match(actions, /старые отправки|Старые отправки/i)

assert.match(shell, /const warehouseShortageCount\s*=\s*Number\(warehouseAttention\?\.counts\?\.shortage\s*\|\|\s*0\)/)
assert.doesNotMatch(shell, /counts\?\.shippedUntracked/)
assert.doesNotMatch(orderHeader, /shippedUntracked|shippedCount|stockConcerns/)
assert.match(orderHeader, /warehouseAttention\?\.counts\?\.shortage/)
assert.doesNotMatch(contract, /WarehouseAttentionShippedUntrackedItem|shippedUntracked/)
assert.match(contract, /shortage:\s*number/)
assert.match(contract, /handover:\s*number/)

// Historical evidence is still joined onto the exact SKU movement timeline.
// Any old physical checks remain, and NO stock rows are modified by this feature.
assert.match(historyRead, /FROM inventory_operation_evidence e/)
assert.match(historyRead, /AS unexplained_quantity/)
assert.match(timeline, /movement\.unexplainedQuantity/)
assert.match(timeline, /Это исторический факт/)
assert.match(timeline, /последующими движениями и физическими сверками/)
assert.match(stocktake, /FROM inventory_stock_checks/)
assert.match(stocktake, /ORDER BY m\.id DESC/)
console.log('BRANCH2 HISTORICAL ATTENTION SEPARATION PASSED: live shortages kept; old shipped evidence lives in SKU history')

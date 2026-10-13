import fs from 'node:fs'
import assert from 'node:assert/strict'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const panel = fs.readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')
const inventory = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')

const route = worker.split("if (url.pathname === '/api/inventory/movements' && request.method === 'POST') {")[1]?.split("if (url.pathname === '/api/inventory/transfer' && request.method === 'POST') {")[0]
assert.ok(route, 'Warehouse movement route changed: inspect access boundary')
assert.match(route, /managerWarehouseOperation = \['arrival', 'manual_set', 'writeoff'\]\.includes\(movementType\)/,
 'Temporary manager access must be an explicit allowlist')
assert.match(route, /if \(!managerWarehouseOperation\) \{\s*const denied = requireAdminAccess\(request\)/,
 'Unsupported direct movements must still require admin authorization')
assert.match(route, /const actor = cleanText\(request\.headers\.get\('X-Access-User'\)\)/,
 'Warehouse movements must preserve the authenticated actor')
assert.ok(!route.includes("movementType === 'sale'"), 'Ordinary manager must not impersonate a sale movement')
const modePicker = section.split('const selectInventoryOperationMode = (mode: any) => {')[1]?.split('const inventoryMovementHumanLabel')[0]
assert.ok(modePicker, 'Warehouse UI action picker missing')
assert.ok(!modePicker.includes("mode === 'arrival' && !isAdmin"), 'Manager arrival is still secretly blocked')
assert.match(panel, /\['arrival','Приход'\]/)
assert.match(panel, /\['manual_set','Исправить количество'\]/)
assert.ok(!panel.includes("{isAdmin ? (\n                        <details className=\"inventory-operation-more-actions\">"),
 'Manager still cannot see Warehouse actions')
assert.ok(!app.includes("Приход товара доступен только администратору."),
 'Frontend still blocks manager arrival')
assert.match(app, /inventoryDraft\.movementType === 'manual_set'\) && !inventoryDraft\.comment\.trim\(\)/,
 'Explicit stock correction must require a reason')
assert.match(inventory, /if \(movementType === 'manual_set'\) \{[\s\S]*?duplicate/,
 'Correction must keep duplicate-input protection')
assert.match(inventory, /__manual_operation_conflict__/,
 'Stock mutation must still enforce optimistic freshness checks')
assert.match(worker, /requireAdminUser\(authUser, 'Объединение вариантов доступно только администратору\.'/,
 'SKU merging must stay administrative')
assert.match(worker, /if \(wantsNewReferenceValue\) \{\s*const denied = requireAdminAccess\(request\)/,
 'Manager must not be able to create master data by a stocktake')
console.log('TEMP MANAGER WAREHOUSE ACCESS PASSED — arrival and explicit correction, not master data or silent order counts')

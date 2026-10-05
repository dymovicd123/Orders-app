import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const worker = read('worker/index.ts')
const movement = read('worker/domains/inventory-movement.ts')
const app = read('src/App.tsx')
const section = read('src/features/sections/InventorySection.tsx')
const panel = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const operational = read('src/app/controllers/useOperationalViewModel.ts')

const routeStart = worker.indexOf("if (url.pathname === '/api/inventory/movements' && request.method === 'POST')")
const routeEnd = worker.indexOf("if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')", routeStart)
const route = worker.slice(routeStart, routeEnd)

check(routeStart >= 0 && routeEnd > routeStart, 'Inventory movement route missing')
check(route.includes("const routineExistingStockOperation = movementType === 'manual_set' || movementType === 'writeoff';"), 'Manager-safe correction/writeoff boundary missing')
check(route.includes("if (!routineExistingStockOperation)"), 'Arrival is not inside the privileged movement branch')
check(route.includes('requireAdminAccess(request)'), 'Arrival backend is not admin-only')
check(!route.includes('arrivalCatalogCreationMode'), 'Obsolete manager Arrival catalog policy remains in the route')

check(!movement.includes("type ArrivalCatalogCreationMode = 'admin' | 'manager';"), 'Obsolete manager Arrival policy type remains')
check(!movement.includes('assertManagerArrivalCreationSafe'), 'Obsolete manager Arrival preflight remains')
check(movement.includes("allowRetiredRecreate: movementType === 'arrival'"), 'Admin Arrival lost safe retired-variant recreation semantics')

check(app.includes("if (!isAdmin && inventoryDraft.movementType === 'arrival')"), 'Frontend fail-fast Arrival admin guard missing')
check(app.includes("Приход товара доступен только администратору."), 'Frontend Arrival denial message missing')
check(panel.includes("...(isAdmin ? [['arrival', 'Приход']] : [])"), 'Arrival action is not hidden from non-admin users')
check(section.includes("if (mode === 'arrival' && !isAdmin) return"), 'Direct manager Arrival selection is not blocked')
check(section.includes("hint: isAdmin ? 'Приход, списание и перемещение' : 'Списание и перемещение'"), 'Manager Operations hint still advertises Arrival')

// Admin Arrival must still be a valid place to materialize a new variant/canonical SKU.
check(movement.includes('resolveInventoryCreatableItemsBulk(db, creatableRaw'), 'Arrival can no longer materialize a new variant')
check(operational.includes("gender: automaticGender || first?.gender || position.gender"), 'Unisex Arrival product selection still erases a concrete existing SKU gender')

console.log('ARRIVAL ADMIN-ONLY R1 PASSED — Arrival is hidden and blocked for managers while admin Arrival keeps safe canonical variant materialization')

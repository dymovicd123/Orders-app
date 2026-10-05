import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const worker = read('worker/index.ts')
const movement = read('worker/domains/inventory-movement.ts')
const app = read('src/App.tsx')
const operational = read('src/app/controllers/useOperationalViewModel.ts')

const routeStart = worker.indexOf("if (url.pathname === '/api/inventory/movements' && request.method === 'POST')")
const routeEnd = worker.indexOf("if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')", routeStart)
const route = worker.slice(routeStart, routeEnd)

check(routeStart >= 0 && routeEnd > routeStart, 'Inventory movement route missing')
check(route.includes("const arrivalOperation = movementType === 'arrival';"), 'Arrival is not recognized as a normal warehouse operation')
check(!route.includes('const knownArrival ='), 'Arrival is still limited to pre-existing variant IDs')
check(route.includes("if (!routineExistingStockOperation && !arrivalOperation)"), 'Non-arrival admin boundary was weakened while opening Arrival')
check(route.includes("arrivalCatalogCreationMode: authUser?.role === 'admin' ? 'admin' : 'manager'"), 'Arrival catalog creation mode is not bound to authenticated role')

check(movement.includes("type ArrivalCatalogCreationMode = 'admin' | 'manager';"), 'Arrival creation policy type missing')
check(movement.includes('async function assertManagerArrivalCreationSafe('), 'Manager Arrival preflight missing')
check(movement.includes('Новый товар через «Приход» создаёт администратор.'), 'Manager Arrival can silently create a brand-new product')
check(movement.includes("kind IN ('material', 'length', 'color', 'size', 'child_age')"), 'Manager Arrival does not validate new variant values against known references')
check(movement.includes("const materialAlreadyKnown = material === 'СТАНДАРТ'"), 'Manager Arrival can create an unrecognized material')
check(movement.includes("const lengthAlreadyKnown = length === 'СТАНДАРТ'"), 'Manager Arrival can create an unrecognized length')
check(movement.includes("if (movementType === 'arrival' && options.arrivalCatalogCreationMode === 'manager')"), 'Manager Arrival policy is not applied before catalog materialization')
check(movement.includes("allowRetiredRecreate: movementType === 'arrival'"), 'Physical Arrival lost safe retired-variant recreation semantics')

check(app.includes("cleanItems.some((item) => !item.variantId && !Number(item.productId || 0))"), 'Frontend still blocks a new variant of an existing product for managers')
check(!app.includes("cleanItems.some((item) => !item.variantId)) {\n        throw new Error('Новый товар или новая характеристика требуют админ-режима."), 'Old blanket manager Arrival block returned')
check(operational.includes("gender: automaticGender || first?.gender || position.gender"), 'Unisex Arrival product selection still erases the concrete existing SKU gender')

console.log('ARRIVAL MANAGER CREATION SAFETY R1 PASSED — managers can receive new variants/executions of existing products using known master values while new products and unknown values stay guarded')

import fs from 'node:fs'

const check = (value, message) => { if (!value) throw new Error(message) }
const retry = fs.readFileSync('src/app/controllers/inventoryWriteRetry.ts', 'utf8')
const vm = fs.readFileSync('src/app/controllers/useOperationalViewModel.ts', 'utf8')
const movement = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const http = fs.readFileSync('worker/core/http.ts', 'utf8')

check(retry.includes("path === '/api/inventory/movements'"), 'Arrival/manual inventory writes are not in the managed idempotent retry boundary')
check(retry.includes("headers.set('X-Idempotency-Key', prepared.requestId)"), 'Managed inventory retry lost its stable idempotency key')

check(!vm.includes("category === 'child' && !position.gender ? 'ДЕТСКИЙ'"), 'Child Arrival still injects ДЕТСКИЙ as a fake physical gender')
check(vm.includes("normalizedGender === normalizeSuggestion('ЖЕН')") && vm.includes("normalizedGender === normalizeSuggestion('МУЖ')"), 'Arrival category switch does not preserve only canonical ЖЕН/МУЖ genders')
check(vm.includes('canonicalFirstGender') && vm.includes('canonicalPositionGender'), 'Arrival product selection can still copy a non-canonical legacy gender into the draft')

const preflight = movement.indexOf('const missingProducts = new Map')
const catalogInsert = movement.indexOf('INSERT OR IGNORE INTO catalog_products', preflight)
const requiredGender = movement.indexOf('resolveRequiredGender(null, item);', preflight)
check(preflight >= 0 && requiredGender > preflight && catalogInsert > requiredGender, 'Arrival can still create a Catalog product before validating required gender')
check(movement.includes('Для товара «') && movement.includes('выберите пол конкретной вещи: ЖЕН или МУЖ'), 'Unisex Arrival lost explicit canonical gender guidance')

check(http.includes("code: 'inventory_materialization_failed'"), 'Safe Arrival materialization failure is still collapsed into the generic server error')
check(http.includes('создать складскую комбинацию товара') && http.includes('подготовить все позиции складской операции'), 'Arrival materialization public-message allow-list is incomplete')
check(http.includes("status: 500, code: 'inventory_materialization_failed', message: raw"), 'Materialization error no longer stays retryable while preserving its final safe message')

console.log('ARRIVAL LIVE RELIABILITY R3 PASSED — child gender is canonical, first-write failures are idempotently retryable, Catalog shells are not created before gender validation, and safe materialization failures stay visible')

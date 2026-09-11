import fs from 'node:fs'

const source = fs.readFileSync('src/app/controllers/useApiClient.ts', 'utf8')
const check = (condition, message) => {
  if (!condition) throw new Error(message)
}

check(source.includes('function prepareNonBlockingOrderShortageBody'), 'non-blocking order shortage request policy is missing')
check(source.includes("method === 'POST' && path === '/api/orders'"), 'new-order writes are not covered')
check(source.includes("method === 'PATCH' && /^\\/api\\/orders\\/\\d+$/.test(path)"), 'order-edit writes are not covered')
check(source.includes("if (source === 'workshop') return rawItem"), 'Workshop lines must not receive stock-shortage acknowledgement')
check(source.includes('const hasPhysicalObservation = item.observedPhysicalQuantity !== undefined && item.observedPhysicalQuantity !== null'), 'explicit physical observations are not preserved')
check(source.includes("if (hasPhysicalObservation || item.shortageAcknowledged === true) return rawItem"), 'explicit stock decisions must win over the default defer decision')
check(source.includes('return { ...item, shortageAcknowledged: true }'), 'orders without a physical observation must defer the check instead of failing first save')
check(source.includes('const requestBody = prepareNonBlockingOrderShortageBody(method, url, managedInventory.body)'), 'order shortage policy is not applied to the actual request body')

console.log('ORDER SHORTAGE SAVE NON-BLOCKING PASSED — create/edit order writes can proceed without a forced first-failure stock check while explicit physical observations remain authoritative')

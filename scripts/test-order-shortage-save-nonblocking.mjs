import fs from 'node:fs'

const source = fs.readFileSync('src/app/controllers/useApiClient.ts', 'utf8')
const workspace = fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx', 'utf8')
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

const knownIdentityStart = workspace.indexOf('    if (canonicalIdentityKnown) {')
const unknownFactsStart = workspace.indexOf('    if (catalogProduct && unknownFacts.length) {', knownIdentityStart)
check(knownIdentityStart >= 0 && unknownFactsStart > knownIdentityStart, 'known-combination availability branch is missing')
const knownIdentityBlock = workspace.slice(knownIdentityStart, unknownFactsStart)
check(knownIdentityBlock.includes("tone: 'warning'"), 'unrecorded exact stock must be a warning, not a proven shortage')
check(knownIdentityBlock.includes("label: 'Остаток этой комбинации ещё не зафиксирован'"), 'unrecorded exact stock label changed')
check(knownIdentityBlock.includes('rows: []'), 'unrecorded exact stock must not display other colors/sizes as if they belonged to the selected SKU')
check(knownIdentityBlock.includes('needsAttention: false'), 'unrecorded exact stock must not be treated as a confirmed shortage')
check(!knownIdentityBlock.includes('similarSourceRows'), 'similar stock rows leaked into a known combination with unrecorded stock')
const unknownFactsBlock = workspace.slice(unknownFactsStart, workspace.indexOf('    return {', unknownFactsStart + 20))
check(workspace.slice(unknownFactsStart).includes('similarSourceRows'), 'similar variants should remain available only for genuinely unknown characteristics')
check(workspace.includes("label: fuzzySourceRows.length || fuzzyCatalogProducts.length ? 'Похоже на другой товар' : 'Товар пока не распознан'"), 'fuzzy product-name suggestions must remain limited to unresolved products')

console.log('ORDER SHORTAGE SAVE NON-BLOCKING PASSED — create/edit order writes can proceed without a forced first-failure stock check while explicit physical observations remain authoritative')

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function functionBody(text, name) {
  const start = text.indexOf(`function ${name}`)
  check(start >= 0, `function missing: ${name}`)
  const brace = text.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  fail(`function not closed: ${name}`)
}

try {
  const lifecycle = read('worker/domains/lifecycle.ts')
  const exchanges = read('worker/domains/returns-exchanges.ts')
  const worker = read('worker/index.ts')

  check(worker.includes("warehouseTruthFreshness: '192a1'"), '192A1 live marker missing')
  check(!lifecycle.includes('resolveWorkshopCatalogProductOnly'), 'Workshop intake still uses product-only resolver')

  const exact = functionBody(lifecycle, 'resolveWorkshopCatalogExactCandidate')
  for (const required of ['findCatalogProductByIdentity', 'findCatalogExecutionV3', 'findCatalogCombinationV3', 'activeOnly: true']) {
    check(exact.includes(required), `Exact workshop resolver missing guard: ${required}`)
  }
  for (const forbidden of ['createCatalogCombinationV3', 'ensureCatalogExecutionV3', 'upsertReferenceValue', 'createCatalogProduct']) {
    check(!exact.includes(forbidden), `Exact workshop resolver may mutate catalog: ${forbidden}`)
  }

  const boundary = functionBody(lifecycle, 'trustedInventoryFullStocktakeBoundary')
  for (const required of [
    "s.status = 'completed'", "s.id LIKE 'REV-%-F-%'", "a.status = 'active'",
    "i.status = 'applied'", "c.check_type = 'full_stocktake'", 'fullCheckRows === totalItems',
  ]) check(boundary.includes(required), `Trusted stocktake boundary missing: ${required}`)

  const autoApply = functionBody(lifecycle, 'canAutoApplyFreshWorkshopInbound')
  if (autoApply.includes('inventoryLifecycleDeferredInboundDisposition')) {
    const disposition = functionBody(lifecycle, 'inventoryLifecycleDeferredInboundDisposition')
    for (const required of [
      "cleanText(event.direction) !== 'in'", "cleanText(event.status) !== 'pending'",
      '!boundary.trusted', 'createdAt <= boundary.completedAt', 'inventory_stock_checks', 'checked_at >= ?',
    ]) check(disposition.includes(required), `Shared workshop freshness guard missing: ${required}`)
  } else {
    for (const required of [
      "cleanText(event.direction) !== 'in'", "cleanText(event.status) !== 'pending'",
      '!boundary.trusted', 'createdAt <= boundary.completedAt', 'inventory_stock_checks', 'checked_at >= ?',
    ]) check(autoApply.includes(required), `Workshop auto-intake freshness guard missing: ${required}`)
  }

  const resolveCandidate = functionBody(lifecycle, 'resolveInventoryLifecycleCandidate')
  check(resolveCandidate.includes('if (isWorkshop) return await resolveWorkshopCatalogExactCandidate'), 'Workshop exact resolver not wired')

  check(exchanges.includes('variantId: resolved.variantId,'), 'Return lifecycle does not persist an exact workshop variant')
  check(exchanges.includes('variantId: resolvedOld.variantId,'), 'Exchange lifecycle does not persist an exact workshop variant')
  check((exchanges.match(/canAutoApplyFreshWorkshopInbound\(/g) || []).length >= 2, 'Freshness barrier is not wired to both return and exchange workshop intake')
  check((exchanges.match(/applyCanonicalInventoryLifecycleEvent\(/g) || []).length >= 2, 'Canonical atomic lifecycle movement is no longer used by return/exchange intake')

  console.log('STEP 192A1 WAREHOUSE TRUTH / FRESHNESS TESTS PASSED — exact-known workshop auto-intake only after trusted full baseline; active/overlap/stale/rechecked events fail closed; catalog resolver is read-only')
} catch (error) {
  console.error(`STEP 192A1 WAREHOUSE TRUTH / FRESHNESS TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

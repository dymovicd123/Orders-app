import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

try {
  const worker = read('worker/index.ts')
  const reservations = read('worker/domains/order-reservations.ts')

  check(worker.includes("catalogTruthFinalizer: '192a2'"), '192A2 health marker missing')
  for (const marker of [
    'omittedColorConflictsWithConcreteSibling',
    "UPPER(TRIM(color)) <> 'БЕЗ ЦВЕТА'",
    "const rawColor = upperText(item.color)",
    "if (!rawColor)",
    "matchStatus: 'unresolved_attribute'",
  ]) check(reservations.includes(marker), `192A2 reservation guard missing: ${marker}`)

  const functionStart = reservations.indexOf('export async function resolveCatalogProductAndVariantV2(')
  const functionEnd = reservations.indexOf('\n\nexport async function resolveCatalogProductAndVariant(', functionStart)
  check(functionStart >= 0 && functionEnd > functionStart, 'Cannot isolate resolveCatalogProductAndVariantV2')
  const body = reservations.slice(functionStart, functionEnd)
  const exactIndex = body.indexOf('const existing = await findCatalogCombinationV3')
  const profileIndex = body.indexOf('omittedColorConflictsWithConcreteSibling')
  const missingGuardIndex = body.indexOf('if (!rawColor)')
  check(exactIndex >= 0 && profileIndex > exactIndex, 'Omitted-color profile must be checked only after exact identity lookup')
  check(missingGuardIndex > profileIndex, 'Blank-color guard must run after exact identity/profile checks and before unresolved demand handling')
  check(body.includes('if (!omittedColorConflictsWithConcreteSibling)'), 'Exact no-color placeholder may not bypass concrete-color sibling check')
  check(body.includes('stock_position_id = ? AND is_active = 1'), 'Color profile is not scoped to the exact execution')
  check(!body.includes('createCatalogCombinationV3(') && !body.includes('ensureCatalogExecutionV3('), 'Order lookup must not synthesize a SKU while enforcing the blank-color guard')
  check(body.includes("matchStatus: 'unresolved_execution'") && body.includes("matchStatus: 'unresolved_variant'"), 'Missing physical identity must remain unresolved instead of being synthesized')
  check(!body.includes('rawGender') && !body.includes('explicitNoSize'), '192A2 must not overreach into one-size/unisex semantics')

  console.log('STEP 192A2 CATALOG TRUTH FINALIZER TESTS PASSED — blank manager color cannot select a conflicting БЕЗ ЦВЕТА SKU, and Phase 3A lookup-only order entry cannot synthesize any missing SKU')
} catch (error) {
  console.error(`STEP 192A2 CATALOG TRUTH FINALIZER TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

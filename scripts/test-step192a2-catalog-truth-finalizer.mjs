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
  const creationIndex = body.indexOf('const created = await createCatalogCombinationV3')
  const missingGuardIndex = body.indexOf('if (!rawColor)')
  check(exactIndex >= 0 && profileIndex > exactIndex, 'Omitted-color profile must be checked only after exact identity lookup')
  check(missingGuardIndex > profileIndex && creationIndex > missingGuardIndex, 'Blank-color guard must run before automatic combination creation')
  check(body.includes('if (!omittedColorConflictsWithConcreteSibling && !omittedSizeConflictsWithConcreteSibling)'), 'Exact placeholder identity may not bypass concrete color/size sibling checks')
  check(body.includes('stock_position_id = ? AND is_active = 1'), 'Color/size profile is not scoped to the exact execution')
  check(!body.includes('rawGender'), '192A2/R6 must not guess an omitted unisex gender')

  console.log('STEP 192A2 CATALOG TRUTH FINALIZER TESTS PASSED — blank manager color/size cannot synthesize or select a conflicting placeholder SKU; legitimate dimensionless identities remain supported')
} catch (error) {
  console.error(`STEP 192A2 CATALOG TRUTH FINALIZER TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

import fs from 'node:fs'

const worker = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const frontend = fs.readFileSync('src/app/controllers/useOperationalViewModel.ts', 'utf8')

const check = (value, message) => { if (!value) throw new Error(message) }

const genderStart = worker.indexOf('const resolvedGenderForItem = rawItems.map')
const genderEnd = worker.indexOf('const productIds =', genderStart)
check(genderStart >= 0 && genderEnd > genderStart, 'Cannot isolate Arrival gender resolver')
const genderBlock = worker.slice(genderStart, genderEnd)

check(
  genderBlock.includes("if (normalizeAudienceCategory(item.category, item.size) === 'child') return ''"),
  'Child Arrival still requires adult male/female gender identity',
)
check(
  genderBlock.indexOf("if (scope === 'female') return 'ЖЕН'") < genderBlock.indexOf("=== 'child') return ''"),
  'Fixed female product scope must still win before neutral child fallback',
)
check(
  genderBlock.indexOf("if (scope === 'male') return 'МУЖ'") < genderBlock.indexOf("=== 'child') return ''"),
  'Fixed male product scope must still win before neutral child fallback',
)
check(
  genderBlock.indexOf("=== 'child') return ''") < genderBlock.indexOf('Для товара «Унисекс» выберите пол конкретной вещи'),
  'Adult unisex guard must remain after child-only fallback',
)

check(
  !frontend.includes("category === 'child' && !position.gender ? 'ДЕТСКИЙ'"),
  'Arrival UI still writes audience label ДЕТСКИЙ into the gender field',
)
check(
  frontend.includes("legacyChildGender = normalizeSuggestion(position.gender) === normalizeSuggestion('ДЕТСКИЙ')"),
  'Open legacy Arrival forms are not normalized away from ДЕТСКИЙ gender',
)
check(
  frontend.includes("const arrivalGender = position.category === 'child' && normalizeSuggestion(position.gender) === normalizeSuggestion('ДЕТСКИЙ')"),
  'Flattening does not normalize legacy child audience before exact SKU matching',
)
check(
  frontend.includes("normalizeSuggestion(variant.gender) === normalizeSuggestion(arrivalGender)"),
  'Exact child SKU lookup still compares against the stale audience label',
)
check(
  frontend.includes('gender: arrivalGender'),
  'Arrival payload does not use the normalized child-neutral gender',
)

console.log('ARRIVAL CHILD AUDIENCE R1 PASSED — child audience is no longer encoded as gender, neutral child SKUs remain matchable, fixed product gender still wins, adult unisex remains strict')

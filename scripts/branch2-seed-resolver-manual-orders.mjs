import fs from 'node:fs'
import ts from 'typescript'

const BASE_URL = String(process.env.BASE_URL || '').replace(/\/$/, '')
const RUN_TAG = String(process.env.RUN_TAG || Date.now()).replace(/[^0-9A-Za-z]/g, '').slice(-10)
if (!BASE_URL) throw new Error('BASE_URL is required')

async function req(path, init = {}) {
  const response = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { ok: response.ok, status: response.status, data }
}
async function must(path, init = {}) {
  const r = await req(path, init)
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status}: ${JSON.stringify(r.data)}`)
  return r.data
}
const post = (path, body) => must(path, { method: 'POST', body: JSON.stringify(body) })
const norm = (v) => String(v ?? '').trim().toUpperCase()

const refs = await must('/api/reference-data')
const catalog = await must('/api/catalog')
const [warehouse, boutique] = await Promise.all([
  must('/api/inventory?source=warehouse&includeMovements=0&limit=1000'),
  must('/api/inventory?source=boutique&includeMovements=0&limit=1000'),
])

const manager = (refs.managerOptions || [])[0]
if (!manager?.id) throw new Error('No active manager in branch2')

const products = (catalog.products || []).filter(p => p.isActive)
const productById = new Map(products.map(p => [Number(p.id), p]))
const variants = (catalog.variants || []).filter(v => v.isActive && productById.has(Number(v.productId)))
if (!variants.length) throw new Error('No active catalog variants in branch2')

const inv = [...(warehouse.items || []), ...(boutique.items || [])]
const invByKey = new Map(inv.filter(x => x.variantId).map(x => [`${x.inventorySource}:${x.variantId}`, x]))

const canonicalItem = (v, sourceType='warehouse', overrides={}) => ({
  productName: v.productName,
  gender: v.gender || '',
  color: v.color || '',
  material: v.material || 'СТАНДАРТ',
  length: v.length || 'СТАНДАРТ',
  size: v.sizeLabel || '',
  quantity: 1,
  unitPrice: 0,
  sourceType,
  audienceType: v.productCategory === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
  shortageAcknowledged: true,
  ...overrides,
})

function hasRef(kind, value, category='adult') {
  const n = norm(value)
  if (!n) return true
  if ((kind === 'material' || kind === 'length') && n === 'СТАНДАРТ') return true
  const list =
    kind === 'material' ? refs.materials :
    kind === 'length' ? refs.lengths :
    kind === 'color' ? refs.colors :
    kind === 'size' ? (category === 'child' ? refs.childAges : refs.sizes) : []
  return (list || []).some(x => norm(x) === n)
}

const safeVariant =
  variants.find(v =>
    ['ЖЕН','МУЖ'].includes(norm(v.gender)) &&
    hasRef('material', v.material, v.productCategory) &&
    hasRef('length', v.length, v.productCategory) &&
    hasRef('color', v.color, v.productCategory) &&
    hasRef('size', v.sizeLabel, v.productCategory)
  ) || variants[0]

const stockCandidate = inv.find(x =>
  x.variantId &&
  Number(x.availableQuantity || 0) > 0 &&
  variants.some(v => Number(v.id) === Number(x.variantId))
)
const stockVariant = stockCandidate && variants.find(v => Number(v.id) === Number(stockCandidate.variantId))

let zeroCandidate = null
for (const v of variants) {
  for (const source of ['warehouse','boutique']) {
    const row = invByKey.get(`${source}:${v.id}`)
    if (!row || Number(row.quantity || 0) <= 0) { zeroCandidate = { v, source }; break }
  }
  if (zeroCandidate) break
}

const unisexProduct = products.find(p =>
  p.genderScope === 'unisex' &&
  variants.some(v => Number(v.productId) === Number(p.id) && ['ЖЕН','МУЖ'].includes(norm(v.gender)))
)
const unisexVariant = unisexProduct && variants.find(v =>
  Number(v.productId) === Number(unisexProduct.id) && ['ЖЕН','МУЖ'].includes(norm(v.gender))
)

const fixedProduct = products.find(p =>
  ['female','male'].includes(p.genderScope) &&
  variants.some(v => Number(v.productId) === Number(p.id))
)
const fixedVariant = fixedProduct && variants.find(v => Number(v.productId) === Number(fixedProduct.id))

let ambiguousVariant = null
for (const p of products) {
  const pv = variants.filter(v => Number(v.productId) === Number(p.id))
  outer: for (const a of pv) {
    for (const b of pv) {
      if (a.id === b.id) continue
      const sameBase =
        norm(a.gender) === norm(b.gender) &&
        norm(a.material) === norm(b.material) &&
        norm(a.length) === norm(b.length) &&
        String(a.productCategory) === String(b.productCategory)
      const differs = norm(a.color) !== norm(b.color) || norm(a.sizeLabel) !== norm(b.sizeLabel)
      if (sameBase && differs) { ambiguousVariant = a; break outer }
    }
  }
  if (ambiguousVariant) break
}

function pickGarbageField(v) {
  const candidates = [
    ['material', v.material, 'material'],
    ['color', v.color, 'color'],
    ['length', v.length, 'length'],
    ['size', v.sizeLabel, 'size'],
  ]
  for (const [field, value, kind] of candidates) {
    if (norm(value) && hasRef(kind, value, v.productCategory)) return { field, value }
  }
  return { field: 'color', value: v.color || 'ЧЕРНЫЙ' }
}
const garbageField = pickGarbageField(safeVariant)

const cases = []
const add = (code, title, expected, items) => cases.push({ code, title, expected, items })

if (stockVariant) {
  add('T01', 'Известный SKU с положительным остатком',
    'Catalog resolver не должен появиться.',
    [canonicalItem(stockVariant, stockCandidate.inventorySource)])
}
if (zeroCandidate) {
  add('T02', 'Известный SKU без фактического остатка/строки остатка',
    'Catalog resolver не должен появиться; при отправке возможен stock resolver.',
    [canonicalItem(zeroCandidate.v, zeroCandidate.source)])
}
add('T03', 'Полностью новый товар',
  'Catalog resolver должен спросить, какой это товар; не создавать новый товар автоматически.',
  [canonicalItem(safeVariant, 'warehouse', { productName: `ТЕСТ НОВЫЙ ТОВАР ${RUN_TAG}` })])

add('T04', 'Известный товар с мусорным именем',
  'Catalog resolver должен предложить существующий товар, но не угадывать молча.',
  [canonicalItem(safeVariant, 'warehouse', { productName: `${safeVariant.productName} МУСОР ${RUN_TAG}` })])

const learnedRaw = `ТЕСТ РАНЕЕ НЕИЗВЕСТНЫЙ ${RUN_TAG}`
add('T05A', 'Обучение алиаса товара — первая попытка',
  'Разреши как существующий товар через полный разбор фактов.',
  [canonicalItem(safeVariant, 'warehouse', { productName: learnedRaw })])
add('T05B', 'Обучение алиаса товара — повтор',
  'После T05A resolver в идеале уже не должен снова спрашивать этот товар.',
  [canonicalItem(safeVariant, 'warehouse', { productName: learnedRaw })])

add('T06', 'Совершенно новая характеристика',
  'Resolver должен показать неизвестную характеристику и не создавать справочное значение молча.',
  [canonicalItem(safeVariant, 'warehouse', { material: `ТЕСТ НОВЫЙ МАТЕРИАЛ ${RUN_TAG}` })])

const badValue = `${garbageField.value} МУСОР ${RUN_TAG}`
const garbageOverrides = { [garbageField.field]: badValue }
add('T07A', 'Известная характеристика с мусорным именем — первая попытка',
  `Исправь ${garbageField.field} на существующее значение «${garbageField.value}».`,
  [canonicalItem(safeVariant, 'warehouse', garbageOverrides)])
add('T07B', 'Известная характеристика с мусорным именем — повтор',
  'После T07A resolver в идеале должен помнить alias характеристики.',
  [canonicalItem(safeVariant, 'warehouse', garbageOverrides)])

if (unisexVariant) {
  add('T08', 'Unisex товар без пола',
    'Resolver должен спросить только пол, а не угадывать.',
    [canonicalItem(unisexVariant, 'warehouse', { gender: '' })])
}
if (fixedVariant) {
  add('T09', 'Товар с фиксированным полом, пол не указан',
    'Пол должен восстановиться автоматически; лишнего вопроса быть не должно.',
    [canonicalItem(fixedVariant, 'warehouse', { gender: '' })])
}
if (ambiguousVariant) {
  add('T10', 'Пустые цвет и размер при нескольких возможных SKU',
    'Resolver не должен выбрать конкретный SKU молча; должен спросить недостающий факт.',
    [canonicalItem(ambiguousVariant, 'warehouse', { color: '', size: '' })])
}

const scopedRaw = `ТЕСТ ДВЕ ОДИНАКОВЫЕ ${RUN_TAG}`
add('T11', 'Две одинаково записанные проблемные позиции',
  'Ответ для первой строки не должен автоматически примениться ко второй.',
  [
    canonicalItem(safeVariant, 'warehouse', { productName: scopedRaw }),
    canonicalItem(safeVariant, 'warehouse', { productName: scopedRaw }),
  ])

add('T12', 'Несколько разных проблем в одном заказе',
  'Resolver должен пройти вопросы последовательно и не потерять прогресс.',
  [
    canonicalItem(safeVariant, 'warehouse', { productName: `ТЕСТ MULTI NEW ${RUN_TAG}` }),
    canonicalItem(safeVariant, 'warehouse', { productName: `${safeVariant.productName} МУСОР MULTI ${RUN_TAG}` }),
    canonicalItem(safeVariant, 'warehouse', { material: `ТЕСТ MULTI MAT ${RUN_TAG}` }),
  ])

add('T13', 'Цеховая позиция с неизвестным товаром',
  'Resolver может уточнить базовый товар, но не должен создавать обычный складской SKU/остаток.',
  [canonicalItem(safeVariant, 'workshop', { productName: `ТЕСТ ЦЕХ НЕИЗВЕСТНЫЙ ${RUN_TAG}`, shortageAcknowledged: false })])

add('T14', 'Известный товар с разным регистром и пробелами',
  'Нормализация должна распознать товар/характеристики без лишней формы.',
  [canonicalItem(safeVariant, 'warehouse', {
    productName: `   ${String(safeVariant.productName).toLowerCase()}   `,
    gender: ` ${String(safeVariant.gender || '').toLowerCase()} `,
    color: ` ${String(safeVariant.color || '').toLowerCase()} `,
    material: ` ${String(safeVariant.material || '').toLowerCase()} `,
    length: ` ${String(safeVariant.length || '').toLowerCase()} `,
    size: ` ${String(safeVariant.sizeLabel || '').trim()} `,
  })])

const created = []
for (const test of cases) {
  const externalId = `RES-${test.code}-${RUN_TAG}`
  const payload = {
    requestId: `resolver-seed-${test.code}-${RUN_TAG}`,
    externalId,
    orderDate: new Date().toISOString().slice(0,10),
    managerId: Number(manager.id),
    managerName: manager.name,
    sourceType: test.items[0]?.sourceType === 'boutique' ? 'boutique' : 'warehouse',
    orderTotal: 0,
    comment: `RESOLVER TEST ${test.code}: ${test.title}. Ожидание: ${test.expected}`,
    items: test.items,
    payments: [],
  }
  const result = await post('/api/orders', payload)
  created.push({
    code: test.code,
    orderId: Number(result.orderId || 0),
    externalId: result.externalId || externalId,
    title: test.title,
    expected: test.expected,
  })
  console.log(JSON.stringify(created.at(-1)))
}

console.log('\n=== MANUAL RESOLVER TEST ORDERS CREATED ===')
console.log(JSON.stringify({
  runTag: RUN_TAG,
  baseUrl: BASE_URL,
  safeVariant: {
    id: safeVariant.id,
    product: safeVariant.productName,
    gender: safeVariant.gender,
    color: safeVariant.color,
    material: safeVariant.material,
    length: safeVariant.length,
    size: safeVariant.sizeLabel,
  },
  garbageField,
  orders: created,
}, null, 2))

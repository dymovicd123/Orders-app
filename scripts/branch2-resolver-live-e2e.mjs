import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const BASE_URL = String(process.env.BASE_URL || '').replace(/\/$/, '')
const RUN_TAG = String(process.env.RUN_TAG || Date.now()).replace(/[^0-9A-Za-z]/g, '').slice(-12)
if (!BASE_URL) throw new Error('BASE_URL is required')

const flowSource = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const module = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: module.exports, module },
)
const { initialDraft, nextQuestion, rankedProducts, needsReference } = module.exports

const results = []
const createdOrderIds = []
const cleanupErrors = []
const note = (id, status, message, details = {}) => {
  results.push({ id, status, message, ...details })
  console.log(`[${status}] ${id}: ${message}`)
}
const pass = (id, message, details) => note(id, 'PASS', message, details)
const fail = (id, message, details) => note(id, 'FAIL', message, details)
const skip = (id, message, details) => note(id, 'SKIP', message, details)

async function req(path, init = {}) {
  const response = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  let data = null
  const text = await response.text()
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, ok: response.ok, data }
}
async function must(path, init = {}) {
  const r = await req(path, init)
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status}: ${JSON.stringify(r.data)}`)
  return r.data
}
const post = (path, body) => req(path, { method: 'POST', body: JSON.stringify(body) })

function productById(catalog, id) {
  return (catalog.products || []).find(p => Number(p.id) === Number(id))
}
function norm(v) { return String(v ?? '').trim().toUpperCase() }
function variantItem(v, sourceType = 'warehouse', overrides = {}) {
  return {
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
  }
}
function canonicalFacts(v) {
  return {
    productId: Number(v.productId),
    createProduct: false,
    category: v.productCategory || 'adult',
    gender: v.gender || '',
    color: v.color || '',
    material: v.material || 'СТАНДАРТ',
    length: v.length || 'СТАНДАРТ',
    size: v.sizeLabel || '',
    createFields: [],
  }
}
function questionFor(item, context) {
  const draft = initialDraft(item, context)
  const remainder = ''
  return { draft, question: nextQuestion(context, draft, { remainder, classified: false, confirmed: {}, legacy: false, editing: null }) }
}
async function createTestOrder(label, itemOrItems) {
  const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems]
  const refs = await must('/api/reference-data')
  const manager = (refs.managerOptions || [])[0]
  if (!manager?.id) throw new Error('No active manager available in branch2')
  const externalId = `AUTO-RES-${RUN_TAG}-${label}`.slice(0, 80)
  const payload = {
    requestId: `auto-resolver-${RUN_TAG}-${label}`,
    externalId,
    orderDate: new Date().toISOString().slice(0, 10),
    managerId: Number(manager.id),
    managerName: manager.name,
    sourceType: items[0]?.sourceType === 'boutique' ? 'boutique' : 'warehouse',
    orderTotal: 0,
    comment: `AUTO RESOLVER E2E ${RUN_TAG} ${label}`,
    items,
    payments: [],
  }
  const r = await post('/api/orders', payload)
  if (!r.ok) throw new Error(`Create ${label} -> ${r.status}: ${JSON.stringify(r.data)}`)
  const orderId = Number(r.data?.orderId || 0)
  if (!orderId) throw new Error(`Create ${label}: missing orderId`)
  createdOrderIds.push(orderId)
  const order = (await must(`/api/orders/${orderId}`)).order
  return { orderId, order, externalId }
}
async function review(orderId) {
  return await must(`/api/orders/${orderId}/catalog-review`)
}
async function context(orderId, itemId) {
  return await must(`/api/orders/${orderId}/catalog-review/${itemId}/context`)
}
async function cleanupOrder(orderId) {
  const r = await post(`/api/orders/${orderId}/delete`, {
    requestId: `auto-resolver-cleanup-${RUN_TAG}-${orderId}`,
    comment: 'AUTO RESOLVER E2E cleanup',
    physicalOutcome: 'not_issued',
  })
  if (!r.ok) throw new Error(`cleanup ${orderId}: ${r.status} ${JSON.stringify(r.data)}`)
}

const health = await must('/api/health')
if (!health?.ok) throw new Error('Branch2 health is not ok')
const [refs, catalog, warehouse, boutique] = await Promise.all([
  must('/api/reference-data'),
  must('/api/catalog'),
  must('/api/inventory?source=warehouse&includeMovements=0&limit=1000'),
  must('/api/inventory?source=boutique&includeMovements=0&limit=1000'),
])

const products = (catalog.products || []).filter(p => p.isActive)
const variants = (catalog.variants || []).filter(v => v.isActive && productById(catalog, v.productId)?.isActive)
const invItems = [...(warehouse.items || []), ...(boutique.items || [])]
const invByKey = new Map(invItems.filter(x => x.variantId).map(x => [`${x.inventorySource}:${x.variantId}`, x]))
const safeRef = (kind, value, category = 'adult') => {
  const normalized = norm(value)
  if (!normalized) return true
  if ((kind === 'material' || kind === 'length') && normalized === 'СТАНДАРТ') return true
  const list = kind === 'size' ? (category === 'child' ? refs.childAges : refs.sizes) : refs[kind + 's']
  return (list || []).some(v => norm(v) === normalized)
}
const safeVariant = variants.find(v =>
  ['ЖЕН','МУЖ'].includes(norm(v.gender))
  && safeRef('material', v.material, v.productCategory)
  && safeRef('length', v.length, v.productCategory)
  && safeRef('color', v.color, v.productCategory)
  && safeRef('size', v.sizeLabel, v.productCategory)
) || variants.find(v => ['ЖЕН','МУЖ'].includes(norm(v.gender))) || variants[0]
if (!safeVariant) throw new Error('No active catalog variant available')

const stockCandidate = invItems.find(x => x.variantId && Number(x.availableQuantity) > 0 && variants.some(v => Number(v.id) === Number(x.variantId)))
const zeroCandidate = (() => {
  for (const v of variants) {
    for (const source of ['warehouse','boutique']) {
      const row = invByKey.get(`${source}:${v.id}`)
      if (!row || Number(row.quantity || 0) <= 0) return { v, source }
    }
  }
  return null
})()

try {
  // T01 — exact known SKU with available Physical.
  if (stockCandidate) {
    const v = variants.find(x => Number(x.id) === Number(stockCandidate.variantId))
    const t = await createTestOrder('T01', variantItem(v, stockCandidate.inventorySource))
    const r = await review(t.orderId)
    const linked = Number(t.order?.items?.[0]?.variantId || 0)
    if (r.count === 0 && linked === Number(v.id)) pass('T01', 'Known in-stock SKU bypassed catalog resolver', { variantId: v.id, source: stockCandidate.inventorySource })
    else fail('T01', 'Known in-stock SKU still entered catalog resolver or linked wrong SKU', { review: r, linked, expected: v.id })
  } else skip('T01', 'No positive available stock fixture found')

  // T02 — known SKU absent/zero in selected stock source: catalog must still be known.
  if (zeroCandidate) {
    const t = await createTestOrder('T02', variantItem(zeroCandidate.v, zeroCandidate.source))
    const r = await review(t.orderId)
    const linked = Number(t.order?.items?.[0]?.variantId || 0)
    if (r.count === 0 && linked === Number(zeroCandidate.v.id)) pass('T02', 'Known SKU with no tracked Physical bypassed catalog resolver', { variantId: zeroCandidate.v.id, source: zeroCandidate.source })
    else fail('T02', 'No-stock known SKU incorrectly entered catalog resolver', { review: r, linked, expected: zeroCandidate.v.id })
  } else skip('T02', 'No catalog variant missing/zero in either stock source')

  // T03 — completely new product name.
  const unknownName = `АВТОТЕСТНОВЫЙ${RUN_TAG}`
  {
    const t = await createTestOrder('T03', variantItem(safeVariant, 'warehouse', { productName: unknownName }))
    const r = await review(t.orderId)
    const item = r.items?.[0]
    if (!item) fail('T03', 'Unknown product was silently accepted without resolver', { review: r })
    else {
      const ctx = await context(t.orderId, item.orderItemId)
      const { question } = questionFor(item, ctx)
      const adminAttempt = await post(`/api/orders/${t.orderId}/catalog-review/${item.orderItemId}/resolve-facts`, {
        ...canonicalFacts(safeVariant), createProduct: true, productName: unknownName, genderScope: productById(catalog, safeVariant.productId)?.genderScope || 'unisex',
      })
      if (!ctx.product && question?.kind === 'product' && adminAttempt.status === 403) pass('T03', 'New product stays human/admin-only; manager cannot silently create it', { question, adminStatus: adminAttempt.status })
      else fail('T03', 'Unknown product resolver boundary is wrong', { contextProduct: ctx.product, question, adminStatus: adminAttempt.status, adminBody: adminAttempt.data })
    }
  }

  // T04 — known product buried in garbage name should surface as suggestion, not auto-assert.
  const garbageKnownName = `${safeVariant.productName} АВТОТЕСТ${RUN_TAG}`
  {
    const t = await createTestOrder('T04', variantItem(safeVariant, 'warehouse', { productName: garbageKnownName }))
    const r = await review(t.orderId)
    const item = r.items?.[0]
    if (!item) fail('T04', 'Garbage-name product was silently accepted', { review: r })
    else {
      const ctx = await context(t.orderId, item.orderItemId)
      const ranked = rankedProducts(ctx.products || [], garbageKnownName)
      const top = ranked[0]
      const { question } = questionFor(item, ctx)
      if (question?.kind === 'product' && Number(top?.product?.id) === Number(safeVariant.productId) && Number(top?.score || 0) > 0) pass('T04', 'Garbage name asks for product and ranks the known product first', { top: top?.product?.name, score: top?.score })
      else fail('T04', 'Garbage-name suggestion behavior is wrong', { question, top })
    }
  }

  // T05 — full fact confirmation must teach an unknown raw product name.
  const learnedProductRaw = `АВТОТЕСТАЛИАС${RUN_TAG}`
  {
    const first = await createTestOrder('T05A', variantItem(safeVariant, 'warehouse', { productName: learnedProductRaw }))
    const r1 = await review(first.orderId)
    const item1 = r1.items?.[0]
    if (!item1) fail('T05', 'Precondition failed: unknown alias did not enter resolver')
    else {
      const resolved = await post(`/api/orders/${first.orderId}/catalog-review/${item1.orderItemId}/resolve-facts`, canonicalFacts(safeVariant))
      const second = await createTestOrder('T05B', variantItem(safeVariant, 'warehouse', { productName: learnedProductRaw }))
      const r2 = await review(second.orderId)
      if (resolved.ok && r2.count === 0) pass('T05', 'Previously unknown product is remembered after full fact confirmation', { resolved: resolved.data })
      else fail('T05', 'Confirmed product alias was not remembered', { resolveStatus: resolved.status, resolveBody: resolved.data, secondReview: r2 })
    }
  }

  // T06 — selecting an existing SKU should ideally also prevent the same raw product question next time.
  const existingPickRaw = `АВТОТЕСТВЫБОР${RUN_TAG}`
  {
    const first = await createTestOrder('T06A', variantItem(safeVariant, 'warehouse', { productName: existingPickRaw }))
    const r1 = await review(first.orderId)
    const item1 = r1.items?.[0]
    if (!item1) fail('T06', 'Precondition failed: unknown existing-pick name did not enter resolver')
    else {
      const resolved = await post(`/api/orders/${first.orderId}/catalog-review/${item1.orderItemId}/resolve-existing`, { variantId: safeVariant.id })
      const second = await createTestOrder('T06B', variantItem(safeVariant, 'warehouse', { productName: existingPickRaw }))
      const r2 = await review(second.orderId)
      if (resolved.ok && r2.count === 0) pass('T06', 'Existing-SKU confirmation is remembered for later identical raw input')
      else fail('T06', 'Existing-SKU confirmation did not teach the raw product name; resolver asks again', { resolveStatus: resolved.status, secondReview: r2 })
    }
  }

  // T07 — genuinely new characteristic value: reference question + manager cannot create dictionary value.
  const newMaterialRaw = `АВТОТЕСТНОВМАТ${RUN_TAG}`
  {
    const t = await createTestOrder('T07', variantItem(safeVariant, 'warehouse', { material: newMaterialRaw }))
    const r = await review(t.orderId)
    const item = r.items?.[0]
    if (!item) fail('T07', 'Unknown material was silently accepted')
    else {
      const ctx = await context(t.orderId, item.orderItemId)
      const { draft, question } = questionFor(item, ctx)
      const adminAttempt = await post(`/api/orders/${t.orderId}/catalog-review/${item.orderItemId}/resolve-facts`, {
        ...canonicalFacts(safeVariant), material: newMaterialRaw, createFields: ['material'],
      })
      if (question?.kind === 'reference' && question.field === 'material' && needsReference(ctx, draft, 'material') && adminAttempt.status === 403) pass('T07', 'Unknown characteristic is explicit reference question and cannot be manager-created', { question, adminStatus: adminAttempt.status })
      else fail('T07', 'Unknown characteristic handling is wrong', { question, needsReference: needsReference(ctx, draft, 'material'), adminStatus: adminAttempt.status, adminBody: adminAttempt.data })
    }
  }

  // T08 — wrong/raw characteristic spelling should become learned alias after confirmation.
  const learnedMaterialRaw = `АВТОТЕСТМАТ${RUN_TAG}`
  {
    const first = await createTestOrder('T08A', variantItem(safeVariant, 'warehouse', { productName: learnedProductRaw, material: learnedMaterialRaw }))
    const r1 = await review(first.orderId)
    const item1 = r1.items?.[0]
    if (!item1) fail('T08', 'Precondition failed: bad material did not enter resolver')
    else {
      const ctx1 = await context(first.orderId, item1.orderItemId)
      const q1 = questionFor(item1, ctx1).question
      const resolved = await post(`/api/orders/${first.orderId}/catalog-review/${item1.orderItemId}/resolve-facts`, canonicalFacts(safeVariant))
      const second = await createTestOrder('T08B', variantItem(safeVariant, 'warehouse', { productName: learnedProductRaw, material: learnedMaterialRaw }))
      const r2 = await review(second.orderId)
      if (q1?.kind === 'reference' && q1.field === 'material' && resolved.ok && r2.count === 0) pass('T08', 'Confirmed bad characteristic spelling is remembered as alias', { firstQuestion: q1 })
      else fail('T08', 'Characteristic alias did not learn/reuse cleanly', { firstQuestion: q1, resolveStatus: resolved.status, secondReview: r2 })
    }
  }

  // T09 — unisex product with blank gender must ask.
  const unisexProduct = products.find(p => p.genderScope === 'unisex' && variants.some(v => Number(v.productId) === Number(p.id) && ['ЖЕН','МУЖ'].includes(norm(v.gender))))
  const unisexVariant = unisexProduct && variants.find(v => Number(v.productId) === Number(unisexProduct.id) && ['ЖЕН','МУЖ'].includes(norm(v.gender)))
  if (unisexVariant) {
    const t = await createTestOrder('T09', variantItem(unisexVariant, 'warehouse', { gender: '' }))
    const r = await review(t.orderId)
    const item = r.items?.[0]
    if (!item) fail('T09', 'Blank gender on unisex product was guessed')
    else {
      const ctx = await context(t.orderId, item.orderItemId)
      const q = questionFor(item, ctx).question
      if (q?.kind === 'field' && q.field === 'gender') pass('T09', 'Unisex blank gender asks one gender question', { product: unisexVariant.productName })
      else fail('T09', 'Unisex blank gender asks wrong/no question', { question: q, context: ctx })
    }
  } else skip('T09', 'No suitable unisex product fixture')

  // T10 — fixed-gender product with blank gender should infer gender.
  const fixedProduct = products.find(p => ['female','male'].includes(p.genderScope) && variants.some(v => Number(v.productId) === Number(p.id)))
  const fixedVariant = fixedProduct && variants.find(v => Number(v.productId) === Number(fixedProduct.id))
  if (fixedVariant) {
    const t = await createTestOrder('T10', variantItem(fixedVariant, 'warehouse', { gender: '' }))
    const r = await review(t.orderId)
    if (r.count === 0) pass('T10', 'Fixed-gender product inferred missing gender without resolver', { product: fixedVariant.productName, genderScope: fixedProduct.genderScope })
    else fail('T10', 'Fixed-gender product unnecessarily asks for gender', { review: r, product: fixedVariant.productName, genderScope: fixedProduct.genderScope })
  } else skip('T10', 'No fixed-gender product fixture')

  // T11 — blank color/size with concrete sibling variants must remain unresolved.
  let ambiguous = null
  for (const p of products) {
    const pv = variants.filter(v => Number(v.productId) === Number(p.id))
    for (const a of pv) for (const b of pv) {
      if (a.id === b.id) continue
      const sameBase = norm(a.gender) === norm(b.gender) && norm(a.material) === norm(b.material) && norm(a.length) === norm(b.length) && String(a.productCategory) === String(b.productCategory)
      const differs = norm(a.color) !== norm(b.color) || norm(a.sizeLabel) !== norm(b.sizeLabel)
      if (sameBase && differs) { ambiguous = a; break }
    }
    if (ambiguous) break
  }
  if (ambiguous) {
    const t = await createTestOrder('T11', variantItem(ambiguous, 'warehouse', { color: '', size: '' }))
    const r = await review(t.orderId)
    const item = r.items?.[0]
    if (!item) fail('T11', 'Blank color/size silently selected a concrete sibling SKU')
    else {
      const ctx = await context(t.orderId, item.orderItemId)
      const q = questionFor(item, ctx).question
      if (q?.kind === 'field' || q?.kind === 'combined') pass('T11', 'Blank ambiguous color/size remains human-visible', { question: q, product: ambiguous.productName })
      else fail('T11', 'Blank ambiguous color/size reached unexpected resolver state', { question: q, context: ctx })
    }
  } else skip('T11', 'No sibling-variant ambiguity fixture found')

  // T12 — identical ambiguous lines: human answer must stay scoped to one order line.
  const scopedRaw = `АВТОТЕСТСКОУП${RUN_TAG}`
  {
    const item = variantItem(safeVariant, 'warehouse', { productName: scopedRaw })
    const t = await createTestOrder('T12', [item, { ...item }])
    const before = await review(t.orderId)
    const sample = before.items?.[0]
    if (!sample || Number(before.affectedItems || 0) < 2) fail('T12', 'Precondition failed: two ambiguous lines were not grouped as affected items', { before })
    else {
      const resolved = await post(`/api/orders/${t.orderId}/catalog-review/${sample.orderItemId}/resolve-existing`, { variantId: safeVariant.id })
      const after = await review(t.orderId)
      if (resolved.ok && Number(after.affectedItems || 0) === 1) pass('T12', 'Human existing-SKU choice affected only one identical-looking order line', { beforeAffected: before.affectedItems, afterAffected: after.affectedItems })
      else fail('T12', 'Human answer leaked to sibling line or did not resolve selected line', { resolveStatus: resolved.status, before, after })
    }
  }

  // T13 — canonical linked identity must outrank raw snapshot after manual existing-SKU confirmation.
  const canonicalRaw = `АВТОТЕСТКАНОН${RUN_TAG}`
  {
    const t = await createTestOrder('T13', variantItem(safeVariant, 'warehouse', { productName: canonicalRaw }))
    const r = await review(t.orderId)
    const item = r.items?.[0]
    if (!item) fail('T13', 'Precondition failed: canonical raw name did not enter resolver')
    else {
      const resolved = await post(`/api/orders/${t.orderId}/catalog-review/${item.orderItemId}/resolve-existing`, { variantId: safeVariant.id })
      const order = (await must(`/api/orders/${t.orderId}`)).order
      const projected = order.items?.find(x => Number(x.id) === Number(item.orderItemId))
      const after = await review(t.orderId)
      if (resolved.ok && Number(projected?.variantId || 0) === Number(safeVariant.id) && norm(projected?.productName) === norm(safeVariant.productName) && after.count === 0) pass('T13', 'Canonical linked SKU outranks stale raw product snapshot', { projectedProduct: projected?.productName })
      else fail('T13', 'Canonical linked identity did not dominate stale snapshot', { resolveStatus: resolved.status, projected, after })
    }
  }
} finally {
  for (const orderId of [...createdOrderIds].reverse()) {
    try { await cleanupOrder(orderId) } catch (e) { cleanupErrors.push(String(e?.message || e)) }
  }
}

console.log('\n=== BRANCH2 RESOLVER E2E SUMMARY ===')
for (const row of results) console.log(JSON.stringify(row))
if (cleanupErrors.length) console.log('Cleanup warnings:', cleanupErrors)
const failures = results.filter(r => r.status === 'FAIL')
console.log(`TOTAL=${results.length} PASS=${results.filter(r=>r.status==='PASS').length} FAIL=${failures.length} SKIP=${results.filter(r=>r.status==='SKIP').length}`)
if (failures.length) process.exitCode = 1

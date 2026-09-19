import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flowSource = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const modal = fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const catalog = fs.readFileSync('worker/domains/catalog.ts', 'utf8')
const review = fs.readFileSync('worker/domains/catalog-review.ts', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')

const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module })
const { createResolutionSession, initialDraft, nextQuestion, compoundRemainder, needsReference } = module.exports

const readyContext = (overrides = {}) => ({
  product: { id: 10, name: 'КАРДИГАН', genderScope: 'unisex' },
  facts: { category: 'adult', gender: 'ЖЕН', material: 'ВЕЛЮР', length: 'СТАНДАРТ', color: 'ЧЕРНЫЙ', size: '46' },
  references: { materials: ['ВЕЛЮР'], lengths: ['СТАНДАРТ'], colors: ['ЧЕРНЫЙ'], sizes: ['46'], childAges: [] },
  unknownFields: [],
  exactVariant: { id: 101, facts: { category: 'adult', gender: 'ЖЕН', material: 'ВЕЛЮР', length: 'СТАНДАРТ', color: 'ЧЕРНЫЙ', size: '46' } },
  isWorkshop: false,
  ...overrides,
})
const options = (overrides = {}) => ({ remainder: '', classified: false, confirmed: {}, legacy: false, editing: null, ...overrides })

// 1. Two orders in sequence without refresh: a completed latch must never leak into the next order.
let aWrites = 0, aDone = 0, bWrites = 0, bDone = 0
const sessionA = createResolutionSession()
await sessionA.run(async () => { aWrites++ }, async () => true, async () => { aDone++; return true })
const sessionB = createResolutionSession()
await sessionB.run(async () => { bWrites++ }, async () => true, async () => { bDone++; return true })
assert.deepEqual([aWrites, aDone, bWrites, bDone], [1, 1, 1, 1], 'R10.1: second order inherited previous resolver latch')
assert.ok(modal.includes("return () => { generation.current++; session.current = createResolutionSession() }") && modal.includes("}, [order?.id])"), 'R10.1: modal no longer resets resolver ownership per order')

// 2. Canonical gender already known: no gender question may be shown.
const canonicalContext = readyContext()
const canonicalDraft = initialDraft({ productName: 'КАРДИГАН', color: 'ЧЕРНЫЙ', size: '46' }, canonicalContext)
const canonicalQuestion = nextQuestion(canonicalContext, canonicalDraft, options())
assert.equal(canonicalDraft.gender, 'ЖЕН', 'R10.2: canonical gender was not hydrated into resolver draft')
assert.notDeepEqual(canonicalQuestion, { kind: 'field', field: 'gender' }, 'R10.2: resolver asks gender that is already canonical')
assert.ok(review.includes("gender_snapshot: cleanText(linked.gender)"), 'R10.2: linked SKU canonical gender hydration disappeared')

// 3. Explicit gender + known references + missing exact combination: deterministic auto-create, physical=0, reserve separately.
assert.ok(reservations.includes('const enteredGender = normalizeCatalogCombinationGender(item.gender)') && reservations.includes('let gender = enteredGender'), 'R10.3: explicit manager gender no longer leads deterministic resolution')
assert.ok(reservations.includes("!await catalogReferenceDbValueExists(db, 'material', material)") && reservations.includes("!await catalogReferenceValueExists(db, 'color', color)"), 'R10.3: known-reference validation before auto-create disappeared')
assert.ok(reservations.includes('const created = await createCatalogCombinationV3(db, {') && reservations.includes("matchStatus: created.created ? 'created_combination' : 'matched'"), 'R10.3: safe missing combination no longer auto-creates')
assert.ok(reservations.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)'), 'R10.3: auto-created stock no longer starts at physical=0/reserved=0')
assert.ok(reservations.includes('reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) + ?)'), 'R10.3: reservation is no longer separate from physical stock')

// 4. Blank gender on unisex product: ask gender.
const blankGenderContext = readyContext({
  facts: { category: 'adult', gender: '', material: 'ВЕЛЮР', length: 'СТАНДАРТ', color: 'ЧЕРНЫЙ', size: '46' },
  exactVariant: null,
})
const blankGenderDraft = initialDraft({ productName: 'КАРДИГАН', color: 'ЧЕРНЫЙ', size: '46' }, blankGenderContext)
assert.deepEqual(nextQuestion(blankGenderContext, blankGenderDraft, options()), { kind: 'field', field: 'gender' }, 'R10.4: blank unisex gender is being guessed or skipped')

// 5. Two legitimate genders: server must not infer one for unisex scope.
assert.ok(catalog.includes("return scope === 'female' ? 'ЖЕН' : scope === 'male' ? 'МУЖ' : ''"), 'R10.5: unisex gender scope can again synthesize a gender')
assert.ok(reservations.includes('gender = catalogGenderForProductScope(productGenderScope)') && reservations.includes("matchStatus: 'unresolved_attribute'"), 'R10.5: ambiguous gender no longer remains unresolved')

// 6. Blank color/size with concrete siblings: never silently create/select placeholder SKU.
assert.ok(reservations.includes('omittedColorConflictsWithConcreteSibling') && reservations.includes('omittedSizeConflictsWithConcreteSibling'), 'R10.6: concrete sibling conflict guards disappeared')
assert.ok(reservations.includes("if (!rawColor || !rawSize)") && reservations.includes("matchStatus: 'unresolved_attribute'"), 'R10.6: blank color/size can again silently create a placeholder combination')

// 7. Unknown reference value: human only when no exact canonical variant proves the answer.
const unknownRefContext = readyContext({
  exactVariant: null,
  references: { materials: ['ВЕЛЮР'], lengths: ['СТАНДАРТ'], colors: ['ЧЕРНЫЙ'], sizes: ['46'], childAges: [] },
})
const unknownRefDraft = { ...initialDraft({ productName: 'КАРДИГАН', color: 'ЧЕРНЫЙ', size: '46' }, unknownRefContext), material: 'ВЕЛЮРР' }
assert.equal(needsReference(unknownRefContext, unknownRefDraft, 'material'), true, 'R10.7: unknown material is not recognized as a new reference')
assert.deepEqual(nextQuestion(unknownRefContext, unknownRefDraft, options()), { kind: 'reference', field: 'material' }, 'R10.7: genuinely unknown reference does not ask human')
const provenRefContext = { ...unknownRefContext, exactVariant: readyContext().exactVariant }
assert.equal(nextQuestion(provenRefContext, unknownRefDraft, options()).kind, 'ready', 'R10.7: exact canonical variant still triggers unnecessary reference question')

// 8. Compound name: ДУБАЙСКИЙ ВЕЛЮР — ДВОЙКА must leave reusable residue for classification.
const compoundContext = readyContext({ product: { id: 20, name: 'ДВОЙКА', genderScope: 'unisex' }, exactVariant: null })
const compoundDraft = { ...initialDraft({ productName: 'ДУБАЙСКИЙ ВЕЛЮР — ДВОЙКА', color: 'ЧЕРНЫЙ', size: '46' }, compoundContext), productId: 20 }
const remainder = compoundRemainder('ДУБАЙСКИЙ ВЕЛЮР — ДВОЙКА', 'ДВОЙКА')
assert.equal(remainder, 'ДУБАЙСКИЙ ВЕЛЮР', 'R10.8: compound residue extraction regressed')
assert.equal(nextQuestion(compoundContext, compoundDraft, options({ remainder })).kind, 'compound', 'R10.8: compound residue is silently asserted instead of classified')

// 9. Repeat same SKU: duplicate combination must not be created.
const createStart = catalog.indexOf('export async function createCatalogCombinationV3')
const createEnd = catalog.indexOf('export async function catalogVariantHasOperationalUsage', createStart)
assert.ok(createStart >= 0 && createEnd > createStart, 'R10.9: createCatalogCombinationV3 missing')
const createCombination = catalog.slice(createStart, createEnd)
assert.ok(createCombination.includes('const duplicate = await findCatalogCombinationV3') && createCombination.includes('if (duplicate?.id) return { id: toInt(duplicate.id, 0), created: false }'), 'R10.9: exact duplicate is not checked before insert')
assert.ok(createCombination.includes('const existing = await findCatalogCombinationV3') && createCombination.includes('created: false'), 'R10.9: concurrent duplicate insert is not re-read safely')

// 10. Manager -> Admin login -> same resolver session.
assert.ok(modal.includes('onRequestAdminMode?: () => void') && app.includes('onRequestAdminMode={() => setAdminModeOpen(true)}'), 'R10.10: resolver no longer opens Admin in place')
assert.ok(app.includes('После входа вы вернётесь к уточнению этого заказа.') && app.includes('setSimpleAdminMode(true)') && app.includes('setAdminModeOpen(false)'), 'R10.10: Admin login no longer resumes same resolver context')

// 11. Double-click / lost response / replay: one resolver write and one physical shipping winner.
let releaseFirst
const clickSession = createResolutionSession()
let clickWrites = 0
const first = clickSession.run(async () => {
  clickWrites++
  await new Promise(resolve => { releaseFirst = resolve })
}, async () => true, async () => true)
const second = clickSession.run(async () => { clickWrites++ }, async () => true, async () => true)
await Promise.resolve()
assert.equal(clickWrites, 1, 'R10.11: double-click entered resolver mutation twice')
releaseFirst()
await Promise.all([first, second])
const shippingStart = worker.indexOf("const orderShippingMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping$/)")
const shippingEnd = worker.indexOf('const orderDeleteMatch', shippingStart)
const shipping = worker.slice(shippingStart, shippingEnd)
assert.ok(shipping.includes("normalizeShippingStatus(existing.shipping_status) === 'sent'") && shipping.includes('alreadySent: true'), 'R10.11: lost-response retry is not accepted as already-sent success')
assert.ok(shipping.includes("...(!shippingCommitted ? { alreadySent: true } : {})"), 'R10.11: overlapping losing replay is not a safe no-op')
const fulfillStart = reservations.indexOf('export async function fulfillOrderReservationsV2')
const fulfillEnd = reservations.indexOf('export async function getOrderShipmentInventoryBlockers', fulfillStart)
const fulfill = reservations.slice(fulfillStart, fulfillEnd)
assert.ok((fulfill.match(/\$\{orderStillUnsentSql\}/g) || []).length >= 8 && fulfill.includes('shippingStatementIndex = statements.length'), 'R10.11: physical shipping mutations are not tied to one atomic CAS winner')

// 12. After resolution: continue exactly the original shipping action automatically.
const completionStart = app.indexOf('onCompleted={async (resolvedOrder: OrderRecord) => {')
const completionEnd = app.indexOf('        }}', completionStart)
const completion = app.slice(completionStart, completionEnd)
const freshIndex = completion.indexOf("apiFetch(\`/api/orders/\${resolvedOrder.id}\`, { cache: 'no-store' })")
const sendIndex = completion.indexOf('await markOrderSentToClient(freshResult.order)')
const closeIndex = completion.indexOf('setOrderCatalogResolutionOrder(null)')
assert.ok(freshIndex >= 0 && sendIndex > freshIndex && closeIndex > sendIndex, 'R10.12: resolver completion no longer follows fresh-order -> original send -> proven close')
assert.ok(!completion.includes("setActiveSector('inventory')") && !completion.includes('openInventoryPanel('), 'R10.12: successful resolver completion still detours to Warehouse')
assert.ok(worker.indexOf('await reconcileCatalogReviewOrder(env.DB, id)') < worker.indexOf("code: 'catalog_review_required'"), 'R10.12: original shipping route no longer auto-reconciles before human block')

console.log('CATALOG RESOLVER R10 ACCEPTANCE MATRIX PASSED — all 12 resolver acceptance cases are protected by executable logic/static contracts.')

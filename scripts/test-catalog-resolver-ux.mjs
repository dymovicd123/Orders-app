import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { DatabaseSync } from 'node:sqlite'

const source = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module })
const { initialDraft, nextQuestion, compoundRemainder, rankedProducts, createResolutionSession } = module.exports
const facts = { material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', gender: 'МУЖ', color: 'БЕЗ ЦВЕТА', size: '' }
const context = { ok: true, product: { id: 1, name: 'ДОКЕР', genderScope: 'male' }, facts, exactVariant: { id: 7, productId: 1, productName: 'ДОКЕР', facts }, references: { materials: ['СТАНДАРТ'], lengths: ['СТАНДАРТ'], colors: ['БЕЗ ЦВЕТА'], sizes: [], childAges: [] } }
const options = { remainder: '', classified: false, confirmed: {}, legacy: false }
const ask = (c, d, o = {}) => nextQuestion(c, d, { ...options, ...o })
const draft = initialDraft({ productName: 'ДОКЕР', color: '', size: '' }, context)
assert.equal(draft.color, '')
assert.equal(draft.size, '')
assert.equal(ask(context, draft).kind, 'combined', 'A: one combined human confirmation, not two placeholder defaults')
const confirmed = { ...draft, color: 'БЕЗ ЦВЕТА', size: 'БЕЗ РАЗМЕРА' }
assert.equal(ask(context, confirmed).kind, 'ready')
for (const name of ['ДУБАЙСКИЙ ВЕЛЮР — ДВОЙКА', 'ДВОЙКА ДУБАЙСКИЙ ВЕЛЮР', 'ДУБАЙСКИЙ ВЕЛЮР ДВОЙКА']) assert.equal(compoundRemainder(name, 'ДВОЙКА'), 'ДУБАЙСКИЙ ВЕЛЮР')
assert.equal(compoundRemainder('НОВАЯ ТКАНЬ — КУРТКА', 'КУРТКА'), 'НОВАЯ ТКАНЬ', 'generic, not production names')
const ambiguous = { ...context, exactVariant: null }
assert.equal(ask(ambiguous, draft, { remainder: 'НОВАЯ ТКАНЬ' }).kind, 'compound')
const materialDraft = { ...draft, material: 'НОВАЯ ТКАНЬ' }
assert.equal(ask(ambiguous, materialDraft, { remainder: 'НОВАЯ ТКАНЬ', classified: true, confirmed: { material: true } }).kind, 'reference')
assert.equal(ask(ambiguous, { ...materialDraft, createFields: ['material'] }, { classified: true }).field, 'color')
assert.equal(ask(context, initialDraft({ productName: 'ДОКЕР', color: 'БЕЗ ЦВЕТА', size: 'БЕЗ РАЗМЕРА' }, context)).kind, 'ready', 'C: clean exact match')
const unknownGender = { ...confirmed, gender: '' }
assert.equal(ask(ambiguous, unknownGender).field, 'gender')
assert.equal(ask(ambiguous, unknownGender, { legacy: true }).kind, 'legacy')
assert.equal(unknownGender.gender, '', 'D: unknown is never unisex')
assert.equal(ask(context, { ...draft, productId: 0 }).kind, 'product', 'E')
assert.equal(rankedProducts([{ id: 2, name: 'КУРТКА' }, { id: 3, name: 'ЮБКА' }], 'ТКАНЬ КУРТКА')[0].product.id, 2)
assert.equal(rankedProducts([{ id: 4, name: 'ШАПАН' }, { id: 5, name: 'ЮБКА' }], 'ШОПАН')[0].product.id, 4, 'E: one-character typo is suggested, never auto-selected')
assert.ok(rankedProducts([{ id: 4, name: 'ШАПАН' }], 'ШОПАН')[0].score > 0, 'E: typo suggestion must be visible')
assert.equal(ask({ ...context, isWorkshop: true }, { ...draft, gender: '', material: '', length: '' }).kind, 'workshop', 'F: no stock questions')
let writes = 0, resumed = 0, remaining = 2
const session = createResolutionSession()
const write = async () => { writes++; remaining-- }
const recheck = async () => remaining === 0
const complete = async () => { resumed++ }
await session.run(null, async () => true, complete)
assert.equal(resumed, 0, 'empty initial load cannot resume shipping')
await Promise.all([session.run(write, recheck, complete), session.run(write, recheck, complete)])
assert.equal(writes, 1); assert.equal(resumed, 0, 'G: first line must not close')
await session.run(write, recheck, complete)
await session.run(write, recheck, complete)
assert.equal(writes, 2); assert.equal(resumed, 1, 'last line resumes exactly once')
const failedRecheck = createResolutionSession()
await assert.rejects(failedRecheck.run(async () => { writes++ }, async () => { throw Error('network') }, complete))
await failedRecheck.run(null, async () => true, complete)
assert.equal(writes, 3, 'retry recheck must not replay successful mutation')
assert.equal(resumed, 2)
const modal = fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx', 'utf8')
assert.ok(modal.includes('createResolutionSession'))
assert.ok(!modal.includes('setAdvancedOpen(!contextData.existingVariantId)'))
assert.ok(modal.includes("purpose === 'intake' ? 'В возврате записано' : 'В заказе записано'"))
assert.ok(modal.includes('Нужного товара нет в каталоге'))
assert.ok(modal.includes('Расширенное исправление'))
assert.ok(modal.includes('Выбрать существующее значение'))
assert.ok(modal.includes('Это действительно новое значение'))
const app = fs.readFileSync('src/App.tsx', 'utf8')
const completion = app.split('onCompleted={async (resolvedOrder: OrderRecord) => {')[1].split('}}')[0]
assert.ok(completion.includes('await markOrderSentToClient(freshResult.order)'))
assert.ok(!completion.includes('ещё раз'))
// Run the actual component and its event handlers with deterministic hook scheduling.
const require = createRequire(import.meta.url)
function mount(respond, admin = true) {
  const slots = [], deps = [], effects = [], cleanups = []
  let cursor = 0, dirty = true, tree, completed = 0
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true }] },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useEffect(fn, next) { const i = cursor++; if (!deps[i] || next.some((v, n) => v !== deps[i][n])) { deps[i] = next; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn() }) } },
  }
  const componentModule = { exports: {} }
  const requests = []
  const fetcher = async (path, init) => { requests.push({ path, init }); return await respond(path, init, requests) }
  const sandboxRequire = id => id === 'react' ? hooks : id === './catalogResolutionFlow' ? module.exports : id.endsWith('.css') ? {} : id === '../../app/utils' ? { readJsonResponse: async response => { const data = JSON.parse(await response.text()); if (!response.ok) throw Error(data.message || 'Ошибка'); return data } } : require(id)
  vm.runInNewContext(ts.transpileModule(modal, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: componentModule, exports: componentModule.exports, require: sandboxRequire, URLSearchParams, document: {} })
  const props = { order: { id: 12, external_id: 'TEST' }, apiFetch: fetcher, isAdmin: admin, onClose() {}, onCompleted: async () => { completed++ } }
  const render = () => { cursor = 0; dirty = false; tree = componentModule.exports.OrderCatalogResolutionModal(props); for (const effect of effects.splice(0)) effect() }
  const flush = async () => { for (let i = 0; i < 45; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)) } }
  const nodes = (node = tree, result = []) => { if (Array.isArray(node)) node.forEach(n => nodes(n, result)); else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result) } return result }
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node)
  const button = name => { const found = nodes().find(node => node.type === 'button' && text(node) === name); assert.ok(found, `button missing: ${name}\n${text(tree)}`); assert.ok(!found.props.disabled); return found }
  return { flush, requests, button, click: async name => { button(name).props.onClick(); await flush() }, text: () => text(tree), html: () => renderToStaticMarkup(tree), count: type => nodes().filter(n => n.type === type).length, completed: () => completed, unmount: () => cleanups.forEach(fn => fn?.()), nodes }
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const sourceItem = { orderItemId: 1, productName: 'ДОКЕР', color: '', size: '', material: 'СТАНДАРТ', length: 'СТАНДАРТ', gender: 'МУЖ', category: 'adult' }
const resolveFixture = (sourceRows = [sourceItem], initialContext = context, options = {}) => {
  let rows = structuredClone(sourceRows), written = 0
  return async (path, init) => {
    if (init?.method === 'POST') { written++; rows.shift(); return json({ ok: true }) }
    if (path === '/api/catalog') return json({ ok: true, products: [{ ...context.product, isActive: true }], variants: [] })
    if (path.includes('/context?')) {
      const url = new URL(path, 'http://fixture'), data = structuredClone(initialContext)
      if (url.searchParams.has('material')) {
        for (const f of fieldsForFixture) data.facts[f] = url.searchParams.get(f) || ''
        data.exactVariant = options.alwaysExact ? data.exactVariant : null
      }
      return json(data)
    }
    if (written && options.badRecheck) return json({ ok: true })
    return json({ ok: true, count: rows.length, items: rows })
  }
}
const fieldsForFixture = ['category', 'gender', 'material', 'length', 'color', 'size']
const a = mount(resolveFixture())
await a.flush()
assert.ok(a.text().includes('Этот товар действительно без цвета и без размера?'))
assert.equal(a.count('h4'), 1)
assert.ok(!a.text().includes('Расширенное исправление'))
assert.ok(!a.requests.some(r => r.path === '/api/catalog'))
const yes = a.button('Да, всё верно'); yes.props.onClick(); yes.props.onClick(); await a.flush()
assert.equal(a.requests.filter(r => r.init?.method === 'POST').length, 1)
assert.equal(a.completed(), 1)
const cleanItem = { ...sourceItem, color: 'БЕЗ ЦВЕТА', size: 'БЕЗ РАЗМЕРА' }
const c = mount(resolveFixture([cleanItem]))
await c.flush(); assert.equal(c.count('h4'), 1); await c.click('Подтвердить товар'); assert.equal(c.completed(), 1)
const two = mount(resolveFixture([sourceItem, { ...cleanItem, orderItemId: 2 }]))
await two.flush(); await two.click('Да, всё верно'); assert.equal(two.completed(), 0); assert.ok(two.text().includes('Товар 2 из 2'))
await two.click('Подтвердить товар'); assert.equal(two.completed(), 1)
const bad = mount(resolveFixture([sourceItem], context, { badRecheck: true }))
await bad.flush(); await bad.click('Да, всё верно'); assert.equal(bad.completed(), 0); assert.ok(bad.text().includes('Список позиций не подтверждён'))
await bad.click('Проверить оставшиеся позиции'); assert.equal(bad.requests.filter(r => r.init?.method === 'POST').length, 1)
const empty = mount(async () => json({ ok: true, count: 0, items: [] }))
await empty.flush(); assert.equal(empty.completed(), 0); assert.ok(empty.text().includes('Отправка не продолжена'))
const compoundContext = { ...ambiguous, product: { id: 3, name: 'ДВОЙКА', genderScope: 'unisex' }, canLeaveGenderUnknown: true, facts: { ...facts, gender: '' } }
const b = mount(resolveFixture([{ ...sourceItem, productName: 'ДУБАЙСКИЙ ВЕЛЮР — ДВОЙКА', gender: '' }], compoundContext))
await b.flush(); assert.ok(b.text().includes('Что означает часть названия')); await b.click('Материал')
assert.ok(b.text().includes('Материал: ДУБАЙСКИЙ ВЕЛЮР ✓'))
assert.ok(b.text().includes('Уточните: материал')); assert.ok(b.text().includes('Выберите существующее значение')); assert.equal(b.count('h4'), 1)
assert.ok(b.button('Выбрать существующее значение')); await b.click('Это действительно новое значение'); assert.ok(b.text().includes('Не указан пол'))
assert.ok(!b.text().includes('В заказе записано'))
assert.ok(!b.text().includes('Материал:'))
assert.ok(!b.text().includes('Цвет:'))
assert.ok(!b.text().includes('Размер / возраст:'))
assert.ok(!b.text().includes('Нужного товара нет в каталоге'))
assert.ok(!b.text().includes('Расширенное исправление'))
assert.ok(!b.text().includes('Админ'))
await b.click('Не удалось выяснить')
assert.ok(b.text().includes('Не указан цвет'))
assert.ok(!/SKU|legacy_unknown_gender|каноническ|складская комбинация/.test(b.text()))
const manager = mount(resolveFixture([{ ...cleanItem, gender: '' }], compoundContext), false)
await manager.flush(); assert.ok(manager.text().includes('Не указан пол')); assert.ok(!manager.text().includes('Не удалось выяснить')); assert.ok(!manager.text().includes('Расширенное исправление'))
const e = mount(resolveFixture([sourceItem], { ...context, product: null, exactVariant: null, products: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `ДОКЕР ${i}` })) }))
await e.flush(); assert.equal(e.count('select'), 0); assert.ok(e.nodes().filter(n => n.type === 'button' && e.text().includes('ДОКЕР')).length >= 1)
assert.ok(!e.requests.some(r => r.path === '/api/catalog')); await e.click('Нужного товара нет в каталоге')
assert.equal(e.requests.filter(r => r.path === '/api/catalog').length, 1)
const workshop = mount(resolveFixture([{ ...sourceItem, gender: '' }], { ...context, isWorkshop: true, exactVariant: null }))
await workshop.flush(); assert.ok(workshop.text().includes('Подтвердите товар для Цеха')); assert.ok(!workshop.text().includes('Какой здесь пол?')); await workshop.click('Подтвердить товар'); assert.equal(workshop.completed(), 1)
for (const instance of [a, b, c, two, bad, empty, manager, e, workshop]) instance.unmount()
// Actual read function + SQLite: previews must never write or fetch all variants.
const workerText = fs.readFileSync('worker/domains/catalog-review.ts', 'utf8')
const parsed = ts.createSourceFile('review.ts', workerText, ts.ScriptTarget.Latest, true)
const contextFunction = parsed.statements.find(s => s.name?.text === 'getCatalogReviewContext').getText(parsed)
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`CREATE TABLE orders(id INTEGER, external_id TEXT, shipping_status TEXT, shipping_date TEXT, order_status TEXT, archived_at TEXT);
CREATE TABLE order_items(id INTEGER, order_id INTEGER, product_id INTEGER, audience_type TEXT, size_snapshot TEXT, product_name_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, is_workshop INTEGER);
CREATE TABLE catalog_products(id INTEGER, name TEXT, category TEXT, is_active INTEGER);
CREATE TABLE reference_values(kind TEXT, value TEXT, is_active INTEGER, sort_order INTEGER);
CREATE TABLE catalog_stock_positions(id INTEGER, product_id INTEGER, material TEXT, length TEXT, is_active INTEGER);
INSERT INTO orders VALUES(12,'TEST','not_sent','','active','');
INSERT INTO order_items VALUES(1,12,1,'adult','','ДОКЕР','СТАНДАРТ','СТАНДАРТ','МУЖ','',0);
INSERT INTO catalog_products VALUES(1,'ДОКЕР','adult',1);
INSERT INTO catalog_stock_positions VALUES(10,1,'СТАНДАРТ','СТАНДАРТ',1);
INSERT INTO reference_values VALUES('color','БЕЗ ЦВЕТА',1,1);`)
const sqlCalls = []
const db = { prepare(sql) {
  assert.match(sql.trim(), /^SELECT\b/i); sqlCalls.push(sql)
  const stmt = sqlite.prepare(sql); let args = []
  return { bind(...values) { args = values; return this }, async first() { return stmt.get(...args) || null }, async all() { return { results: stmt.all(...args) } } }
} }
const workerModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(contextFunction, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: workerModule, exports: workerModule.exports,
  cleanText: v => String(v ?? '').trim(), upperText: v => String(v ?? '').trim().toUpperCase(), toInt: (v, fallback = 0) => Number(v) || fallback,
  normalizeAudienceCategory: v => v === 'child' ? 'child' : 'adult', canonicalStockPositionValue: v => String(v || 'СТАНДАРТ'),
  resolveCatalogValueAlias: async (_, kind, v) => v, normalizeCatalogCombinationGender: v => v || '', normalizeCatalogCombinationColor: v => v || 'БЕЗ ЦВЕТА', normalizeCatalogCombinationSize: v => v === 'БЕЗ РАЗМЕРА' ? '' : v || '',
  findCatalogProductByIdentity: async () => ({ id: 1, name: 'ДОКЕР', category: 'adult' }), getCatalogProductGenderScope: async () => 'male', catalogGenderForProductScope: scope => scope === 'male' ? 'МУЖ' : '',
  findCatalogExecutionV3: async (_, productId, material, length) => material === 'СТАНДАРТ' && length === 'СТАНДАРТ' ? { id: 10, product_id: productId, material, length } : null,
  findCatalogCombinationV3: async (_, execution, category, gender, color, size) => color === 'БЕЗ ЦВЕТА' && !size ? { id: 7 } : null,
  catalogReferenceDbValueExists: async (_, kind, value) => ['СТАНДАРТ', 'БЕЗ ЦВЕТА', ''].includes(value),
})
const beforeRows = sqlite.prepare('SELECT * FROM order_items').all()
const actual = await workerModule.exports.getCatalogReviewContext(db, 1)
assert.equal(actual.exactVariant.id, 7); assert.equal(actual.exactVariant.facts.color, 'БЕЗ ЦВЕТА')
assert.equal(actual.products.length, 0, 'known products do not fetch product list')
assert.ok(!sqlCalls.some(sql => sql.includes('LIMIT 300')))
const changedContext = await workerModule.exports.getCatalogReviewContext(db, 1, { productId: 1, material: 'НОВАЯ ТКАНЬ', color: 'КРАСНЫЙ', size: 'XL', gender: 'МУЖ' })
assert.equal(changedContext.exactVariant, null); assert.equal(changedContext.facts.material, 'НОВАЯ ТКАНЬ')
assert.equal((await workerModule.exports.getCatalogReviewContext(db, 1, { productId: 0 })).product, null, 'explicit reject must not reselect same product')
assert.deepEqual(sqlite.prepare('SELECT * FROM order_items').all(), beforeRows)
sqlite.close()
console.log('CATALOG RESOLVER UX FOCUSED GREEN — real component A–G, explicit facts, lazy catalog, double-click, fail-closed completion and retry')

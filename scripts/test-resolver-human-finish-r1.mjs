import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flowSource = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const flowModule = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: flowModule, exports: flowModule.exports },
)
const { fieldLabel, rankedReferenceValues, segmentCompoundRemainder } = flowModule.exports

assert.equal(fieldLabel('size', 'adult'), 'Размер', 'adult positions must never be labelled as age')
assert.equal(fieldLabel('size', 'child'), 'Возраст', 'child positions must use age')
assert.equal(fieldLabel('material', 'adult'), 'Материал')

const fuzzyMaterial = rankedReferenceValues(
  ['АТЛАС', 'ЗАМША ВЕЛЮР', 'КОСТЮМНЫЙ МАТЕРИАЛ'],
  'ЗАМША ВЕЛЮРР',
  'material',
)
assert.equal(fuzzyMaterial[0].value, 'ЗАМША ВЕЛЮР', 'obvious material typo should rank the canonical material first')
assert.ok(fuzzyMaterial[0].score >= 5000, 'obvious material typo should be a visible recommendation')

const numericSize = rankedReferenceValues(['46', '48'], '47', 'size')
assert.equal(numericSize[0].score, 0, 'sizes must not use typo distance because neighbouring sizes are distinct real values')
assert.equal(numericSize[1].score, 0, 'sizes must not use typo distance because neighbouring sizes are distinct real values')

const context = {
  references: {
    materials: ['ЗАМША ВЕЛЮР', 'АТЛАС'],
    colors: ['КРАСНЫЙ', 'ИЗУМРУД'],
    lengths: ['СТАНДАРТ', 'ДЛИННЫЙ'],
    sizes: ['42', '44', '46', '48'],
    childAges: ['3', '4', '5'],
  },
}
const draft = { category: 'adult' }

const full = segmentCompoundRemainder('ЗАМША ВЕЛЮР КРАСНЫЙ', context, draft)
assert.equal(full.complete, true)
assert.equal(full.unknown, '')
assert.equal(
  JSON.stringify(full.segments.map(entry => [entry.field, entry.value])),
  JSON.stringify([['material', 'ЗАМША ВЕЛЮР'], ['color', 'КРАСНЫЙ']]),
  'compound material + color must be split instead of becoming one new material',
)

const reverse = segmentCompoundRemainder('КРАСНЫЙ ЗАМША ВЕЛЮР', context, draft)
assert.equal(reverse.complete, true)
assert.equal(
  JSON.stringify(reverse.segments.map(entry => [entry.field, entry.value]).sort()),
  JSON.stringify([['color', 'КРАСНЫЙ'], ['material', 'ЗАМША ВЕЛЮР']].sort()),
  'known segments must be recognized regardless of their order',
)

const partial = segmentCompoundRemainder('ЗАМША ВЕЛЮР ЛЮКС', context, draft)
assert.equal(partial.complete, false)
assert.equal(partial.unknown, 'ЛЮКС')
assert.equal(JSON.stringify(partial.segments.map(entry => [entry.field, entry.value])), JSON.stringify([['material', 'ЗАМША ВЕЛЮР']]))

const modal = fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx', 'utf8')
for (const marker of [
  'Это новый товар',
  'Название нового значения',
  'Добавить и продолжить',
  'Администратор уже добавил — проверить снова',
  'попросите администратора добавить его',
  'Похоже, имелось в виду',
  'resolution-combobox',
  'Ничего из предложенного не подходит',
  'После ответа система проверит остальные позиции и продолжит исходное действие автоматически',
]) assert.ok(modal.includes(marker), `resolver human-finish marker missing: ${marker}`)
assert.ok(!modal.includes('list="resolution-answers"'), 'normal resolver picker must not depend on browser datalist filtering')
assert.ok(modal.includes("fieldLabel(field, draft.category)"), 'dynamic adult/child label must drive visible resolver labels')
assert.ok(modal.includes('segmentCompoundRemainder'), 'compound resolver must use the safe segmenter')

const workshop = fs.readFileSync('src/features/sections/WorkshopSection.tsx', 'utf8')
for (const marker of ['Готово в цехе', 'Цех: готово', "Заказ: {task.shippingStatus === 'sent' ? 'отправлен' : 'не отправлен'}"]) {
  assert.ok(workshop.includes(marker), `Workshop readiness/shipping marker missing: ${marker}`)
}
const app = fs.readFileSync('src/App.tsx', 'utf8')
assert.ok(app.includes('Это не отправка клиенту: заказ остаётся «Не отправлен»'), 'Workshop done action must explicitly say it does not ship the order')
assert.ok(app.includes('Снять ошибочную отметку «Отправлен»'), 'shipping correction wording must describe the actual operation')

const orders = fs.readFileSync('src/features/sections/OrdersTableSection.tsx', 'utf8')
assert.ok(orders.includes('Снять ошибочную отметку «Отправлен»'))
assert.ok(orders.includes('После проведённого обмена текущая физическая история задаётся обменом'))
assert.ok(orders.includes('исправляйте сам обмен, а не исходную отправку'))
assert.ok(orders.includes('После проведённого возврата текущая физическая история уже включает возврат товара'))

const projection = fs.readFileSync('src/app/orderOperationalProjection.ts', 'utf8')
assert.ok(
  projection.includes('canCorrectShipping: mutableWorkingOrder && !hasCommittedDownstreamOperation && sent'),
  'downstream operations must continue blocking false-shipping history rewrite',
)

console.log('RESOLVER HUMAN FINISH R1 GREEN — explicit new values, fuzzy refs, compound segmentation, Workshop clarity and shipping-correction guard')

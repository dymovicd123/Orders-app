import assert from 'node:assert/strict'
import fs from 'node:fs'
import {findCorrectionFocusGroup} from '../src/features/inventory/operationCorrectionFocus.ts'
const read = p => fs.readFileSync(p, 'utf8')
const models=[
 {key:'A',rows:[{variantId:101,productId:11},{variantId:102,productId:11}]},
 {key:'B',rows:[{variantId:201,productId:22},{variantId:202,productId:22}]},
]
assert.equal(findCorrectionFocusGroup(models,{variantId:201,productId:22})?.key,'B')
assert.equal(findCorrectionFocusGroup(models,{variantId:102,productId:11})?.key,'A')
assert.equal(findCorrectionFocusGroup(models,{variantId:201,productId:11}),undefined,
 'Wrong productId cannot open a different product with the same variant ID')
assert.equal(findCorrectionFocusGroup(models,{variantId:0,productId:11}),undefined,
 'Missing ID may not select an arbitrary product')
assert.equal(findCorrectionFocusGroup(models,{variantId:999,productId:0}),undefined)
const overview=read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const attention=read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const section=read('src/features/sections/InventorySection.tsx')
const panel=read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const workspace=read('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx')
const css=read('src/styles/w16-stock-source-attention.css')
assert.ok(overview.includes('Остатки какой точки?'))
assert.ok(overview.includes('aria-pressed={simpleStockSource === entry.value}'))
assert.ok(css.includes('.stock-v16-source-switch button.is-active'))
assert.ok(css.includes('background:#2466ae'))
assert.ok(attention.includes('Корректировать остаток'))
assert.ok(!attention.includes('Посмотреть данные учёта'))
assert.equal(attention.split('>История варианта</button>').length-1,1,
 'Only active shortage retains its context shortcut; old shipment evidence stays in SKU History')
assert.ok(!attention.includes('onClick={() => openAttentionStocktake(item)}'))
assert.ok(attention.includes('openAttentionCorrection(item)'))
assert.ok(section.includes('movementType: \'manual_set\''))
assert.ok(section.includes('variantId: Number(item.variantId)'))
assert.ok(section.includes('setAttentionCorrectionReadyToken(attentionCorrectionTarget.token)'))
assert.ok(section.includes('attentionCorrectionReadyToken === attentionCorrectionTarget?.token'),
 'Do not apply shortcut before fresh source snapshot is ready')
assert.ok(section.includes('items: [createEmptyInventoryItem()]'),
 'A shortcut cannot automatically submit or guess a physical count')
assert.ok(panel.includes('focusVariant={ctx.attentionCorrectionTarget}'))
assert.ok(panel.includes('ctx.clearAttentionCorrectionTarget()'))
assert.ok(workspace.includes('findCorrectionFocusGroup(groups, target)'))
assert.ok(workspace.includes("setStageBySource(old => ({...old, [source]: 'quantities'}))"))
assert.ok(workspace.includes("stateClass={mode==='manual_set'"))
assert.ok(workspace.includes('Введите <b>фактическое количество</b>'))
assert.ok(!attention.includes('saveInventoryMovement('), 'Issue panel is read-only until user enters a count')
console.log('W16 STOCK ACTIONS PASSED: prominent source, one history, correct SKU prefilling, fresh snapshot and no auto quantity')

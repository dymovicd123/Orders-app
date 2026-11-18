import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {normalizeAudienceCategory} from '../worker/core/text.ts'
import {foldSaleName,modelNameTokensMatch} from '../src/features/orders/catalogModelNameSearch.ts'
import {buildOrderShipmentPlan} from '../worker/domains/order-shipment-plan.ts'

assert.equal(normalizeAudienceCategory('ВЗРОСЛЫЙ','2'),'adult','Explicit adult cannot silently turn child')
assert.equal(normalizeAudienceCategory('adult','2'),'adult')
assert.equal(normalizeAudienceCategory('ДЕТСКИЙ','52'),'child','Explicit child cannot turn adult')
assert.equal(normalizeAudienceCategory('child','2'),'child')
assert.equal(normalizeAudienceCategory('', '2'),'child','Old unlabeled age still infers child')
assert.equal(normalizeAudienceCategory('', '52'),'adult')
assert.equal(normalizeAudienceCategory('ВЗРОСЛЫЙ','БЕЗ РАЗМЕРА'),'adult')
const name='QA RESOLVER 1811 КОСМЕТИЧКА'
assert.equal(foldSaleName('ҚӘЗ ҚОСМЕТИЧКА'), 'каз косметичка')
assert.equal(modelNameTokensMatch(name,'QA RESOLVER 1811'),true,'Numbers in title are model identity')
assert.equal(modelNameTokensMatch(name,'QA RESOLVER 1811 КОСМЕТИЧКА'),true)
assert.equal(modelNameTokensMatch(name,'КОСМЕТИЧКА 1811'),true)
assert.equal(modelNameTokensMatch(name,'1811'),true)
assert.equal(modelNameTokensMatch('ЭТНО БОМБЕР','ЭТНО БОМБЕР 56'),false,'Separate numerical size filtering remains')
assert.equal(modelNameTokensMatch('ЭТНО БОМБЕР','ЭТНО БОМБЕР'),true)
assert.equal(modelNameTokensMatch(name,''),false)
assert.equal(modelNameTokensMatch('КЕРБЕЗ АБАЙКА','QA RESOLVER 1811'),false)

for (const file of ['src/features/orders/MainSalePicker.tsx','src/features/orders/MainClothingSourcePicker.tsx']) {
 const source=readFileSync(file,'utf8')
 assert.match(source,/modelNameTokensMatch\(model\.name,query\)/,'Both order pickers must preserve numeric model names')
}
const order=(catalogIdentity,stockWriteoffStatus='pending_reservation')=>({
 id:2225, external_id:'ORD-ARCHIVED-SKU-2225',created_at:'2026-11-18T14:49:32Z',
 shipping_status:'not_sent', order_status:'active',
 items:[{id:5285,productName:'QA RESOLVER 1811 КОСМЕТИЧКА',
  variantId:2000,catalogIdentity,quantity:1,sourceType:'boutique',
  stockWriteoffStatus,shipmentSentQuantity:0}],
})
const reservations=[{order_item_id:5285,quantity:1,status:'unresolved',variant_id:2000}]
const retired=buildOrderShipmentPlan(order('snapshot'),reservations)
assert.equal(retired.selectedCount,0,'Historical archived SKU may not be offered for new physical issue')
assert.equal(retired.lines[0].selectable,false)
assert.match(retired.lines[0].reason,/архивирован/)
const active=buildOrderShipmentPlan(order('variant'),reservations)
assert.equal(active.selectedCount,1,'Same existing active linked SKU remains selectable after stock confirmation')
assert.equal(active.lines[0].readyQuantity,1)
const issued=buildOrderShipmentPlan(order('snapshot','fulfilled'),
 [{order_item_id:5285,quantity:1,status:'fulfilled',variant_id:2000,inventory_source:'boutique'}],
 new Set([5285]))
assert.equal(issued.lines[0].dispatchPriorIssued,true,'Exact proven earlier issue may be recorded without physical write')
assert.equal(issued.lines[0].readyQuantity,1)
console.log('RESOLVER_NOV18_FOLLOWUP_PASS: explicit adult wins over numeric age, numeric model name search, retired physical dispatch guard, no prior-issue regression')

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeInventoryItem } from '../worker/domains/order-core.ts'
import { arrivalFactsMatchCanonicalSku } from '../worker/domains/inventory-movement.ts'

const sku={
  productId:1,variantId:15,productName:'АБАЙКА',category:'adult',gender:'ЖЕН',
  color:'СЕРО-ГОЛУБОЙ',material:'ДАК',length:'СТАНДАРТ',
  size:'СТАНДАРТ',quantity:1,expectedQuantity:null,
}
const canonical={
  ...sku,color:'СЕРО ГОЛУБОЙ',quantity:0,productName:'АБАЙКА',gender:'ЖЕН',
}
const input=patch=>normalizeInventoryItem({...sku,...patch})
assert.equal(arrivalFactsMatchCanonicalSku(input({}),canonical),true,
  'Hyphen/space color aliases must map to the same canonical SKU')
for(const [field,value] of [
 ['category','child'],['gender','МУЖ'],['color','ЗЕЛЕНЫЙ'],
 ['material','АТЛАС'],['length','ДЛИННЫЙ'],['size','L'],
]){
  assert.equal(arrivalFactsMatchCanonicalSku(input({[field]:value}),canonical),false,
    'Wrong '+field+' must not be credited to selected barcode SKU')
}
const source=fs.readFileSync('worker/domains/inventory-movement.ts','utf8')
const write=source.slice(source.indexOf('export async function applyInventoryMovement('))
const start=write.indexOf('items.forEach((raw, index) => {')
const end=write.indexOf('if (strictOperationName)',start)
assert(start>=0 && end>start)
const arrival=write.slice(start,end)
assert.match(arrival,/if \(movementType === 'arrival'\)/)
assert.match(arrival,/if \(!arrivalFactsMatchCanonicalSku\(raw, item\)\)/)
assert.match(arrival,/Склад не изменён/)
assert.match(arrival,/raw.productId > 0 && raw.productId !==/)
assert.match(arrival,/validArrivalAliasPairs/)
console.log('WAREHOUSE_ARRIVAL_CANONICAL_BARCODE_IDENTITY_PASSED — right SKU accepted, six mismatched facts rejected before stock write')

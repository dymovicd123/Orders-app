import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transferProvidedFactsMatchCanonicalSku } from '../worker/domains/inventory-movement.ts'

const canonical={
  productId:7,variantId:77,productName:'АБАЙКА',category:'adult',gender:'ЖЕН',
  color:'СЕРО ГОЛУБОЙ',material:'ДАК',length:'СТАНДАРТ',size:'46',
}
const displayed={
  productId:7,variantId:77,productName:'АБАЙКА',category:'adult',gender:'ЖЕН',
  color:'СЕРО-ГОЛУБОЙ',material:'ДАК',length:'СТАНДАРТ',size:'46',quantity:1,
}
assert.equal(transferProvidedFactsMatchCanonicalSku(displayed,canonical),true)
assert.equal(transferProvidedFactsMatchCanonicalSku({variantId:77,quantity:1},canonical),true,
 'Future barcode reader can send exact canonical variant ID without redundant text')
for(const [field,value] of [
 ['productId',8],['productName','ЖИЛЕТ'],['category','child'],
 ['gender','МУЖ'],['color','КРАСНЫЙ'],['material','АТЛАС'],
 ['length','ДЛИННЫЙ'],['size','48'],
]){
 const raw={...displayed,[field]:value}
 assert.equal(transferProvidedFactsMatchCanonicalSku(raw,canonical),false,
   'Wrong '+field+' must never move another SKU')
}
assert.equal(transferProvidedFactsMatchCanonicalSku({...displayed,size:''},canonical),false,
 'Explicitly blanked size cannot silently convert size 46 into a different SKU')
const transfer=fs.readFileSync('worker/domains/inventory-movement.ts','utf8')
const start=transfer.indexOf('export async function applyInventoryTransfer(')
const end=transfer.indexOf('export async function reverseInventoryTransferDocument(',start)
assert(start>0&&end>start)
const method=transfer.slice(start,end)
const fetchAt=method.indexOf('const missingCanonical = variantIds.filter')
const protectAt=method.indexOf('transferProvidedFactsMatchCanonicalSku(raw, canonical)')
const writesAt=method.indexOf('const ensureSourceStock = db.prepare')
assert(fetchAt>=0 && protectAt>fetchAt && writesAt>protectAt,
 'Full identity check must occur after reading canonical SKU and BEFORE any stock mutation')
assert.match(method,/const requestFingerprint = inventoryTransferRequestFingerprint/)
assert.match(method,/for \(const raw of rawItems\)/)
console.log('MAIN_TRANSFER_CANONICAL_SKU_PREWRITE_PASSED — matched and ID-only scans allowed; 9 stale/mismatched facts rejected')

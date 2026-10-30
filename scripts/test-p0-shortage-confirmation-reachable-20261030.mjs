// Regression for the exact 2026-10-30 screenshot: POST /api/orders sends
// a 409 JSON shortage response, but the UI must still parse it and expose
// the item-specific acknowledgement button. No network or D1 mutations.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readJsonResponse, ApiResponseError } from '../src/app/utils.ts'

const body={
 ok:false,code:'order_stock_shortage',
 message:'По свежим данным для «АБАЙКА» не хватает 1 шт.',
 shortages:[{
  inventorySource:'warehouse',variantId:101,inputIndexes:[0],
  physicalQuantity:0,reservedQuantity:0,requestedQuantity:1,shortage:1,
 }]
}
const badResponse=()=>new Response(JSON.stringify(body),{
 status:409,headers:{'Content-Type':'application/json'},
})
// Real shared JSON parser: the default raises ApiResponseError before the
// caller can inspect its code and shortages.
await assert.rejects(
 readJsonResponse(badResponse(),'Создание заказа'),
 e=>e instanceof ApiResponseError && e.status===409
)
for(const label of ['Создание заказа','Сохранение заказа']){
 const result=await readJsonResponse(badResponse(),label,{allowHttpError:true})
 assert.equal(result.code,'order_stock_shortage')
 assert.equal(result.shortages[0].inputIndexes[0],0)
 assert.equal(result.shortages[0].shortage,1)
}
await assert.rejects(
 readJsonResponse(new Response('<html>proxy failed</html>',{status:502}),'Создание заказа',{allowHttpError:true}),
 e=>e instanceof ApiResponseError
)
const app=fs.readFileSync('src/App.tsx','utf8')
const view=fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx','utf8')
const create=app.match(/\}\>\(response, 'Создание заказа', \{ allowHttpError: true \}\)/g)||[]
const edit=app.match(/\}\>\(response, 'Сохранение заказа', \{ allowHttpError: true \}\)/g)||[]
assert.equal(create.length,1,'Create must parse expected shortage 409 JSON')
assert.equal(edit.length,1,'Editor must parse expected shortage 409 JSON')
assert.equal((app.match(/result.code === 'order_stock_shortage'/g)||[]).length,2)
assert.equal((app.match(/serverShortage: \{/g)||[]).length,2,
 'Create AND Edit must attach server shortage snapshot to draft')
assert.match(view,/serverShortage \? \(/,'Show the acknowledgement only for fresh server shortage facts')
assert.match(view,/Подтвердить резерв при нехватке — товар физически есть/)
assert.match(view,/if \(!serverShortage \|\| itemIndex === undefined\) return/)
assert.match(view,/inventorySource: serverShortage.inventorySource/)
assert.match(view,/reservedQuantity: serverShortage.reservedQuantity/)
assert.match(view,/requestedQuantity: serverShortage.requestedQuantity/)
assert.match(app,/shortageDecision: item.sourceType !== 'workshop'/)
assert.match(view,/Физический остаток автоматически не изменится/)
const picker=view.slice(view.indexOf('function buildOrderItemFromCatalogPick('),view.indexOf('function applyCreateProductPick('))
assert.match(picker,/shortageAcknowledged: false/, 'Catalog product switch must invalidate physical stock consent')
assert.match(picker,/shortageDecision: null/, 'Catalog product switch must invalidate server snapshot')
assert.match(picker,/serverShortage: undefined/, 'No wrong SKU shortage must remain visible')
assert.match(view,/расхождение исправляется отдельно/)
console.log('P0_SHORTAGE_CONFIRMATION_REACHABLE_PASSED — create+edit 409 parsed, server snapshot bound, physical-stock acknowledgement visible, no automatic stock adjustment')

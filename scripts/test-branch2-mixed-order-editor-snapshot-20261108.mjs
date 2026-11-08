import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orders-mixed-editor-'))
await build({entryPoints:['src/app/itemizedEditCatalogSnapshot.ts','src/app/order-pricing.ts'],
 bundle:true,platform:'node',format:'esm',target:'node20',outdir:dir,outExtension:{'.js':'.mjs'},logLevel:'error'})
const {historicalCatalogSnapshotForEdit:keepSnapshot}=await import(pathToFileURL(path.join(dir,'itemizedEditCatalogSnapshot.mjs')).href)
const {evaluateItemizedCreatePricing:price}=await import(pathToFileURL(path.join(dir,'order-pricing.mjs')).href)

const base=(id,name,material,length,size,qty,unitPrice,snapshot,source='warehouse')=>({
 id,orderItemId:id,productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'СВЕТЛО-БЕЖЕВЫЙ',
 material,length,size,quantity:qty,unitPrice,catalogPriceSnapshot:snapshot,sourceType:source,
})
const original=[
 base(11,'БАЯН СҰЛУ ШАПАН','ЗАМША ВЕЛЮР','СТАНДАРТ','44',1,22500,22500),
 base(14,'БАЯН СҰЛУ ШАПАН','ЗАМША ВЕЛЮР','ДЛИННЫЙ','44',1,27500,27000),
 base(15,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','42',1,25000,25000),
 base(16,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','44',1,20000,20000),
 base(17,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','46',1,25000,25000),
 base(18,'ДРУГОЙ ТОВАР','СТАНДАРТ','СТАНДАРТ','48',1,25000,25000),
]
assert.equal(price(original,[]).totalAmount,145000)
const next=[
 {...original[0],quantity:2,unitPrice:22600},
 {...original[1],size:'48',color:'СВЕТЛО-БЕЖЕВЫЙ',catalogPriceSnapshot:29000},
 ...original.slice(2),
 {...original[1],id:undefined,orderItemId:undefined,sourceType:'boutique',catalogPriceSnapshot:27500,quantity:1},
]
const byId=new Map(original.map(x=>[x.id,x]))
const payload=next.map(item=>({
 ...item,
 catalogPriceSnapshot:keepSnapshot(byId.get(item.orderItemId),item),
}))
assert.equal(payload.length,7)
assert.equal(payload[1].orderItemId,14)
assert.equal(payload[1].catalogPriceSnapshot,27000,'Changing 44 to 48 in same execution must retain historical snapshot')
assert.equal(payload[0].catalogPriceSnapshot,22500,'Quantity and sale price edit must preserve snapshot')
assert.equal(payload[6].catalogPriceSnapshot,27500,'New boutique line can use new catalog snapshot')
const result=price(payload,[])
assert.equal(result.status,'ready',JSON.stringify(result.blockers))
assert.equal(result.totalAmount,195200,'Work mixed edit total')
assert.equal(result.lines.length,7)
assert.equal(result.debtAmount,195200)
const paid=price(payload,[{method:'НАЛИЧКА',amount:8000}])
assert.equal(paid.status,'ready')
assert.equal(paid.receivedAmount,8000)
assert.equal(paid.debtAmount,187200)
const changedExecution={...original[1],length:'УКОРОЧЕННЫЙ',catalogPriceSnapshot:29000}
assert.equal(keepSnapshot(original[1],changedExecution),29000,'Different execution may have new snapshot')
assert.equal(keepSnapshot(original[1],{...original[1],sourceType:'boutique',catalogPriceSnapshot:29000}),27000)
assert.equal(keepSnapshot(original[1],{...original[1],color:'ЧЕРНЫЙ',catalogPriceSnapshot:null}),27000)
assert.equal(keepSnapshot({...original[1],catalogPriceSnapshot:null},{...original[1],size:'52',catalogPriceSnapshot:29000}),null)
assert.equal(keepSnapshot(null,{...original[1],catalogPriceSnapshot:29000}),29000)
const app=fs.readFileSync('src/App.tsx','utf8')
const server=fs.readFileSync('worker/domains/orders-write.ts','utf8')
assert(app.includes('catalogPriceSnapshot: historicalCatalogSnapshotForEdit('),'Client replacement payload must apply historical snapshot')
assert(server.includes('Цена Каталога для неизменённого ценового исполнения является историческим снимком'),'Server must protect immutable snapshots')
console.log('BRANCH2_MIXED_EDITOR_SNAPSHOT_PASS: Work 6 to 7 items, 145000 to 195200, sale price edit, existing payments, execution snapshots')

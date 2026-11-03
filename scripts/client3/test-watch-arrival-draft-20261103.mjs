import assert from 'node:assert/strict'
import {applyClient3WatchBulkOperation} from '../../worker/domains/client3-watch-bulk.ts'
import {
 readWarehouseOperationDraft,saveWarehouseOperationDraft,hasWarehouseDraftContent,
} from '../../src/features/client3/watchWarehouseDraftStorage.ts'
const tab=()=>{const map=new Map();return {
 getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),
}}
const tabA=tab(),tabB=tab()
const first={
 version:1,brand:'TAUWACH',mode:'arrival',source:'office',stage:'quantities',
 selectedModel:42,selectedModelIdsBySource:{office:[42,91],showcase:[55]},
 draftBySource:{office:{101:'23',102:'5',103:'0'},showcase:{201:'13'}},
 reason:'Новая поставка',request:null,
}
assert.equal(hasWarehouseDraftContent(first),true)
assert.equal(saveWarehouseOperationDraft(first,tabA),true)
assert.deepEqual(readWarehouseOperationDraft('TAUWACH',tabA),first,
 'Page reload must restore all input quantities and selected models')
assert.equal(readWarehouseOperationDraft('TAUWACH',tabB),null,
 'Two browser tabs cannot overwrite each other')
assert.equal(readWarehouseOperationDraft('WACHIZEN',tabA),null,
 'Two brands are isolated within the same tab')
const tabBdraft={...first,source:'showcase',draftBySource:{
 office:{},showcase:{201:'71',202:'4'},
},stage:'review',request:{fingerprint:'same-payload',id:'watch-main-operation-abc12345'}}
assert(saveWarehouseOperationDraft(tabBdraft,tabB))
assert.equal(readWarehouseOperationDraft('TAUWACH',tabB).draftBySource.showcase[201],'71')
assert.equal(readWarehouseOperationDraft('TAUWACH',tabA).draftBySource.office[101],'23')
assert.deepEqual(readWarehouseOperationDraft('TAUWACH',tabB).request,tabBdraft.request,
 'Persist idempotency key so retry after network error cannot duplicate stock')
assert(saveWarehouseOperationDraft({...first,selectedModelIdsBySource:{office:[],showcase:[]},
  draftBySource:{office:{},showcase:{}},reason:'',request:null},tabA))
assert.equal(readWarehouseOperationDraft('TAUWACH',tabA),null,
 'After successful save an empty draft should disappear')
assert.equal(readWarehouseOperationDraft('TAUWACH',tabB).draftBySource.showcase[201],'71',
 'Clearing one tab must not change another tab')
console.log('Client3 arrival drafts: per-tab and brand isolation, reload, stages, quantity and idempotency PASS')

const watchRows=Array.from({length:31},(_,i)=>({
 watchId:i+1,variantId:1000+i,productId:500+i,productName:'Test '+i,
 category:'adult',gender:'male',color:'black',material:'steel',length:'',size:'standard',
}))
const db={
 prepare(sql){
  return {
   bind(){return this},
   async first(){return sql.includes('inventory_model_meta')?{value:'active'}:null},
   async all(){if(sql.includes('FROM watch_variants wv'))return {results:watchRows};
     throw Error('Unexpected SQL '+sql.slice(0,60))},
  }
 },
}
let applied=0
const deps={movement:async (_db,input)=>{applied=input.items.length;return {ok:true,applied}}}
const admin={id:1,role:'admin'}
const payload={kind:'arrival',source:'office',requestId:'arrival-many-sku-20261103',
 items:watchRows.map(x=>({watchVariantId:x.watchId,quantity:2}))}
const ok=await applyClient3WatchBulkOperation(db,admin,1,payload,deps)
assert.equal(ok.status,200)
assert.equal(applied,31,'Arrival beyond the previous silent 30-SKU cap must be processed')
const oversized=await applyClient3WatchBulkOperation(db,admin,1,{
 ...payload,items:Array.from({length:101},(_,i)=>({watchVariantId:i+1,quantity:1})),
},deps)
assert.equal(oversized.status,400,'Never silently truncate an oversized arrival')
assert.match((await oversized.json()).message,/100/)
console.log('Client3 31-variant atomic arrival and explicit 100-SKU boundary PASS')

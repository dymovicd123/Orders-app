import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
const part=(start,end)=>{
 const i=app.indexOf(start),j=app.indexOf(end,i+start.length)
 assert(i>=0&&j>i,'App contains '+start)
 return app.slice(i,j)
}
const helper=part('function invalidateWarehouseAttentionAfterCommit()', 'function invalidateInventoryStockCaches(')
assert.match(helper,/warehouseAttentionRequestToken \+= 1/,'Supersede in-flight response')
assert.match(helper,/warehouseAttentionSummaryCache = null/,'Expired summary must never be reused')
assert.match(helper,/warehouseAttentionSummaryInFlight = null/,'Old promise must not be reused')
assert.match(helper,/setWarehouseAttention\(null\)/,'Do not show known stale badges')
assert.match(part('function invalidateInventoryStockCaches(', 'async function loadCatalogData('),/invalidateWarehouseAttentionAfterCommit\(\)/)
for(const [start,end,min]of [
 ['async function saveReturn()','async function saveExchange()',1],
 ['async function saveExchange()','async function receiveReturnedItemAction(',3],
 ['async function cancelReturnEntry(', 'async function correctExchangeFinancialEntry(',1],
 ['async function cancelExchangeEntry(', 'function renderInventoryStockGroups(',1],
]){
 const source=part(start,end)
 const commits=[...source.matchAll(/completeCriticalRequest\((?:criticalKey|batchKey), critical\.requestId\)/g)].length
 const invalidations=[...source.matchAll(/invalidateWarehouseAttentionAfterCommit\(\)/g)].length
 assert.equal(commits,min,start+' expected only those committed stock-changing actions')
 assert.equal(invalidations,commits,start+' must invalidate exactly after every committed operation')
 assert(source.indexOf('invalidateWarehouseAttentionAfterCommit()')>source.indexOf('completeCriticalRequest('),
  'Invalidation must follow durable commit, never precede it')
}
assert(!part('function invalidateWarehouseAttentionAfterCommit()', 'function invalidateInventoryStockCaches(').includes('loadWarehouseAttention('),
 'Invalidation is cheap: no unnecessary D1 scan on every Order/Return/Exchange mutation')
console.log('STAGE4_RETURN_EXCHANGE_ATTENTION_INVALIDATION_PASS')

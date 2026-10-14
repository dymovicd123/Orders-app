import fs from 'node:fs'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
import { listInventory } from '../worker/domains/inventory-read.ts'
import { loadCompleteInventorySnapshot } from '../src/features/inventory/loadCompleteInventorySnapshot.ts'

const read = p => fs.readFileSync(p,'utf8')
const worker = read('worker/domains/inventory-movement.ts')
const app = read('src/App.tsx')
const resolverBegin = worker.indexOf('  const resolveProduct = (item: ReturnType<typeof normalizeInventoryItem>) => {')
const resolverEnd = worker.indexOf('\n\n  const resolveGenderForProduct',resolverBegin)
assert.ok(resolverBegin > 0 && resolverEnd > resolverBegin, 'Arrival resolver not found')
const resolverSource = worker.slice(resolverBegin,resolverEnd)
  .replace('(item: ReturnType<typeof normalizeInventoryItem>)','(item)')
const normalize = value => String(value||'').trim().toUpperCase().replace(/\s+/g,' ')
const product43 = {id:43,name:'ОРДА ШАПАН',is_active:1}
const product74 = {id:74,name:'ОРДА',is_active:1}
const productMap = new Map([[43,product43],[74,product74]])
function resolve(name, explicitId, aliasName='ОРДА') {
  const ctx = {
    lookup: {
      byId:productMap,
      byAlias: new Map([[normalize(aliasName),product43]]),
      byExact: new Map([[normalize(product43.name),product43],[normalize(product74.name),product74]]),
      byIdentity: new Map([[normalize(product43.name),product43],[normalize(product74.name),product74]]),
    },
    normalizeCatalogProductIdentityKey:normalize,
    upperText:normalize,
    toInt:value=>Number(value)||0,
  }
  const fn = vm.runInNewContext(resolverSource+'\nresolveProduct',ctx)
  return fn({productName:name,productId:explicitId})
}
assert.equal(resolve('ОРДА ШАПАН',74).id,43,'Stale active ORDA product ID wrongly overrides canonical ORDA SHAPAN')
assert.equal(resolve('ОРДА',74).id,43,'Canonical alias lost priority over stale active exact ORDA')
assert.equal(resolve('ОРДА',43).id,43,'Alias must win even when explicit ID is already canonical')
assert.equal(resolve('ОРДА ШАПАН',43).id,43)
assert.equal(resolve('НЕИЗВЕСТНЫЙ ШАПАН',74),null,'Unknown name silently gets assigned to an unrelated active product')
assert.ok(worker.includes('validArrivalAliasPairs') && worker.includes('enteredProductKey !== canonicalProductKey'),
  'Existing variant IDs from outdated pickers can still misroute arrivals by name')
assert.ok(worker.includes('raw.productId !== toInt(item.productId, 0)'),
  'Existing variant IDs from outdated pickers can still cross product IDs')
assert.ok(worker.includes('arrivalReceipt') && worker.includes("event: 'arrival_receipt_read_failed'"),
  'Post-commit Arrival cannot report canonical product and source')
assert.ok(app.includes('arrivalReceipt?.verified') && app.includes('result.operationId'),
  'User receives silent success without verified stock and operation reference')
assert.ok(app.includes('verifiedInStockList') && app.includes('arrivalReceipt.items.every('),
  'Arrival is reported as visible without verifying its exact variant is in the complete stock list')
assert.ok(app.includes('const refreshResults = await Promise.allSettled(refreshes)'),
  'Successful POST must not be reported failed just because stock refresh is unavailable')

// Real inventory SQL lookup: a positive ORDA SHAPAN boutique row must
// stay visible through complete pagination, not be constrained to Warehouse.
const sql = new DatabaseSync(':memory:')
sql.exec([
  'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);',
  'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);',
  'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT,created_at TEXT);',
  'CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT);',
  "INSERT INTO inventory_model_meta VALUES ('human_inventory_v2','active');",
  "INSERT INTO catalog_products VALUES(43,'ОРДА ШАПАН',1),(74,'ОРДА',1);",
  "INSERT INTO catalog_variants VALUES(9001,43,'adult','МУЖ','КОРИЧНЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52',1);",
  "INSERT INTO inventory_stock VALUES(1201,'boutique',43,9001,'ОРДА ШАПАН','МУЖ','КОРИЧНЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52',4,0,'Приход','manual-audit',null,null);",
].join('\n'))
const d1 = { prepare(query) { let bindings=[]; return {
  bind(...args) { bindings=args; return this },
  async all() { return {results:sql.prepare(query).all(...bindings)} },
  async first() { return sql.prepare(query).get(...bindings)||null },
}} }
const browse = async(source,cursor) => listInventory(d1,new URL('https://test.local/api/inventory?'+
  new URLSearchParams({source,limit:'1000',cursor:String(cursor),includeMovements:'0'})))
const boutique = await loadCompleteInventorySnapshot(cursor=>browse('boutique',cursor),false)
assert.equal(boutique.items.length,1)
assert.equal(boutique.items[0].productName,'ОРДА ШАПАН')
assert.equal(boutique.items[0].quantity,4)
assert.equal(boutique.items[0].inventorySource,'boutique')
const warehouse = await loadCompleteInventorySnapshot(cursor=>browse('warehouse',cursor),false)
assert.equal(warehouse.items.length,0)
console.log('ORDA ARRIVAL SAFETY PASSED — stale IDs/aliases route to canonical product, mismatched SKU fails closed, boutique SQL browse retains committed stock and user gets receipt')

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import ts from 'typescript'

const source=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const relations=readFileSync('worker/domains/orders-relations.ts','utf8')
const interfaceSource=readFileSync('src/features/sections/OrderReturnsSection.tsx','utf8')
const app=readFileSync('src/App.tsx','utf8')
const critical=readFileSync('worker/domains/critical.ts','utf8')
assert.match(source,/alreadyReturnedQuantity = Math\.max\(0, toInt\(alreadyReturnedRow\?\.quantity, 0\)\)/)
assert.match(source,/if \(selected\.quantity > maxQuantity\)/)
assert.match(source,/COALESCE\(r\.status, 'completed'\) <> 'cancelled'/)
assert.match(source,/AND \$\{noStandaloneReturnSql\}/)
assert.match(source,/quantity: \(current\?\.quantity \|\| 0\) \+ quantity/)
assert.match(source,/physicalTracking \? 1 : 0/)
assert.match(source,/physicalTracking && physicalState !== 'pending' \? createdAt : null/)
assert.match(source,/inventorySource = physicalTracking \? trackedInventorySource/)
assert.match(source,/status IN \('active', 'unresolved'\)/)
assert.match(app,/quantity: item\.quantity,\s*restock: item\.physicalState/)
assert.match(interfaceSource,/Сколько возвращается/)
assert.match(critical,/critical_operation_entities/)
assert.match(source,/await completeCriticalOperation\(db, criticalOperation, completedResponse\)/)
assert.match(relations,/active_standalone_returned_quantity/)
const src=readFileSync('src/app/utils.ts','utf8')
const compiled=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const utils=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const db=new DatabaseSync(':memory:')
db.exec(`
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER);
 CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,quantity INTEGER,physical_tracking INTEGER,physical_received_at TEXT,inventory_source TEXT);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,refund_return_id INTEGER,status TEXT);
 INSERT INTO order_items VALUES(1,42,3);
 INSERT INTO returns VALUES(10,42,'completed'),(11,42,'completed'),(12,42,'cancelled'),(13,42,'completed'),(14,42,'completed');
 INSERT INTO return_items VALUES(100,10,1,1,1,NULL,NULL),(101,11,1,1,1,'2026-10-26T13:00:00Z','warehouse'),(102,12,1,1,1,NULL,NULL),(103,13,1,1,1,NULL,NULL);
 INSERT INTO exchanges VALUES(200,13,'completed');
`)
const query=`SELECT COALESCE(SUM(ri.quantity),0) AS returned
FROM return_items ri JOIN returns r ON r.id=ri.return_id
WHERE r.order_id=? AND ri.order_item_id=? AND COALESCE(r.status,'completed')<>'cancelled'
AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')`
const available=()=>3-Number(db.prepare(query).get(42,1).returned)
assert.equal(available(),1,'Two separately returned units leave only one')
assert.equal(utils.createReturnDraft({shipping_status:'sent',items:[
 {id:1,productName:'ШАРФ',quantity:3,availableOperationQuantity:available(),stockWriteoffStatus:'fulfilled',sourceType:'warehouse'}
]}).items[0].quantity,1,'Only remaining units can be preselected')
db.exec("INSERT INTO returns VALUES(15,42,'completed'); INSERT INTO return_items VALUES(104,15,1,1,1,'2026-10-27T09:00:00Z','boutique')")
assert.equal(available(),0,'Third return completes the line')
assert.equal(utils.createReturnDraft({shipping_status:'sent',items:[
 {id:1,productName:'ШАРФ',quantity:3,availableOperationQuantity:available(),stockWriteoffStatus:'fulfilled',sourceType:'warehouse'}
]}).items.length,0,'Fully returned line must disappear from selection')
assert.equal(db.prepare('SELECT SUM(quantity) AS qty FROM return_items WHERE physical_received_at IS NULL').get().qty,3,'Unreceived includes cancelled and exchange-related historical data but never proves stock')
db.close()
console.log('PARTIAL_RETURN_SEQUENTIAL_LEDGER_UI_AND_PHYSICAL_TEST_PASS')

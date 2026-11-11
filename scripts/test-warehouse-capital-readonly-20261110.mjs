import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {readWarehouseCapital} from '../worker/domains/warehouse-capital.ts'

function dbAdapter(sqlite){
  return {prepare(sql){
    const wrap=args=>({
      async all(){return {results:sqlite.prepare(sql).all(...args)}},
      async first(){return sqlite.prepare(sql).get(...args)||null},
      async run(){return sqlite.prepare(sql).run(...args)},
    })
    return {...wrap([]),bind(...args){return wrap(args)}}
  }}
}
function fixture(withPrices=true){
  const db=new DatabaseSync(':memory:')
  db.exec([
    'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);',
    'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,size_label TEXT,material TEXT,length TEXT,is_active INTEGER);',
    'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,size_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,quantity INTEGER,reserved_quantity INTEGER);',
    "INSERT INTO catalog_products VALUES(1,'Модель А',1),(2,'Модель Б',1);",
    "INSERT INTO catalog_variants VALUES (10,1,100,'adult','жен','красный','46','замша','стандарт',1),(11,1,100,'adult','жен','зелёный','48','замша','стандарт',1),(12,2,200,'child','уни','синий','6','хлопок','стандарт',1),(13,2,300,'adult','муж','серый','52','лён','стандарт',0);",
    "INSERT INTO inventory_stock VALUES (1,'warehouse',10,1,'Старая А','','','','','',5,2),(2,'boutique',11,1,'Старая А','','','','','',3,4),(3,'warehouse',12,2,'Б','','','','','',2,0),(4,'warehouse',10,1,'А','','','','','',0,0),(5,'boutique',10,1,'А','','','','','',-2,0),(6,'warehouse',NULL,2,'Без SKU','','','','','',1,0),(7,'warehouse',13,2,'Архив','','','','','',1,0);",
  ].join('\n'))
  if(withPrices)db.exec([
    'CREATE TABLE catalog_execution_prices(stock_position_id INTEGER,category TEXT,cost_price INTEGER,sale_price INTEGER);',
    "INSERT INTO catalog_execution_prices VALUES (100,'adult',100,300),(100,'child',5000,10000),(300,'adult',0,0);",
  ].join('\n'))
  return db
}
const sqlite=fixture()
const before=sqlite.prepare('SELECT * FROM inventory_stock ORDER BY id').all()
const snapshot=await readWarehouseCapital(dbAdapter(sqlite))
assert.equal(snapshot.ok,true)
assert.equal(snapshot.rows.length,5)
assert.equal(snapshot.totals.quantity,12)
assert.equal(snapshot.totals.reserved,5)
assert.equal(snapshot.totals.free,7)
assert.equal(snapshot.totals.knownCost,800)
assert.equal(snapshot.totals.knownSale,2400)
assert.equal(snapshot.totals.knownGrossPotential,1600)
assert.equal(snapshot.totals.pricedCostQuantity,9)
assert.equal(snapshot.totals.missingCostQuantity,3)
assert.equal(snapshot.totals.missingSaleQuantity,3)
assert.equal(snapshot.totals.zeroRows,1)
assert.equal(snapshot.totals.negativeRows,1)
assert.equal(snapshot.totals.overReservedRows,1)
assert.equal(snapshot.totals.unlinkedPositiveRows,1)
assert.equal(snapshot.bySource.warehouse.quantity,9)
assert.equal(snapshot.bySource.boutique.quantity,3)
const red=snapshot.rows.find(x=>x.stockId===1)
assert.equal(red?.product,'Модель А')
assert.equal(red?.costPrice,100)
assert.equal(red?.free,3)
assert.equal(red?.grossPotential,1000)
assert.equal(snapshot.rows.find(x=>x.stockId===3)?.costPrice,null)
assert.equal(snapshot.rows.find(x=>x.stockId===7)?.costPrice,0)
assert.deepEqual(sqlite.prepare('SELECT * FROM inventory_stock ORDER BY id').all(),before,
  'Read-only valuation must never touch inventory quantities or reservations')
const absent=await readWarehouseCapital(dbAdapter(fixture(false)))
assert.equal(absent.pricesAvailable,false)
assert.equal(absent.totals.quantity,12)
assert.equal(absent.totals.pricedCostQuantity,0)
assert.equal(absent.totals.knownCost,0)
assert.equal(absent.totals.missingCostQuantity,12)
const worker=readFileSync('worker/index.ts','utf8')
const route=worker.slice(worker.indexOf("url.pathname === '/api/reports/warehouse-capital'"))
assert.ok(route.includes('requireAdminUser(authUser')&&route.indexOf('requireAdminUser(authUser')<route.indexOf('readWarehouseCapital(env.DB)'),
 'Finance API must guard admin role before reading confidential prices')
const source=readFileSync('src/features/sections/InventorySection.tsx','utf8')
assert.ok(source.includes("<InventoryDemandStatistics active={inventoryModuleVisible && inventoryPanel === 'statistics'} />"))
assert.ok(source.includes("<WarehouseReportsWorkspace active={inventoryModuleVisible && inventoryPanel === 'reports'} isAdmin={isFinanceAdmin} />"))
assert.ok(source.includes("label: 'Статистика'")&&source.includes("label: 'Отчёты'"))
console.log('WAREHOUSE_CAPITAL_READ_ONLY_PASS: source, category, reserved clamp, unknown prices, exclusions and roles')

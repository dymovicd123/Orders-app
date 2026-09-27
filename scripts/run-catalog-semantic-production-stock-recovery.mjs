import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const DB = 'orders_db_prod'
const CORRECTION_KEY = 'semantic-sku-20260927-r1'
const RECOVERY_KEY = 'semantic-sku-20260927-r1-stock-recovery-v1'
const SOURCE_IDS = [480,1277,1278,1279,1303]
const ALL_IDS = [480,1084,1277,1438,1278,1436,1279,1441,1303,1473]
const EXPECTED_HASHES = {
  orders: 'dcedb38e304be6be18a8d081897a6812ca9546ca145cc93ae7b11ffa8abe8778',
  movements: '09cf99359d413af58791e332bccece54d5fadfb84589af913fe537fc6dc8926f',
  stocktakes: 'd5b63673767a69ed1285b98418487d1d90334673403fa112f0735eccd0ae4347',
  transfers: 'd12547ccb27ee4fdf0cbac14ffe7b57900b87ff9c23ad24597bdab0cf730c5d3',
}

function call(sql) {
  const raw = execFileSync('npx', [
    'wrangler','d1','execute',DB,'--remote','--config','wrangler.jsonc',
    '--command',sql,'--json',
  ], { encoding:'utf8', maxBuffer:64*1024*1024 })
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed[0] || !Array.isArray(parsed[0].results)) {
    throw new Error('Unexpected D1 response')
  }
  return { rows: parsed[0].results, meta: parsed[0].meta || {} }
}
function query(sql) {
  const r=call(sql)
  if (Number(r.meta.changes||0)!==0 || Number(r.meta.rows_written||0)!==0) {
    throw new Error('Read unexpectedly wrote rows')
  }
  return r.rows
}
function mutate(sql,label) {
  const r=call(sql)
  console.log(label, JSON.stringify({changes:Number(r.meta.changes||0),rows_written:Number(r.meta.rows_written||0)}))
  return r
}
function hash(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}
function assert(condition,message) {
  if (!condition) throw new Error(message)
}
function scalar(sql,field) {
  const row=query(sql)[0] || {}
  return Number(row[field] || 0)
}
function protectedHashes() {
  const ids=ALL_IDS.join(',')
  const values={
    orders: query('SELECT id,order_id,product_id,product_name_snapshot,audience_type,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,source_type,is_workshop FROM order_items WHERE variant_id IN ('+ids+') ORDER BY id'),
    movements: query('SELECT id,inventory_source,product_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,movement_type,quantity_delta,quantity_after,reference_type,reference_id,created_at FROM inventory_movements WHERE variant_id IN ('+ids+') ORDER BY id'),
    stocktakes: query('SELECT id,session_id,stock_id,product_id,variant_id,product_name_snapshot,category_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,opening_quantity,opening_reserved_quantity,baseline_quantity,counted_quantity,counted_at,status,conflict_quantity,applied_quantity,created_at,updated_at FROM inventory_stocktake_items WHERE variant_id IN ('+ids+') ORDER BY id'),
    transfers: query('SELECT id,transfer_id,product_id,quantity,from_quantity_before,from_quantity_after,to_quantity_before,to_quantity_after,source_reserved_quantity,source_shortage_after,created_at FROM inventory_transfer_items WHERE variant_id IN ('+ids+') ORDER BY id'),
  }
  return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,hash(v)]))
}
function assertProtectedHistory() {
  const actual=protectedHashes()
  for (const [name,expected] of Object.entries(EXPECTED_HASHES)) {
    assert(actual[name]===expected,'Protected historical facts drifted for '+name+': '+actual[name]+' != '+expected)
  }
  return actual
}
function assertNoActiveSemanticCollisions() {
  const rows=query('SELECT id,stock_position_id,category,gender,color,size_label FROM catalog_variants WHERE is_active=1 AND stock_position_id IS NOT NULL ORDER BY id')
  const upper=v=>String(v??'').trim().toUpperCase()
  const color=v=>(upper(v)||'БЕЗ ЦВЕТА').replace(/[‐-‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
  const gender=v=>{
    const x=upper(v)
    if (x.includes('ЖЕН')) return 'ЖЕН'
    if (x.includes('МУЖ')) return 'МУЖ'
    return x
  }
  const size=v=>{
    const x=upper(v)
    return (!x || ['БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р'].includes(x)) ? '' : x
  }
  const category=(v,s)=>{
    const x=String(v??'').trim().toLowerCase()
    if (x==='child' || x==='детский' || x.includes('дет')) return 'child'
    const n=Number(String(s??'').trim())
    return Number.isInteger(n)&&n>=1&&n<=12 ? 'child' : 'adult'
  }
  const seen=new Map()
  for(const row of rows){
    const key=[Number(row.stock_position_id||0),category(row.category,row.size_label),gender(row.gender),color(row.color),size(row.size_label)].join('¦')
    const previous=seen.get(key)
    if (previous) throw new Error('Active semantic collision remains: '+previous+' / '+row.id+' key='+key)
    seen.set(key,Number(row.id))
  }
}

const mappings=query("SELECT source_variant_id,keeper_variant_id,status FROM catalog_semantic_variant_corrections WHERE correction_key='"+CORRECTION_KEY+"' ORDER BY source_variant_id")
const expectedMappings=[
  [480,1084],[1277,1438],[1278,1436],[1279,1441],[1303,1473],
]
assert(mappings.length===5,'Correction mapping count drifted')
for(let i=0;i<5;i++){
  assert(Number(mappings[i].source_variant_id)===expectedMappings[i][0] && Number(mappings[i].keeper_variant_id)===expectedMappings[i][1] && mappings[i].status==='completed','Correction mapping drifted at index '+i)
}

const baselineTime=query("SELECT MIN(captured_at) AS t FROM catalog_semantic_stock_correction_baseline WHERE correction_key='"+CORRECTION_KEY+"'")[0]?.t
assert(baselineTime==='2026-09-27 14:46:59','Unexpected immutable baseline timestamp: '+baselineTime)

const base1084=query("SELECT COALESCE(SUM(quantity_before),0) q,COALESCE(SUM(reserved_before),0) r FROM catalog_semantic_stock_correction_baseline WHERE correction_key='"+CORRECTION_KEY+"' AND inventory_source='warehouse' AND variant_id IN (480,1084)")[0]
const base1473=query("SELECT COALESCE(SUM(quantity_before),0) q,COALESCE(SUM(reserved_before),0) r FROM catalog_semantic_stock_correction_baseline WHERE correction_key='"+CORRECTION_KEY+"' AND inventory_source='warehouse' AND variant_id IN (1303,1473)")[0]
assert(Number(base1084.q)===9 && Number(base1084.r)===0,'480/1084 immutable baseline drifted')
assert(Number(base1473.q)===2 && Number(base1473.r)===1,'1303/1473 immutable baseline drifted')

const postBaselineMovements=query("SELECT id,variant_id,inventory_source,movement_type,quantity_delta,created_at FROM inventory_movements WHERE variant_id IN (1084,1438,1436,1441,1473) AND datetime(created_at) > datetime('"+baselineTime+"') ORDER BY datetime(created_at),id")
assert(postBaselineMovements.length===0,'New physical movements exist after correction baseline: '+JSON.stringify(postBaselineMovements))

const activeStocktakes=query('SELECT i.session_id,i.variant_id FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN ('+ALL_IDS.join(',')+') AND s.status="active"')
assert(activeStocktakes.length===0,'Active stocktake touches correction variants')

const sourceRefCounts=query(
  'SELECT '+
  '(SELECT COUNT(*) FROM order_items WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS order_items,'+
  '(SELECT COUNT(*) FROM inventory_movements WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS inventory_movements,'+
  '(SELECT COUNT(*) FROM workshop_tasks WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS workshop_tasks,'+
  '(SELECT COUNT(*) FROM inventory_reservations WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS inventory_reservations,'+
  '(SELECT COUNT(*) FROM catalog_input_aliases WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS catalog_input_aliases,'+
  '(SELECT COUNT(*) FROM inventory_lifecycle_events WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS inventory_lifecycle_events,'+
  '(SELECT COUNT(*) FROM inventory_transfer_items WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS inventory_transfer_items,'+
  '(SELECT COUNT(*) FROM inventory_stock_checks WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS inventory_stock_checks,'+
  '(SELECT COUNT(*) FROM inventory_operation_evidence WHERE variant_id IN ('+SOURCE_IDS.join(',')+')) AS inventory_operation_evidence'
)[0]
for(const [name,value] of Object.entries(sourceRefCounts)) assert(Number(value)===0,'Source canonical references remain in '+name+': '+value)

const sourceVariants=query('SELECT id,is_active FROM catalog_variants WHERE id IN ('+SOURCE_IDS.join(',')+') ORDER BY id')
assert(sourceVariants.length===5 && sourceVariants.every(r=>Number(r.is_active)===0),'A retired source variant is active')
assertNoActiveSemanticCollisions()
const hashesBefore=assertProtectedHistory()

const current=query("SELECT id,inventory_source,variant_id,quantity,reserved_quantity FROM inventory_stock WHERE id IN (304,724,1130,1336) ORDER BY id")
const byId=new Map(current.map(r=>[Number(r.id),r]))
function exact(id,variant,q,r){
  const row=byId.get(id)
  return row && row.inventory_source==='warehouse' && Number(row.variant_id)===variant && Number(row.quantity)===q && Number(row.reserved_quantity)===r
}
const alreadyRecovered = exact(304,480,0,0) && exact(724,1084,9,0) && exact(1130,1303,0,0) && exact(1336,1473,2,1)
const failedState = exact(304,480,0,0) && exact(724,1084,0,0) && exact(1130,1303,0,0) && exact(1336,1473,1,1)
assert(alreadyRecovered || failedState,'Production stock no longer matches either the exact failed state or exact recovered state: '+JSON.stringify(current))

const active1084=scalar("SELECT COALESCE(SUM(quantity),0) q FROM inventory_reservations WHERE status='active' AND inventory_source='warehouse' AND variant_id=1084",'q')
const active1473=scalar("SELECT COALESCE(SUM(quantity),0) q FROM inventory_reservations WHERE status='active' AND inventory_source='warehouse' AND variant_id=1473",'q')
assert(active1084===0 && active1473===1,'Active reservation truth drifted for recovery keepers')

mutate("CREATE TABLE IF NOT EXISTS catalog_semantic_stock_recoveries (recovery_key TEXT PRIMARY KEY,correction_key TEXT NOT NULL,baseline_captured_at TEXT NOT NULL,keeper_1084_before INTEGER NOT NULL,keeper_1084_after INTEGER NOT NULL,keeper_1473_before INTEGER NOT NULL,keeper_1473_after INTEGER NOT NULL,reason TEXT NOT NULL,recovered_at TEXT NOT NULL)",'ensure recovery audit table')

if (failedState) {
  const guard =
    "(SELECT COUNT(*) FROM catalog_semantic_variant_corrections WHERE correction_key='"+CORRECTION_KEY+"' AND status='completed')=5"+
    " AND (SELECT COUNT(*) FROM catalog_variants WHERE id IN (480,1277,1278,1279,1303) AND is_active=0)=5"+
    " AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE variant_id IN (1084,1438,1436,1441,1473) AND datetime(created_at) > datetime('"+baselineTime+"'))"+
    " AND NOT EXISTS (SELECT 1 FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN ("+ALL_IDS.join(',')+") AND s.status='active')"+
    " AND (SELECT COUNT(*) FROM inventory_stock WHERE id=304 AND variant_id=480 AND inventory_source='warehouse' AND quantity=0 AND reserved_quantity=0)=1"+
    " AND (SELECT COUNT(*) FROM inventory_stock WHERE id=724 AND variant_id=1084 AND inventory_source='warehouse' AND quantity=0 AND reserved_quantity=0)=1"+
    " AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1130 AND variant_id=1303 AND inventory_source='warehouse' AND quantity=0 AND reserved_quantity=0)=1"+
    " AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1336 AND variant_id=1473 AND inventory_source='warehouse' AND quantity=1 AND reserved_quantity=1)=1"+
    " AND (SELECT COALESCE(SUM(quantity_before),0) FROM catalog_semantic_stock_correction_baseline WHERE correction_key='"+CORRECTION_KEY+"' AND inventory_source='warehouse' AND variant_id IN (480,1084))=9"+
    " AND (SELECT COALESCE(SUM(quantity_before),0) FROM catalog_semantic_stock_correction_baseline WHERE correction_key='"+CORRECTION_KEY+"' AND inventory_source='warehouse' AND variant_id IN (1303,1473))=2"+
    " AND (SELECT COALESCE(SUM(quantity),0) FROM inventory_reservations WHERE status='active' AND inventory_source='warehouse' AND variant_id=1084)=0"+
    " AND (SELECT COALESCE(SUM(quantity),0) FROM inventory_reservations WHERE status='active' AND inventory_source='warehouse' AND variant_id=1473)=1"

  const update=mutate(
    "UPDATE inventory_stock SET quantity=CASE id WHEN 724 THEN 9 WHEN 1336 THEN 2 ELSE quantity END,"+
    "reserved_quantity=CASE id WHEN 724 THEN 0 WHEN 1336 THEN 1 ELSE reserved_quantity END,"+
    "last_action='Восстановление после semantic SKU merge',"+
    "last_source_ref='"+RECOVERY_KEY+"',updated_at=CURRENT_TIMESTAMP "+
    "WHERE id IN (724,1336) AND "+guard,
    'restore lost Production physical stock'
  )
  assert(Number(update.meta.changes||0)===2,'Recovery stale guard did not update exactly two keeper rows')
}

const finalRows=query("SELECT id,inventory_source,variant_id,quantity,reserved_quantity FROM inventory_stock WHERE id IN (304,724,1130,1336) ORDER BY id")
const finalById=new Map(finalRows.map(r=>[Number(r.id),r]))
assert(Number(finalById.get(304)?.quantity)===0 && Number(finalById.get(304)?.reserved_quantity)===0,'Source 480 current row is not neutral')
assert(Number(finalById.get(724)?.quantity)===9 && Number(finalById.get(724)?.reserved_quantity)===0,'Keeper 1084 was not restored to Physical 9 / Reserved 0')
assert(Number(finalById.get(1130)?.quantity)===0 && Number(finalById.get(1130)?.reserved_quantity)===0,'Source 1303 current row is not neutral')
assert(Number(finalById.get(1336)?.quantity)===2 && Number(finalById.get(1336)?.reserved_quantity)===1,'Keeper 1473 was not restored to Physical 2 / Reserved 1')

mutate(
  "INSERT OR IGNORE INTO catalog_semantic_stock_recoveries(recovery_key,correction_key,baseline_captured_at,keeper_1084_before,keeper_1084_after,keeper_1473_before,keeper_1473_after,reason,recovered_at) VALUES ("+
  "'"+RECOVERY_KEY+"','"+CORRECTION_KEY+"','"+baselineTime+"',0,9,1,2,'Recover immutable pre-correction Physical lost by self-referential merge UPDATE',CURRENT_TIMESTAMP)",
  'record recovery audit'
)
const audit=query("SELECT * FROM catalog_semantic_stock_recoveries WHERE recovery_key='"+RECOVERY_KEY+"'")
assert(audit.length===1,'Recovery audit row missing')

assertNoActiveSemanticCollisions()
const hashesAfter=assertProtectedHistory()
assert(JSON.stringify(hashesAfter)===JSON.stringify(hashesBefore),'Protected-history hashes changed during recovery')

console.log('PRODUCTION_STOCK_RECOVERY_COMPLETE',JSON.stringify({
  recoveryKey:RECOVERY_KEY,
  baselineTime,
  recovered:failedState,
  finalRows,
  activeReservations:{keeper1084:active1084,keeper1473:active1473},
  protectedHashes:hashesAfter,
},null,2))

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const db = process.env.CORRECTION_DB
const correctionKey = process.env.CORRECTION_KEY || 'semantic-sku-20260927-r1'
const pairs = JSON.parse(process.env.CORRECTION_PAIRS || '[]')
if (!db || !pairs.length) throw new Error('Missing correction configuration')

const clean = v => String(v ?? '').trim()
const upper = v => clean(v).toUpperCase()
const normColor = v => (upper(v) || 'БЕЗ ЦВЕТА').replace(/[‐-‒–—-]+/g, ' ').replace(/\s+/g, ' ').trim()
const normGender = v => {
  const x = upper(v)
  if (x.includes('ЖЕН')) return 'ЖЕН'
  if (x.includes('МУЖ')) return 'МУЖ'
  return x
}
const normSize = v => {
  const x = upper(v)
  return (!x || ['БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р'].includes(x)) ? '' : x
}
const normCategory = (v,size) => {
  const x = clean(v).toLowerCase()
  if (x === 'child' || x === 'детский' || x.includes('дет')) return 'child'
  const n = Number(clean(size))
  return Number.isInteger(n) && n >= 1 && n <= 12 ? 'child' : 'adult'
}
const semKey = r => [Number(r.stock_position_id || 0), normCategory(r.category,r.size_label), normGender(r.gender), normColor(r.color), normSize(r.size_label)].join('¦')
const quote = v => "'" + String(v ?? '').replaceAll("'","''") + "'"
const hash = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')

function call(sql) {
  const raw = execFileSync('npx', ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--command',sql,'--json'], {
    encoding:'utf8', maxBuffer:64*1024*1024
  })
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed[0] || !Array.isArray(parsed[0].results)) throw new Error('Unexpected D1 response')
  return { rows: parsed[0].results, meta: parsed[0].meta || {} }
}
function query(sql) {
  const r = call(sql)
  if (Number(r.meta.changes || 0) !== 0 || Number(r.meta.rows_written || 0) !== 0) throw new Error('Read unexpectedly wrote rows')
  return r.rows
}
function mutate(sql,label) {
  const r = call(sql)
  console.log(label, JSON.stringify({changes:Number(r.meta.changes||0),rows_written:Number(r.meta.rows_written||0)}))
  return r
}

const ids = [...new Set(pairs.flatMap(p => [Number(p.source),Number(p.keeper)]))].sort((a,b)=>a-b)
const sourceIds = pairs.map(p => Number(p.source))
const idsSql = ids.join(',')
const sourceSql = sourceIds.join(',')

function loadVariants() {
  return query('SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,v.color,v.size_label,v.material,v.length,v.is_active,p.name AS product_name ' +
    'FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id IN (' + idsSql + ') ORDER BY v.id')
}
function activeCollisions() {
  const rows = query('SELECT id,product_id,stock_position_id,category,gender,color,size_label FROM catalog_variants WHERE is_active=1 AND stock_position_id IS NOT NULL ORDER BY id')
  const groups = new Map()
  for (const row of rows) {
    const key = semKey(row)
    if (!groups.has(key)) groups.set(key,[])
    groups.get(key).push(Number(row.id))
  }
  return [...groups.entries()].filter(([,x])=>x.length>1).map(([key,x])=>({key,ids:x.sort((a,b)=>a-b)}))
}

const beforeVariants = loadVariants()
const byId = new Map(beforeVariants.map(r => [Number(r.id),r]))
const expectedPending = []
for (const p of pairs) {
  const s=byId.get(Number(p.source)), k=byId.get(Number(p.keeper))
  if (!s || !k) throw new Error('Missing mapping row ' + p.source + '->' + p.keeper)
  if (Number(s.product_id)!==Number(k.product_id) || Number(s.stock_position_id)!==Number(k.stock_position_id) || semKey(s)!==semKey(k)) {
    throw new Error('Semantic mapping mismatch ' + p.source + '->' + p.keeper)
  }
  if (Number(k.is_active)!==1) throw new Error('Keeper inactive ' + p.keeper)
  if (normColor(k.color)!==upper(k.color || 'БЕЗ ЦВЕТА').replace(/\s+/g,' ').trim()) throw new Error('Keeper color is not stable ' + p.keeper)
  if (normSize(k.size_label)!==upper(k.size_label)) throw new Error('Keeper size is not stable ' + p.keeper)
  if (Number(s.is_active)===1) expectedPending.push({key:semKey(s),ids:[Number(p.source),Number(p.keeper)].sort((a,b)=>a-b)})
}
const collisionsBefore = activeCollisions()
if (JSON.stringify(collisionsBefore)!==JSON.stringify(expectedPending.sort((a,b)=>a.key.localeCompare(b.key)))) {
  const a=[...collisionsBefore].sort((x,y)=>x.key.localeCompare(y.key))
  const b=[...expectedPending].sort((x,y)=>x.key.localeCompare(y.key))
  if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error('Active semantic collision set drifted: ' + JSON.stringify({actual:a,expected:b}))
}

const blockers = query(
  'SELECT v.id,' +
  'COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status="active"),0) AS active_reservations,' +
  'COALESCE((SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id=v.id AND COALESCE(o.order_status,"active")="active" AND COALESCE(o.shipping_status,"not_sent")<>"sent"),0) AS open_unsent,' +
  'COALESCE((SELECT COUNT(*) FROM workshop_tasks wt WHERE wt.variant_id=v.id AND wt.status IN ("active","ready")),0) AS open_workshop,' +
  'COALESCE((SELECT COUNT(*) FROM inventory_lifecycle_events le WHERE le.variant_id=v.id AND le.status="pending"),0) AS pending_lifecycle ' +
  'FROM catalog_variants v WHERE v.id IN (' + sourceSql + ') ORDER BY v.id'
)
if (blockers.some(r=>Number(r.active_reservations)||Number(r.open_unsent)||Number(r.open_workshop)||Number(r.pending_lifecycle))) {
  throw new Error('Source variant has live work: ' + JSON.stringify(blockers))
}
const activeStocktake = query('SELECT i.session_id,i.variant_id FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN (' + idsSql + ') AND s.status="active"')
if (activeStocktake.length) throw new Error('Active stocktake touches correction variants')

for (const p of pairs) {
  const c = query('SELECT a.transfer_id FROM inventory_transfer_items a JOIN inventory_transfer_items b ON b.transfer_id=a.transfer_id AND b.variant_id=' + Number(p.keeper) + ' WHERE a.variant_id=' + Number(p.source) + ' LIMIT 1')
  if (c.length) throw new Error('Same transfer contains both variants for ' + p.source + '->' + p.keeper)
}

const stockBefore = query('SELECT id,inventory_source,product_id,variant_id,quantity,reserved_quantity,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,last_action,last_source_ref FROM inventory_stock WHERE variant_id IN (' + idsSql + ') ORDER BY inventory_source,variant_id,id')
const stockMap = new Map(stockBefore.map(r=>[Number(r.variant_id)+'¦'+r.inventory_source,r]))
for (const p of pairs) {
  for (const src of ['warehouse','boutique']) {
    const s=stockMap.get(Number(p.source)+'¦'+src), k=stockMap.get(Number(p.keeper)+'¦'+src)
    if (s && !k && (Number(s.quantity||0)!==0 || Number(s.reserved_quantity||0)!==0)) throw new Error('Nonzero source-only stock ' + p.source + ' ' + src)
    const stockReserved=Number(s?.reserved_quantity||0)+Number(k?.reserved_quantity||0)
    const rr=query('SELECT COALESCE(SUM(quantity),0) AS q FROM inventory_reservations WHERE status="active" AND inventory_source=' + quote(src) + ' AND variant_id IN (' + Number(p.source) + ',' + Number(p.keeper) + ')')[0]
    if (stockReserved!==Number(rr?.q||0)) throw new Error('Reserved truth mismatch ' + p.source + '->' + p.keeper + ' ' + src)
  }
}

const protectedBefore = {
  orders: query('SELECT id,order_id,product_id,product_name_snapshot,audience_type,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,source_type,is_workshop FROM order_items WHERE variant_id IN ('+idsSql+') ORDER BY id'),
  movements: query('SELECT id,inventory_source,product_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,movement_type,quantity_delta,quantity_after,reference_type,reference_id,created_at FROM inventory_movements WHERE variant_id IN ('+idsSql+') ORDER BY id'),
  stocktakes: query('SELECT id,session_id,stock_id,product_id,variant_id,product_name_snapshot,category_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,opening_quantity,opening_reserved_quantity,baseline_quantity,counted_quantity,counted_at,status,conflict_quantity,applied_quantity,created_at,updated_at FROM inventory_stocktake_items WHERE variant_id IN ('+idsSql+') ORDER BY id'),
  transfers: query('SELECT id,transfer_id,product_id,quantity,from_quantity_before,from_quantity_after,to_quantity_before,to_quantity_after,source_reserved_quantity,source_shortage_after,created_at FROM inventory_transfer_items WHERE variant_id IN ('+idsSql+') ORDER BY id')
}
const protectedHashes=Object.fromEntries(Object.entries(protectedBefore).map(([k,v])=>[k,hash(v)]))
console.log('PRE_CORRECTION',JSON.stringify({pairs,collisionsBefore,blockers,stockBefore:stockBefore.map(r=>({id:r.id,source:r.inventory_source,variant:r.variant_id,q:r.quantity,r:r.reserved_quantity})),protectedHashes},null,2))

mutate('CREATE TABLE IF NOT EXISTS catalog_semantic_variant_corrections (correction_key TEXT NOT NULL,source_variant_id INTEGER NOT NULL,keeper_variant_id INTEGER NOT NULL,semantic_key TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ("pending","completed")),started_at TEXT NOT NULL,completed_at TEXT,PRIMARY KEY(correction_key,source_variant_id))','create correction audit')
mutate('CREATE TABLE IF NOT EXISTS catalog_semantic_stock_correction_baseline (correction_key TEXT NOT NULL,stock_id INTEGER NOT NULL,inventory_source TEXT NOT NULL,variant_id INTEGER NOT NULL,quantity_before INTEGER NOT NULL,reserved_before INTEGER NOT NULL,product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,last_action TEXT,last_source_ref TEXT,captured_at TEXT NOT NULL,PRIMARY KEY(correction_key,stock_id))','create stock baseline')

for (const p of pairs) {
  const s=byId.get(Number(p.source))
  mutate('INSERT OR IGNORE INTO catalog_semantic_variant_corrections(correction_key,source_variant_id,keeper_variant_id,semantic_key,status,started_at) VALUES ('+quote(correctionKey)+','+Number(p.source)+','+Number(p.keeper)+','+quote(semKey(s))+',"pending",CURRENT_TIMESTAMP)','record mapping '+p.source+'->'+p.keeper)
}
mutate('INSERT OR IGNORE INTO catalog_semantic_stock_correction_baseline(correction_key,stock_id,inventory_source,variant_id,quantity_before,reserved_before,product_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,last_action,last_source_ref,captured_at) SELECT '+quote(correctionKey)+',id,inventory_source,variant_id,COALESCE(quantity,0),COALESCE(reserved_quantity,0),product_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,last_action,last_source_ref,CURRENT_TIMESTAMP FROM inventory_stock WHERE variant_id IN ('+idsSql+')','capture stock baseline')

const refTables=['order_items','inventory_movements','workshop_tasks','inventory_reservations','catalog_input_aliases','inventory_lifecycle_events','inventory_transfer_items','inventory_stock_checks','inventory_operation_evidence']
for (const p of pairs) {
  mutate('UPDATE catalog_variants SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id='+Number(p.source)+' AND is_active=1','retire source '+p.source)
  for (const src of ['warehouse','boutique']) {
    const s=stockMap.get(Number(p.source)+'¦'+src), k=stockMap.get(Number(p.keeper)+'¦'+src)
    if (s && k) {
      const sql='WITH totals AS (SELECT COALESCE(SUM(quantity),0) AS tq,COALESCE(SUM(reserved_quantity),0) AS tr FROM inventory_stock WHERE inventory_source='+quote(src)+' AND variant_id IN ('+Number(p.source)+','+Number(p.keeper)+')) ' +
        'UPDATE inventory_stock SET quantity=CASE WHEN variant_id='+Number(p.keeper)+' THEN (SELECT tq FROM totals) ELSE 0 END,' +
        'reserved_quantity=CASE WHEN variant_id='+Number(p.keeper)+' THEN (SELECT tr FROM totals) ELSE 0 END,' +
        'last_action=CASE WHEN variant_id='+Number(p.source)+' THEN "semantic SKU merge" ELSE last_action END,' +
        'last_source_ref=CASE WHEN variant_id='+Number(p.source)+' THEN '+quote('catalog-semantic-merge:'+p.source+'->'+p.keeper)+' ELSE last_source_ref END,updated_at=CURRENT_TIMESTAMP ' +
        'WHERE inventory_source='+quote(src)+' AND variant_id IN ('+Number(p.source)+','+Number(p.keeper)+')'
      mutate(sql,'merge stock '+p.source+'->'+p.keeper+' '+src)
    }
  }
  for (const table of refTables) mutate('UPDATE '+table+' SET variant_id='+Number(p.keeper)+' WHERE variant_id='+Number(p.source),'repoint '+table+' '+p.source+'->'+p.keeper)
  mutate('UPDATE inventory_stock SET product_id=(SELECT product_id FROM catalog_variants WHERE id='+Number(p.keeper)+'),' +
    'product_name_snapshot=(SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id='+Number(p.keeper)+'),' +
    'gender_snapshot=(SELECT NULLIF(gender,"") FROM catalog_variants WHERE id='+Number(p.keeper)+'),' +
    'color_snapshot=(SELECT NULLIF(color,"") FROM catalog_variants WHERE id='+Number(p.keeper)+'),' +
    'material_snapshot=(SELECT NULLIF(material,"") FROM catalog_variants WHERE id='+Number(p.keeper)+'),' +
    'length_snapshot=(SELECT NULLIF(length,"") FROM catalog_variants WHERE id='+Number(p.keeper)+'),' +
    'size_snapshot=(SELECT NULLIF(size_label,"") FROM catalog_variants WHERE id='+Number(p.keeper)+'),' +
    'reserved_quantity=COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id='+Number(p.keeper)+' AND r.inventory_source=inventory_stock.inventory_source AND r.status="active"),0),updated_at=CURRENT_TIMESTAMP WHERE variant_id='+Number(p.keeper),'refresh keeper '+p.keeper)
  mutate('INSERT OR IGNORE INTO catalog_identity_variant_merges(old_variant_id,keeper_variant_id,reason,merged_at) VALUES ('+Number(p.source)+','+Number(p.keeper)+','+quote('semantic SKU identity correction: punctuation/empty-size equivalent')+',CURRENT_TIMESTAMP)','record canonical merge '+p.source+'->'+p.keeper)
  const mh=query('SELECT keeper_variant_id FROM catalog_identity_variant_merges WHERE old_variant_id='+Number(p.source)+' LIMIT 1')[0]
  if (!mh || Number(mh.keeper_variant_id)!==Number(p.keeper)) throw new Error('Merge history conflict '+p.source+'->'+p.keeper)
  mutate('UPDATE catalog_semantic_variant_corrections SET status="completed",completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP) WHERE correction_key='+quote(correctionKey)+' AND source_variant_id='+Number(p.source)+' AND keeper_variant_id='+Number(p.keeper),'complete mapping '+p.source+'->'+p.keeper)
}

const afterVariants=loadVariants()
for (const p of pairs) {
  const s=afterVariants.find(r=>Number(r.id)===Number(p.source)), k=afterVariants.find(r=>Number(r.id)===Number(p.keeper))
  if (!s || Number(s.is_active)!==0 || !k || Number(k.is_active)!==1) throw new Error('Variant status verification failed '+p.source+'->'+p.keeper)
}
for (const table of refTables) {
  const n=Number(query('SELECT COUNT(*) AS c FROM '+table+' WHERE variant_id IN ('+sourceSql+')')[0]?.c||0)
  if (n!==0) throw new Error('Source references remain in '+table+': '+n)
}

const stockAfter=query('SELECT id,inventory_source,product_id,variant_id,quantity,reserved_quantity,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot FROM inventory_stock WHERE variant_id IN ('+idsSql+') ORDER BY inventory_source,variant_id,id')
for (const p of pairs) {
  for (const src of ['warehouse','boutique']) {
    const b=stockBefore.filter(r=>r.inventory_source===src && [Number(p.source),Number(p.keeper)].includes(Number(r.variant_id))).reduce((x,r)=>x+Number(r.quantity||0),0)
    const a=stockAfter.filter(r=>r.inventory_source===src && [Number(p.source),Number(p.keeper)].includes(Number(r.variant_id))).reduce((x,r)=>x+Number(r.quantity||0),0)
    if (a!==b) throw new Error('Physical total changed '+p.source+'->'+p.keeper+' '+src+': '+b+'->'+a)
    if (stockAfter.filter(r=>r.inventory_source===src && Number(r.variant_id)===Number(p.source)).some(r=>Number(r.quantity||0)!==0 || Number(r.reserved_quantity||0)!==0)) throw new Error('Retired source still carries stock '+p.source+' '+src)
    const sr=stockAfter.filter(r=>r.inventory_source===src && Number(r.variant_id)===Number(p.keeper)).reduce((x,r)=>x+Number(r.reserved_quantity||0),0)
    const ar=Number(query('SELECT COALESCE(SUM(quantity),0) AS q FROM inventory_reservations WHERE status="active" AND inventory_source='+quote(src)+' AND variant_id='+Number(p.keeper))[0]?.q||0)
    if (sr!==ar) throw new Error('Reserved mismatch after correction '+p.keeper+' '+src)
  }
}

const protectedAfter = {
  orders: query('SELECT id,order_id,product_id,product_name_snapshot,audience_type,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,source_type,is_workshop FROM order_items WHERE variant_id IN ('+idsSql+') ORDER BY id'),
  movements: query('SELECT id,inventory_source,product_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,movement_type,quantity_delta,quantity_after,reference_type,reference_id,created_at FROM inventory_movements WHERE variant_id IN ('+idsSql+') ORDER BY id'),
  stocktakes: query('SELECT id,session_id,stock_id,product_id,variant_id,product_name_snapshot,category_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,opening_quantity,opening_reserved_quantity,baseline_quantity,counted_quantity,counted_at,status,conflict_quantity,applied_quantity,created_at,updated_at FROM inventory_stocktake_items WHERE variant_id IN ('+idsSql+') ORDER BY id'),
  transfers: query('SELECT id,transfer_id,product_id,quantity,from_quantity_before,from_quantity_after,to_quantity_before,to_quantity_after,source_reserved_quantity,source_shortage_after,created_at FROM inventory_transfer_items WHERE variant_id IN ('+idsSql+') ORDER BY id')
}
for (const [name,rows] of Object.entries(protectedAfter)) if (hash(rows)!==protectedHashes[name]) throw new Error('Protected historical facts changed: '+name)

const finalCollisions=activeCollisions()
if (finalCollisions.length) throw new Error('Active semantic collisions remain: '+JSON.stringify(finalCollisions))
console.log('CORRECTION_COMPLETE',JSON.stringify({pairs,stockAfter:stockAfter.map(r=>({id:r.id,source:r.inventory_source,variant:r.variant_id,q:r.quantity,r:r.reserved_quantity})),protectedHashes},null,2))

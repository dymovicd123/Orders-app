// READ ONLY. Reconstruct actual stock after each SKU's last completed revision.
// Historical absolute manual adjustments are hard authority fences. Never change D1 here.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const config = fs.readFileSync('wrangler.jsonc','utf8')
assert.ok(config.includes('orders_db_prod') && config.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4') && !config.includes('orders_db_branch2'),'Refusing a non-production or mixed D1 binding')
assert.ok(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID,'Cloudflare read-only diagnostic credentials unavailable')
function select(label,sql) {
  assert.match(sql.trim(), /^(SELECT|WITH)\s/i)
  const noStrings=sql.replace(/'[^']*'/g,"''")
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(noStrings),'READ-ONLY invariant violated: '+label)
  const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config','wrangler.jsonc','--command',sql,'--json'],{encoding:'utf8',maxBuffer:20_000_000,timeout:100000})
  const first=raw.indexOf('['), json=JSON.parse(raw.slice(first))
  const rows=json[0]?.results
  if(!Array.isArray(rows))throw Error('No D1 result: '+label+': '+raw.slice(0,300))
  console.log('QUERY '+label+' '+rows.length+' rows')
  return rows
}
const stats=select('operation_types',`
 SELECT m.inventory_source AS source,m.reference_type AS reference_type,m.movement_type AS movement_type,
 COUNT(*) AS n, SUM(CASE WHEN m.quantity_delta < 0 THEN 1 ELSE 0 END) AS negatives
 FROM inventory_movements m WHERE m.created_at >= '2026-08-01'
 GROUP BY m.inventory_source,m.reference_type,m.movement_type
 ORDER BY n DESC LIMIT 70`)
console.log('STATS '+JSON.stringify(stats))
const revisions=select('revisions',`
 SELECT inventory_source AS source,status,
 CASE WHEN id LIKE 'REV-%-F-%' THEN 'full' WHEN id LIKE 'REV-%-P-%' THEN 'selective' ELSE 'other' END AS scope,
 COUNT(*) AS n, MAX(completed_at) AS latest
 FROM inventory_stocktake_sessions
 GROUP BY inventory_source,status,scope ORDER BY source,scope,status`)
console.log('REVISION_SESSIONS '+JSON.stringify(revisions))
const candidates=select('exposed_stock',`
 WITH lastrev AS (
  SELECT inventory_source AS source,variant_id,MAX(id) AS revision_id
  FROM inventory_movements
  WHERE reference_type='stocktake' AND movement_type='manual_set' AND variant_id IS NOT NULL
  GROUP BY inventory_source,variant_id
 ), suspect AS (
  SELECT m.inventory_source AS source,m.variant_id,
         COUNT(*) AS bad_count,
         SUM(CASE WHEN m.quantity_delta < 0 THEN 1 ELSE 0 END) AS downward,
         SUM(CASE WHEN m.quantity_delta > 0 THEN 1 ELSE 0 END) AS upward,
         MAX(m.id) AS latest_suspect
  FROM inventory_movements m
  JOIN lastrev r ON r.source=m.inventory_source AND r.variant_id=m.variant_id AND m.id>r.revision_id
  WHERE m.reference_type IN ('order_observation','shipping_observation','manual_observation')
  GROUP BY m.inventory_source,m.variant_id
 )
 SELECT s.inventory_source AS source,s.variant_id,s.id AS stock_id,s.quantity AS current,
 s.reserved_quantity AS reserved,s.last_action,s.last_source_ref,s.updated_at,
 p.name AS product,v.color,v.size_label AS size,v.material,v.length,v.is_active AS active,
 r.revision_id, rv.created_at AS revision_at, rv.quantity_after AS revision_quantity,
 sc.bad_count,sc.downward,sc.upward,sc.latest_suspect,
 (SELECT MAX(x.id) FROM inventory_movements x WHERE x.inventory_source=s.inventory_source AND x.variant_id=s.variant_id AND
 x.id>r.revision_id AND ( (x.movement_type='manual_set' AND x.reference_type IN ('manual','stocktake')) OR
 (x.movement_type='revision' AND x.reference_type IN ('quick_stocktake','transfer_stocktake')) )) AS later_explicit_id,
 (SELECT COUNT(*) FROM inventory_movements x WHERE x.inventory_source=s.inventory_source AND x.variant_id=s.variant_id AND x.id>sc.latest_suspect AND x.movement_type IN ('sale','return','writeoff','arrival')) AS physical_events_after
 FROM suspect sc
 JOIN lastrev r ON r.source=sc.source AND r.variant_id=sc.variant_id
 JOIN inventory_stock s ON s.inventory_source=sc.source AND s.variant_id=sc.variant_id
 JOIN catalog_variants v ON v.id=s.variant_id JOIN catalog_products p ON p.id=v.product_id
 LEFT JOIN inventory_movements rv ON rv.id=r.revision_id
 ORDER BY sc.bad_count DESC, sc.downward DESC,sc.source,sc.variant_id LIMIT 500`)
console.log('EXPOSED '+candidates.length)
const evidence=select('post_revision_events',`
 WITH lastrev AS (
  SELECT inventory_source AS source,variant_id,MAX(id) AS revision_id
  FROM inventory_movements WHERE reference_type='stocktake' AND movement_type='manual_set' AND variant_id IS NOT NULL
  GROUP BY inventory_source,variant_id
 ), exposed AS (
  SELECT DISTINCT m.inventory_source AS source,m.variant_id,r.revision_id
  FROM inventory_movements m JOIN lastrev r ON r.source=m.inventory_source AND r.variant_id=m.variant_id
  WHERE m.id>r.revision_id AND m.reference_type IN ('order_observation','shipping_observation','manual_observation')
 )
 SELECT m.id,m.inventory_source AS source,m.variant_id,m.created_at,m.movement_type AS type,
 m.reference_type AS ref_type,m.reference_id AS ref_id,m.quantity_delta AS delta,m.quantity_after AS after,m.comment
 FROM exposed e JOIN inventory_movements m ON m.inventory_source=e.source AND m.variant_id=e.variant_id AND m.id>=e.revision_id
 ORDER BY m.inventory_source,m.variant_id,m.id LIMIT 7500`)
const events=new Map()
for(const m of evidence){const k=m.source+':'+m.variant_id;if(!events.has(k))events.set(k,[]);events.get(k).push(m)}
let outcome={possibly_wrong:[],protected_by_later_explicit:[],unverifiable:[],unchanged_or_reconciled:[],clean_replay_candidate:[]}
const suspicious = new Set(['order_observation','shipping_observation','manual_observation'])
const physicalTypes = new Set(['sale','return','arrival','writeoff','transfer_in','transfer_out','delete','manual_set','revision'])
for(const c of candidates){
  const ev=events.get(c.source+':'+c.variant_id)||[]
  const revIndex=ev.findIndex(e=>e.id===c.revision_id)
  const afterRev=revIndex>=0?ev.slice(revIndex+1):[]
  const explicit=afterRev.filter(e=>(e.type==='manual_set' && ['manual','stocktake'].includes(e.ref_type)) || (e.type==='revision' && ['quick_stocktake','transfer_stocktake'].includes(e.ref_type)))
  const lastExplicit=explicit.at(-1)
  const segment=afterRev.filter(e=>!lastExplicit || e.id>lastExplicit.id)
  const start=lastExplicit ? lastExplicit.after : c.revision_quantity
  let projection=start, gaps=[], unknown=[],suspects=[],floorEvents=[]
  let previous= start
  for(const e of segment){
    const before=e.after-e.delta
    if(before!==previous)gaps.push({id:e.id,before,previous})
    previous=e.after
    if(suspicious.has(e.ref_type))suspects.push({id:e.id,d:e.delta,after:e.after,ref:e.ref_type})
    else if(physicalTypes.has(e.type)){
      projection+=e.delta
      if(projection<0)floorEvents.push({id:e.id,at:projection})
    } else unknown.push({id:e.id,type:e.type,ref:e.ref_type})
  }
  const record={
    source:c.source,stockId:c.stock_id,variant:c.variant_id,product:c.product,color:c.color,size:c.size,
    material:c.material,length:c.length,revision:c.revision_id,revisionAt:c.revision_at,revisionQuantity:c.revision_quantity,
    current:c.current,reserved:c.reserved,projected:projection,discrepancy:c.current-projection,
    suspects,suspectsSinceLastExplicit:suspects.length,
    latestExplicit:lastExplicit?{id:lastExplicit.id,type:lastExplicit.type,after:lastExplicit.after,ref:lastExplicit.ref_type}:null,
    gapCount:gaps.length,gaps:gaps.slice(0,4),unknown:unknown.slice(0,5),floorEvents:floorEvents.slice(0,5),
    physicallyMovedAfterSuspect:c.physical_events_after, lastSourceRef:c.last_source_ref,
    timeline:segment.slice(-12).map(e=>[e.id,e.type,e.ref_type,e.delta,e.after])
  }
  if(lastExplicit && c.later_explicit_id>c.latest_suspect)outcome.protected_by_later_explicit.push(record)
  else if(!segment.length || (!suspects.length && c.current===projection))outcome.unchanged_or_reconciled.push(record)
  else if(gaps.length||unknown.length||floorEvents.length||c.active!==1||!Number.isInteger(projection)||projection<0)outcome.unverifiable.push(record)
  else if(c.current!==projection && suspects.length)outcome.clean_replay_candidate.push(record)
  else outcome.unchanged_or_reconciled.push(record)
}
for(const [key,rows] of Object.entries(outcome)){
 console.log('CATEGORY '+key+' COUNT '+rows.length)
 for(const row of rows.slice(0,key==='clean_replay_candidate'?120:35))console.log('ROW '+key+' '+JSON.stringify(row))
}
console.log('SUMMARY '+JSON.stringify(Object.fromEntries(Object.entries(outcome).map(([k,v])=>[k,v.length]))))
console.log('AUDIT COMPLETE. ZERO WRITES PERFORMED.')


const journalMismatches=select('journal_current_mismatches',`
 WITH last_move AS (
  SELECT m.inventory_source AS source,m.variant_id,MAX(m.id) AS latest_id
  FROM inventory_movements m
  WHERE m.variant_id IS NOT NULL
  GROUP BY m.inventory_source,m.variant_id
 )
 SELECT s.id AS stock_id,s.inventory_source AS source,s.variant_id,s.quantity AS current,
 s.reserved_quantity AS reserved,s.last_action,s.last_source_ref,s.updated_at,
 m.id AS last_movement_id,m.quantity_after AS journal_after,m.movement_type AS journal_type,
 m.reference_type AS journal_reference_type,m.created_at AS journal_at,
 p.name AS product,v.color,v.size_label AS size
 FROM inventory_stock s
 LEFT JOIN last_move lm ON lm.source=s.inventory_source AND lm.variant_id=s.variant_id
 LEFT JOIN inventory_movements m ON m.id=lm.latest_id
 LEFT JOIN catalog_variants v ON v.id=s.variant_id
 LEFT JOIN catalog_products p ON p.id=v.product_id
 WHERE s.variant_id IS NOT NULL AND m.id IS NOT NULL AND s.quantity <> m.quantity_after
 ORDER BY ABS(s.quantity-m.quantity_after) DESC,s.id LIMIT 350`)
console.log('JOURNAL_MISMATCHES '+JSON.stringify(journalMismatches))
const untrackedStock=select('positive_stock_without_movement',`
 WITH last_move AS (
  SELECT m.inventory_source AS source,m.variant_id,MAX(m.id) AS latest_id
  FROM inventory_movements m WHERE m.variant_id IS NOT NULL GROUP BY m.inventory_source,m.variant_id
 )
 SELECT s.id AS stock_id,s.inventory_source AS source,s.variant_id,s.quantity AS current,s.reserved_quantity AS reserved,
 s.last_action,s.last_source_ref,s.updated_at,p.name AS product,v.color,v.size_label AS size
 FROM inventory_stock s
 LEFT JOIN last_move lm ON lm.source=s.inventory_source AND lm.variant_id=s.variant_id
 LEFT JOIN catalog_variants v ON v.id=s.variant_id LEFT JOIN catalog_products p ON p.id=v.product_id
 WHERE s.variant_id IS NOT NULL AND lm.latest_id IS NULL AND (s.quantity <> 0 OR s.reserved_quantity<>0)
 ORDER BY ABS(s.quantity) DESC LIMIT 150`)
console.log('UNTRACKED '+JSON.stringify(untrackedStock))
const reserveMismatches=select('reservation_cache_mismatches',`
 WITH actual AS (
 SELECT inventory_source AS source,variant_id,SUM(quantity) AS amount FROM inventory_reservations WHERE status='active'
 GROUP BY inventory_source,variant_id
 )
 SELECT s.id AS stock_id,s.inventory_source AS source,s.variant_id,s.quantity AS physical,
 s.reserved_quantity AS cached_reserved,COALESCE(a.amount,0) AS active_reserved,
 p.name AS product,v.color,v.size_label AS size,s.last_source_ref
 FROM inventory_stock s LEFT JOIN actual a ON a.source=s.inventory_source AND a.variant_id=s.variant_id
 LEFT JOIN catalog_variants v ON v.id=s.variant_id LEFT JOIN catalog_products p ON p.id=v.product_id
 WHERE s.variant_id IS NOT NULL AND COALESCE(s.reserved_quantity,0)<>COALESCE(a.amount,0)
 ORDER BY ABS(s.reserved_quantity-COALESCE(a.amount,0)) DESC,s.id LIMIT 150`)
console.log('RESERVATION_CACHE_MISMATCHES '+JSON.stringify(reserveMismatches))
const duplicateStock=select('duplicate_stock_variants',`
 SELECT inventory_source AS source,variant_id,COUNT(*) AS n,SUM(quantity) AS physical,SUM(reserved_quantity) AS reserved
 FROM inventory_stock WHERE variant_id IS NOT NULL GROUP BY inventory_source,variant_id
 HAVING COUNT(*)>1 ORDER BY n DESC LIMIT 150`)
console.log('DUPLICATE_STOCK '+JSON.stringify(duplicateStock))
const novelTypes=stats.filter(s=>s.reference_type==='order_handover_correction'||s.reference_type==='transfer_stocktake'||s.reference_type==='shipping_observation'||s.reference_type==='manual_observation')
console.log('OTHER_POTENTIALLY_UNTRUSTED_TYPES '+JSON.stringify(novelTypes))
console.log('AUDIT SECOND PASS COMPLETE. ZERO WRITES PERFORMED.')

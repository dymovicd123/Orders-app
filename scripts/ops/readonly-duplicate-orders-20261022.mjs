// Fixed-scope, SELECT-only audit for two suspicious 2026-10-13 orders.
// No D1 writes, no migration, no remote worker deployment.
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
const expected='audit/readonly-duplicate-orders-20261022'
if(process.env.GITHUB_REF_NAME!==expected||process.env.GITHUB_REPOSITORY!=='dymovicd123/Orders-app')throw Error('Wrong audit ref')
const cfg=readFileSync('wrangler.jsonc','utf8')
if(!cfg.includes('"name": "orders-app"')||!cfg.includes('"database_name": "orders_db_prod"')||!cfg.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"')||cfg.includes('orders_db_branch2'))throw Error('Production identity mismatch')
function query(sql){
 if(!/^\s*SELECT\s/i.test(sql)||/;|\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|ATTACH|DETACH|VACUUM|EXECUTE)\b/i.test(sql))throw Error('NOT A FIXED READ-ONLY SELECT')
 const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config','wrangler.jsonc','--command='+sql,'--json'],{encoding:'utf8',timeout:90000,maxBuffer:5*1024*1024})
 const data=JSON.parse(raw);if(!Array.isArray(data)||data[0]?.success!==true)throw Error('Failed production read')
 return data[0].results||[]
}
const safe=(s)=>String(s).replaceAll("'","''")
const quote=(s)=>'"'+String(s).replaceAll('"','""')+'"'
const names=query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('orders','customers','order_items','payments','financial_events','cash_register_entries','exchanges','exchange_items','returns','return_items','inventory_reservations','inventory_stock','inventory_movements','inventory_operation_evidence','inventory_stock_checks','inventory_lifecycle_events','order_manager_audit','activity_log','critical_operations','critical_operation_entities','workshop_tasks','admin_order_delete_sagas') ORDER BY name").map(x=>x.name)
const cols=new Map(names.map(n=>[n,new Set(query("SELECT name FROM pragma_table_info('"+safe(n)+"')").map(x=>x.name))]))
const has=(t,c)=>cols.get(t)?.has(c)
const field=(t,c,alias='')=>has(t,c)?(alias?alias+'.':'')+quote(c):'NULL'
function records(t,ident,val){
 if(!has(t,ident))return[]
 const wanted={
 orders:['id','external_id','customer_id','manager_id','order_date','created_at','updated_at','shipping_status','shipping_date','order_status','source_type','total_amount','received_amount','debt_amount','payment_status','order_payment_method','delivery_type','city','archived_at'],
 order_items:['id','order_id','product_id','variant_id','product_name_snapshot','gender_snapshot','color_snapshot','material_snapshot','length_snapshot','size_snapshot','quantity','price','unit_price','total_price','source_type','is_workshop','stock_writeoff_status','stock_quantity_before','stock_quantity_after','created_at'],
 payments:['id','order_id','amount','payment_date','created_at','updated_at','method','payment_kind'],
 financial_events:['id','order_id','event_key','event_date','event_type','amount_delta','payment_method','source_type','source_id','source_ref','reason','created_at'],
 cash_register_entries:['id','order_id','amount','payment_method','operation_type','operation_date','created_at'],
 exchanges:['id','order_id','old_order_item_id','new_order_item_id','status','created_at','exchange_date','payment_id','refund_return_id'],
 returns:['id','order_id','status','return_date','amount','created_at','updated_at'],
 inventory_reservations:['id','order_id','order_item_id','inventory_source','product_id','variant_id','quantity','status','unresolved_reason','created_at','updated_at','fulfilled_at','released_at'],
 inventory_lifecycle_events:['id','order_id','order_item_id','inventory_source','variant_id','quantity','event_type','status','created_at'],
 order_manager_audit:['id','order_id','manager_id','action','event_type','created_at'],
 activity_log:['id','order_id','entity_type','entity_id','event_type','title','details','created_at'],
 critical_operations:['request_id','id','operation_type','entity_type','entity_id','status','created_at','updated_at'],
 workshop_tasks:['id','order_id','order_item_id','status','quantity','created_at','updated_at'],
 admin_order_delete_sagas:['request_id','order_id','status','created_at','updated_at'],
 inventory_stock:['id','inventory_source','product_id','variant_id','quantity','reserved_quantity','last_action','updated_at','last_source_ref'],
 inventory_stock_checks:['id','inventory_source','product_id','variant_id','expected_quantity','counted_quantity','difference_quantity','checked_at','reference_type','reference_id','check_type'],
 inventory_movements:['id','inventory_source','movement_type','product_id','variant_id','quantity_delta','quantity_after','reference_type','reference_id','comment','created_at'],
 inventory_operation_evidence:['id','inventory_source','variant_id','operation_type','operation_reference','tracked_physical_before','confirmed_operation_quantity','explained_quantity','unexplained_quantity','occurred_at','created_at']
 }[t]||['id','order_id','created_at']
 const select=wanted.filter(x=>has(t,x)).map(quote).join(', ')
 if(!select)return[]
 const literal=typeof val==='number'?String(val):"'"+safe(val)+"'"
 const orderBy=has(t,'id')?' ORDER BY id ASC':has(t,'created_at')?' ORDER BY created_at ASC':''
 return query('SELECT '+select+' FROM '+quote(t)+' WHERE '+quote(ident)+'='+literal+orderBy+' LIMIT 150')
}
const ocols=cols.get('orders'),ccols=cols.get('customers')
if(!ocols||!ccols||!has('orders','customer_id')||!has('customers','id'))throw Error('Unexpected orders/customer schema')
const phoneNames=['phone','phone_number','normalized_phone','phone_normalized'].filter(x=>has('customers',x))
if(!phoneNames.length)throw Error('Customer phone column not found')
const phoneWhere=phoneNames.map(x=>"REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c."+quote(x)+",''),' ',''),'-',''),'(',''),')','') LIKE '%77059613855%'").join(' OR ')
const dateWhere=has('orders','order_date')?"o.order_date='2026-10-13'":"o.external_id LIKE 'ORD-20261013%'"
const selectFields=['id','external_id','order_date','customer_id','manager_id','total_amount','shipping_status','shipping_date','created_at'].filter(x=>has('orders',x)).map(x=>'o.'+quote(x)).join(',')
const candidates=query('SELECT '+selectFields+' FROM orders o JOIN customers c ON c.id=o.customer_id WHERE '+dateWhere+' AND ('+phoneWhere+') ORDER BY o.id ASC LIMIT 20')
console.log('AUDIT_SCOPE='+JSON.stringify({date:'2026-10-13',customerPhoneLast4:'3855',count:candidates.length,availableTables:names}))
console.log('ORDERS='+JSON.stringify(candidates))
const ids=candidates.filter(x=>Number(x.total_amount)===55000).map(x=>Number(x.id))
if(ids.length!==2)throw Error('Expected EXACTLY two 55000 tenge orders for supplied customer/date: got '+ids.length+'; stop without unrelated customer records')
const pairs=[]
for(const id of ids){
 const o={id}
 for(const t of ['orders','order_items','payments','financial_events','cash_register_entries','exchanges','returns','inventory_reservations','inventory_lifecycle_events','order_manager_audit','activity_log','workshop_tasks','admin_order_delete_sagas'])
  o[t]=records(t,'order_id',id)
 o.orders=records('orders','id',id)
 const itemIds=o.order_items.map(x=>Number(x.id))
 if(has('inventory_reservations','order_item_id'))o.reservations_by_item=itemIds.flatMap(x=>records('inventory_reservations','order_item_id',x))
 const variantIds=[...new Set([...o.order_items.map(x=>Number(x.variant_id)),...o.inventory_reservations.map(x=>Number(x.variant_id))].filter(x=>x>0))]
 o.stock=variantIds.flatMap(x=>records('inventory_stock','variant_id',x))
 const external=String(o.orders?.[0]?.external_id||'')
 if(external){
  for(const t of ['inventory_movements','inventory_operation_evidence','inventory_stock_checks']){
   const key=t==='inventory_operation_evidence'?'operation_reference':'reference_id'
   if(!has(t,key))continue
   const wanted=['id','inventory_source','movement_type','product_id','variant_id','quantity_delta','quantity_after','reference_type','reference_id','comment','created_at','operation_type','operation_reference','tracked_physical_before','confirmed_operation_quantity','explained_quantity','unexplained_quantity','occurred_at','checked_at','counted_quantity','expected_quantity'].filter(c=>has(t,c))
   const select=wanted.map(quote).join(',')
   const where=quote(key)+" LIKE '%"+safe(external)+"%'"
   o[t]=query('SELECT '+select+' FROM '+quote(t)+' WHERE '+where+' ORDER BY id ASC LIMIT 100')
  }
 }
 pairs.push(o)
}
for(const p of pairs){
 console.log('ORDER_START='+p.id)
 for(const [k,v] of Object.entries(p))if(k!=='id')console.log(k.toUpperCase()+'='+JSON.stringify(v))
 console.log('ORDER_END='+p.id)
}
console.log('READONLY_DUPLICATE_ORDER_AUDIT_COMPLETE;NO_MUTATIONS')

// Synthetic compatibility extensions for the *actual* deleteOrderSafely call.
// This only runs inside disposable CI local Cloudflare D1. No production SQL.
export function localRealFinalSchema(){
  const add=(table,columns)=>Object.entries(columns)
    .map(([column,type])=>'ALTER TABLE '+table+' ADD COLUMN '+column+' '+type+';')
  return [
    ...add('orders',{
      order_date:'TEXT',manager_id:'INTEGER',customer_id:'INTEGER',manager_snapshot_name:'TEXT',
      city:'TEXT',delivery_type:'TEXT',order_payment_method:'TEXT',source_type:'TEXT',
      workshop_status:'TEXT',comment:'TEXT',shipping_date:'TEXT',archived_at:'TEXT',
      archived_by:'TEXT',archive_reason:'TEXT',archive_batch_id:'TEXT',created_at:'TEXT',
    }),
    ...add('order_items',{
      catalog_price_snapshot:'INTEGER',created_at:'TEXT',workshop_comment:'TEXT',
      workshop_urgent:'INTEGER DEFAULT 0',workshop_due_date:'TEXT',workshop_due_time:'TEXT',
      inventory_obligation_key:'TEXT',inventory_obligation_origin_at:'TEXT'
    }),
    ...add('payments',{
      payment_date:'TEXT',method:'TEXT',payment_kind:"TEXT DEFAULT 'primary'",comment:'TEXT'
    }),
    ...add('exchanges',{old_order_item_id:'INTEGER',new_order_item_id:'INTEGER',old_return_source:'TEXT'}),
    ...add('returns',{return_date:'TEXT',comment:'TEXT'}),
    ...add('inventory_reservations',{product_id:'INTEGER',fulfilled_at:'TEXT',created_at:'TEXT'}),
    ...add('inventory_stock',{
      product_id:'INTEGER',product_name_snapshot:'TEXT',gender_snapshot:'TEXT',
      color_snapshot:'TEXT',material_snapshot:'TEXT',length_snapshot:'TEXT',
      size_snapshot:'TEXT',created_at:'TEXT'
    }),
    "CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT,color_key TEXT,is_active INTEGER);",
    "CREATE TABLE customers(id INTEGER PRIMARY KEY,phone_normalized TEXT UNIQUE,display_name TEXT,city TEXT,first_order_at TEXT,last_order_at TEXT,orders_count INTEGER,created_at TEXT,updated_at TEXT);",
    "CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT);",
    "INSERT INTO inventory_model_meta VALUES('human_inventory_v2','active');",
    "CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT,reference_type TEXT,reference_id TEXT);",
    "CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT,completed_at TEXT);",
    "CREATE TABLE inventory_handover_reviews(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,checkpoint_id INTEGER,checkpoint_at TEXT);",
    "CREATE TABLE financial_events(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE,order_id INTEGER,external_order_id TEXT,event_date TEXT,event_at TEXT,event_type TEXT,related_type TEXT,amount_delta INTEGER,payment_method TEXT,source_type TEXT,source_id INTEGER,source_ref TEXT,reason TEXT,comment TEXT,is_backfill INTEGER,created_at TEXT);",
    "UPDATE orders SET order_date='2026-10-17',created_at='2026-10-17T00:00:00.000Z',manager_snapshot_name='CI',source_type='warehouse',workshop_status='not_in_workshop',shipping_status='not_sent';",
    "UPDATE order_items SET created_at='2026-10-17T00:00:00.000Z';",
  ].join('\n')
}

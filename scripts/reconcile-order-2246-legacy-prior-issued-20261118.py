import json, os, subprocess
from pathlib import Path

ORDER_ID = 2246
EXT = 'ORD-20261101092157-EB6EA8C4'
REQUEST = 'legacy-prior-issue-owner-confirmed:2246:5326:20261118'
EXPECTED_VERSION = '2026-11-10T06:24:33.364Z'
RECORD_DATE = '2026-11-18'
DB = 'orders_db_prod'
CONFIG = Path('wrangler.jsonc').read_text()
assert '"name": "orders-app"' in CONFIG
assert '"database_name": "orders_db_prod"' in CONFIG
assert '"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"' in CONFIG
assert os.environ.get('CLOUDFLARE_API_TOKEN') and os.environ.get('CLOUDFLARE_ACCOUNT_ID')
def execute(query):
    clean = query.lstrip()
    assert clean.startswith(('SELECT ', 'INSERT INTO order_dispatches', 'INSERT INTO order_dispatch_items',
                             'UPDATE orders SET', 'INSERT INTO activity_log')), 'Unexpected D1 command'
    x = subprocess.run(['npx','--no-install','wrangler','d1','execute',DB,'--remote','--config',
      'wrangler.jsonc','--json','--command',query],capture_output=True,text=True,timeout=75)
    if x.returncode:
        raise RuntimeError('D1 command rejected: '+x.stderr[-1800:])
    payload=json.loads(x.stdout)
    assert len(payload)==1 and payload[0]['success'] is True
    return payload[0]
def rows(q): return execute(q)['results']
def one(q):
    r=rows(q)
    assert len(r)==1, ('Unexpected row count',len(r))
    return r[0]
def num(q): return int(one(q)['n'])
def change(q): return int(execute(q).get('meta',{}).get('changes',0))
def check(condition,explanation):
    if not condition: raise RuntimeError('CONCURRENT STATE OR EVIDENCE MISMATCH: '+explanation)
OQ='SELECT id,external_id,order_status,shipping_status,archived_at,updated_at,created_at FROM orders WHERE id=2246'
IQ='SELECT id,quantity,stock_writeoff_status,is_workshop,source_type,product_id,variant_id FROM order_items WHERE order_id=2246 AND quantity>0 ORDER BY id'
RQ='SELECT id,order_item_id,quantity,status,inventory_source,product_id,variant_id FROM inventory_reservations WHERE order_id=2246 ORDER BY order_item_id,id'
DQ='SELECT di.order_item_id,di.quantity,di.cancelled_quantity,di.reservation_id,di.movement_id,d.id AS dispatch_id,d.status AS dispatch_status,d.request_id FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id WHERE d.order_id=2246 ORDER BY di.order_item_id,di.id'
SQ="SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=189"
proof="SELECT COUNT(*) n FROM activity_log a JOIN inventory_reservations r ON r.order_item_id=a.entity_id AND r.order_id=a.order_id WHERE a.order_id=2246 AND a.entity_type='order_item' AND a.entity_id=5326 AND a.event_type='order_stock_handover_reconciled' AND julianday(a.created_at)>=julianday(r.created_at) AND r.id=2289 AND r.status='fulfilled'"
order=one(OQ)
check(order['external_id']==EXT and order['order_status']=='active' and not order['archived_at'],'Exact active order expected')
check(order['created_at']=='2026-11-01T09:21:57.918Z','Historical order identity')
check(order['shipping_status'] in ('sent','not_sent'),'Unexpected shipping state')
if order['shipping_status']!='sent': check(order['updated_at']==EXPECTED_VERSION,'Order edited since forensic audit')
items=rows(IQ)
check([x['id'] for x in items]==[5325,5326,5327] and all(x['quantity']==1 for x in items),'Three original items with qty1 each')
middle=items[1]
check([middle['stock_writeoff_status'],middle['source_type'],middle['is_workshop'],middle['product_id'],middle['variant_id']]==['fulfilled','warehouse',0,2,189],'Exact already-issued stock item')
check(items[0]['stock_writeoff_status']=='fulfilled' and items[2]['is_workshop']==1,'Other items changed')
res=[r for r in rows(RQ) if r['order_item_id']==5326]
check(len(res)==1 and [res[0]['id'],res[0]['status'],res[0]['quantity'],res[0]['inventory_source'],res[0]['product_id'],res[0]['variant_id']]==[2289,'fulfilled',1,'warehouse',2,189],'Already-fulfilled reservation')
check(num(proof)==1,'Exactly one stock handover audit proof')
check(num("SELECT COUNT(*) n FROM inventory_lifecycle_events WHERE order_id=2246 AND order_item_id=5326 AND status='pending'")==0,'No pending lifecycle conflicts')
check(num("SELECT COUNT(*) n FROM return_items ri JOIN returns rt ON rt.id=ri.return_id WHERE rt.order_id=2246 AND COALESCE(rt.status,'completed')<>'cancelled'")==0,'No active return')
check(num("SELECT COUNT(*) n FROM exchanges e WHERE e.order_id=2246 AND COALESCE(e.status,'completed')<>'cancelled'")==0,'No active exchange')
ledger=rows(DQ)
prior=[x for x in ledger if x['order_item_id']!=5326]
check([x['order_item_id'] for x in prior]==[5325,5327] and all(x['quantity']==1 and x['cancelled_quantity']==0 and x['dispatch_status']=='sent' for x in prior),'Other two item dispatches must remain intact')
middle_ledgers=[x for x in ledger if x['order_item_id']==5326]
check(len(middle_ledgers)<=1,'No duplicate dispatch')
if middle_ledgers:
    x=middle_ledgers[0]
    check(x['request_id']==REQUEST and x['quantity']==1 and x['cancelled_quantity']==0 and x['movement_id'] is None,'Only exact status-only journal can be replayed')
before=one(SQ)
stamp="strftime('%Y-%m-%dT%H:%M:%fZ','now')"
if not middle_ledgers:
    existed=rows("SELECT id,order_id FROM order_dispatches WHERE request_id='"+REQUEST+"'")
    if not existed:
        sql=f"""INSERT INTO order_dispatches(order_id,request_id,dispatch_date,created_at,actor,status)
          SELECT o.id,'{REQUEST}','{RECORD_DATE}',{stamp},'owner-confirmed ledger reconciliation','sent'
          FROM orders o WHERE o.id=2246 AND o.external_id='{EXT}' AND o.shipping_status='not_sent'
          AND o.updated_at='{EXPECTED_VERSION}' AND o.order_status='active' AND COALESCE(o.archived_at,'')=''
          AND (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND quantity>0)=3
          AND (SELECT COUNT(*) FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
               WHERE d.order_id=o.id AND di.cancelled_quantity<di.quantity)=2
          AND NOT EXISTS (SELECT 1 FROM order_dispatch_items WHERE order_item_id=5326)
          AND EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.id=2289 AND r.order_id=o.id
               AND r.order_item_id=5326 AND r.status='fulfilled' AND r.quantity=1
               AND r.inventory_source='warehouse' AND r.product_id=2 AND r.variant_id=189)
          AND EXISTS (SELECT 1 FROM activity_log a WHERE a.order_id=o.id AND a.entity_type='order_item'
               AND a.entity_id=5326 AND a.event_type='order_stock_handover_reconciled'
               AND EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.id=2289 AND julianday(a.created_at)>=julianday(r.created_at)))
          AND NOT EXISTS (SELECT 1 FROM order_dispatches WHERE request_id='{REQUEST}')"""
        check(change(sql)==1,'CAS dispatch header')
    else:
        check(len(existed)==1 and existed[0]['order_id']==ORDER_ID,'Idempotency key is owned by a different order')
    sql=f"""INSERT INTO order_dispatch_items(dispatch_id,order_item_id,source_type,variant_id,reservation_id,quantity,created_at)
        SELECT d.id,oi.id,'warehouse',189,2289,1,{stamp}
        FROM order_dispatches d JOIN orders o ON o.id=d.order_id
        JOIN order_items oi ON oi.order_id=o.id AND oi.id=5326
        JOIN inventory_reservations r ON r.id=2289 AND r.order_item_id=oi.id AND r.order_id=o.id
        WHERE d.request_id='{REQUEST}' AND d.order_id=2246
        AND o.external_id='{EXT}' AND o.shipping_status='not_sent' AND o.updated_at='{EXPECTED_VERSION}'
        AND oi.quantity=1 AND oi.stock_writeoff_status='fulfilled' AND oi.is_workshop=0
        AND oi.source_type='warehouse' AND oi.product_id=2 AND oi.variant_id=189
        AND r.status='fulfilled' AND r.quantity=1 AND r.inventory_source='warehouse'
        AND r.product_id=2 AND r.variant_id=189
        AND EXISTS(SELECT 1 FROM activity_log a WHERE a.order_id=o.id AND a.entity_type='order_item'
          AND a.entity_id=oi.id AND a.event_type='order_stock_handover_reconciled'
          AND julianday(a.created_at)>=julianday(r.created_at))
        AND NOT EXISTS (SELECT 1 FROM order_dispatch_items di WHERE di.order_item_id=oi.id)"""
    check(change(sql)==1,'CAS prior issued dispatch line without stock movement')
if one(OQ)['shipping_status']!='sent':
    sql=f"""UPDATE orders SET shipping_status='sent',shipping_date='{RECORD_DATE}',updated_at={stamp}
      WHERE id=2246 AND external_id='{EXT}' AND shipping_status='not_sent'
      AND updated_at='{EXPECTED_VERSION}' AND order_status='active' AND COALESCE(archived_at,'')=''
      AND (SELECT COUNT(*) FROM order_items WHERE order_id=2246 AND quantity>0)=3
      AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=2246 AND oi.quantity>0
        AND (SELECT COALESCE(SUM(di.quantity-di.cancelled_quantity),0)
          FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
          WHERE d.order_id=oi.order_id AND di.order_item_id=oi.id AND d.status='sent')<>oi.quantity)
      AND EXISTS(SELECT 1 FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
        WHERE di.order_item_id=5326 AND d.order_id=2246 AND d.request_id='{REQUEST}'
        AND di.quantity=1 AND di.cancelled_quantity=0 AND di.reservation_id=2289 AND di.movement_id IS NULL)"""
    check(change(sql)==1,'CAS whole order marked fully sent')
if num("SELECT COUNT(*) n FROM activity_log WHERE order_id=2246 AND event_type='order_legacy_mixed_prior_issue_reconciled'")==0:
    sql=f"""INSERT INTO activity_log(event_type,entity_type,entity_id,order_id,external_order_id,title,details,amount,created_at)
      SELECT 'order_legacy_mixed_prior_issue_reconciled','order',o.id,o.id,o.external_id,
      'Подтверждена отправка ранее выданного товара без повторного списания',
      'По подтверждению владельца все товары фактически отправлены. ЕҢЛІК ШАПАН, позиция 5326, ранее выдан со склада. Резерв 2289 и остатки не менялись. {RECORD_DATE} — дата исправления учёта, фактическая дата передачи клиенту неизвестна.',
      0,{stamp}
      FROM orders o WHERE o.id=2246 AND o.external_id='{EXT}' AND o.shipping_status='sent'
      AND EXISTS(SELECT 1 FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
        WHERE di.order_item_id=5326 AND d.request_id='{REQUEST}' AND di.reservation_id=2289 AND di.movement_id IS NULL)
      AND NOT EXISTS(SELECT 1 FROM activity_log a WHERE a.order_id=o.id AND a.event_type='order_legacy_mixed_prior_issue_reconciled')"""
    check(change(sql)==1,'Audit marker failed')
afterOrder=one(OQ)
afterLedger=rows(DQ)
check(afterOrder['shipping_status']=='sent','Order status not sent')
check([x['order_item_id'] for x in afterLedger]==[5325,5326,5327],'Three distinct dispatch item records')
check(all(x['quantity']==1 and x['cancelled_quantity']==0 and x['dispatch_status']=='sent' for x in afterLedger),'Wrong dispatch quantities')
middleAfter=afterLedger[1]
check(middleAfter['request_id']==REQUEST and middleAfter['reservation_id']==2289 and middleAfter['movement_id'] is None,'Physical stock may not be deducted')
check(one(SQ)==before,'Warehouse stock or reservations changed')
check(num("SELECT COUNT(*) n FROM inventory_movements WHERE reference_type='order_dispatch' AND reference_id LIKE '%legacy-prior-issue-owner-confirmed:2246:5326:20261118%'")==0,'Unexpected physical movement')
check(num("SELECT COUNT(*) n FROM activity_log WHERE order_id=2246 AND event_type='order_legacy_mixed_prior_issue_reconciled'")==1,'Exactly one audit marker')
print('ORDER_2246_SENT_VERIFIED: three item shipments, previously issued item not deducted again, inventory stock preserved, owner confirmation audit present')

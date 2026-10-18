-- ONE-OFF guarded reconciliation of historical ALREADY-SENT active Kaspi orders.
-- Trigger only after an audited main deployment. Never touch unshipped or deleted orders.
-- Date reflects recorded shipment (not a new cash receipt); created_at marks repair time.
-- Rerun-safe: per-order payment comment and financial event key are stable.
-- Do not run this file against branch2.
INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at)
SELECT o.id,
       COALESCE(NULLIF(SUBSTR(o.shipping_date,1,10),''), DATE('now')),
       'КАСПИ МАГАЗИН',
       MAX(0, COALESCE(o.total_amount,0) -
         COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.order_id=o.id AND COALESCE(p.amount,0)>0),0)),
       'debt_close',
       'kaspi_sent_history_recovery_v1',
       STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')
FROM orders o
WHERE UPPER(TRIM(COALESCE(o.order_payment_method,'')))='КАСПИ МАГАЗИН'
  AND COALESCE(o.order_status,'active')='active'
  AND COALESCE(o.archived_at,'')=''
  AND COALESCE(o.shipping_status,'not_sent')='sent'
  AND COALESCE(o.total_amount,0) >
       COALESCE((SELECT SUM(p.amount) FROM payments p
                 WHERE p.order_id=o.id AND COALESCE(p.amount,0)>0),0)
  AND NOT EXISTS(SELECT 1 FROM payments p
      WHERE p.order_id=o.id AND p.comment='kaspi_sent_history_recovery_v1')
  AND NOT EXISTS(SELECT 1 FROM critical_operations c
      WHERE c.request_id='kaspi-shipping-payment:'||o.id||':v1');

-- The stable event is explicitly backfilled, not a second receipt of money.
INSERT OR IGNORE INTO financial_events(
  event_key,order_id,external_order_id,event_date,event_at,event_type,related_type,
  amount_delta,payment_method,source_type,source_id,source_ref,reason,comment,is_backfill,created_at
)
SELECT 'kaspi:sent-history-recovery:v1:'||p.order_id,
       p.order_id,o.external_id,p.payment_date,p.created_at,'debt_close',NULL,
       p.amount,'КАСПИ МАГАЗИН','payment',p.id,'payments:'||p.id,
       'kaspi_sent_history_recovery','History recovery for Kaspi externally-settled shipped order',1,p.created_at
FROM payments p JOIN orders o ON o.id=p.order_id
WHERE p.comment='kaspi_sent_history_recovery_v1'
  AND p.method='КАСПИ МАГАЗИН'
  AND COALESCE(p.amount,0)>0;

-- Sync the canonical ledger from actual payment rows. Only rows created by
-- this recovery are updated. No stock, returns, exchange or order totals touched.
UPDATE orders
SET received_amount=COALESCE((SELECT SUM(p.amount)
    FROM payments p WHERE p.order_id=orders.id AND COALESCE(p.amount,0)>0),0),
    debt_amount=MAX(0,COALESCE(total_amount,0)-COALESCE((SELECT SUM(p.amount)
    FROM payments p WHERE p.order_id=orders.id AND COALESCE(p.amount,0)>0),0)),
    updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT order_id FROM payments
             WHERE comment='kaspi_sent_history_recovery_v1'
             AND method='КАСПИ МАГАЗИН');

-- Explicit one-time accounting decision from the owner: mark precisely the 23 old
-- manager 436 ASIYA Kaspi orders as paid, NOT that outside bank settlement was verified.
-- Production main D1 only; NO shipping status, inventory, workshop, cash entry writes.
-- Initial payment is backdated to order_date as historical reconstruction, with a
-- distinct marker / financial_events.is_backfill=1 to avoid claiming a new cash receipt.
-- The INSERT is one atomic conditional statement. ANY stale/changed row => insert zero.
-- Re-execution is safe: no duplicate payment, immutable event key and controlled update.

WITH targets(id, expected_amount) AS (
  VALUES (1877,28000),
    (1887,55000),
    (1888,16000),
    (1889,28000),
    (1890,35000),
    (1891,45000),
    (1893,110000),
    (1894,22500),
    (1895,22500),
    (1896,16000),
    (1897,22500),
    (1898,20000),
    (1899,82500),
    (1900,20000),
    (1920,27500),
    (1921,16000),
    (1922,16000),
    (1923,16000),
    (1924,16000),
    (1925,16000),
    (1926,16000),
    (1927,16000),
    (1928,16000)
), eligible AS (
  SELECT o.id, o.external_id, o.order_date, o.total_amount
  FROM orders o JOIN targets t ON t.id=o.id
  WHERE o.manager_id=436
    AND COALESCE(o.order_status,'active')='active'
    AND COALESCE(o.archived_at,'')=''
    AND COALESCE(o.shipping_status,'not_sent')='not_sent'
    AND UPPER(TRIM(COALESCE(o.order_payment_method,'')))='КАСПИ МАГАЗИН'
    AND o.total_amount=t.expected_amount AND t.expected_amount>0
    AND COALESCE(o.received_amount,0)=0
    AND COALESCE(o.debt_amount,0)=t.expected_amount
    AND COALESCE(o.return_amount,0)=0
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id)
),
gate AS (
  SELECT (SELECT COUNT(*) FROM eligible)=23
    AND (SELECT COALESCE(SUM(total_amount),0) FROM eligible)=678500 AS allow_all
)
INSERT INTO payments (order_id,payment_date,method,amount,payment_kind,comment,created_at)
SELECT e.id,e.order_date,'КАСПИ МАГАЗИН',e.total_amount,
       'primary','kaspi_asiya_unshipped_assumed_paid_20261019',STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')
FROM eligible e WHERE (SELECT allow_all FROM gate)=1;

INSERT OR IGNORE INTO financial_events (
  event_key,order_id,external_order_id,event_date,event_at,event_type,related_type,
  amount_delta,payment_method,source_type,source_id,source_ref,reason,comment,is_backfill,created_at
)
SELECT 'kaspi:asiya:legacy-assumed-paid:20261019:'||o.id,
       o.id,o.external_id,p.payment_date,p.created_at,'order_payment',NULL,
       p.amount,'КАСПИ МАГАЗИН','payment',p.id,'payments:'||p.id,
       'kaspi_asiya_legacy_assumed_paid',
       'Учетное закрытие старого Kaspi-заказа Асии по решению администратора; факт внешней оплаты не проверялся',
       1,p.created_at
FROM payments p JOIN orders o ON o.id=p.order_id
WHERE p.comment='kaspi_asiya_unshipped_assumed_paid_20261019' AND p.method='КАСПИ МАГАЗИН'
  AND o.manager_id=436 AND o.id IN (1877,1887,1888,1889,1890,1891,1893,1894,1895,1896,1897,1898,1899,1900,1920,1921,1922,1923,1924,1925,1926,1927,1928) AND p.amount>0;

UPDATE orders
SET received_amount=COALESCE((SELECT SUM(p.amount) FROM payments p
  WHERE p.order_id=orders.id AND p.amount>0),0),
  debt_amount=MAX(0,COALESCE(total_amount,0)-COALESCE(
    (SELECT SUM(p.amount) FROM payments p WHERE p.order_id=orders.id AND p.amount>0),0)),
  updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (1877,1887,1888,1889,1890,1891,1893,1894,1895,1896,1897,1898,1899,1900,1920,1921,1922,1923,1924,1925,1926,1927,1928) AND manager_id=436 AND COALESCE(order_status,'active')='active'
  AND EXISTS (SELECT 1 FROM payments p
    WHERE p.order_id=orders.id AND p.comment='kaspi_asiya_unshipped_assumed_paid_20261019'
      AND p.method='КАСПИ МАГАЗИН');

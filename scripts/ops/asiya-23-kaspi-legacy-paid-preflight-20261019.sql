-- SELECT only. Production checkpoint for exactly the 23 Asiya orders.
WITH t AS (SELECT * FROM orders WHERE id IN (1877,1887,1888,1889,1890,1891,1893,1894,1895,1896,1897,1898,1899,1900,1920,1921,1922,1923,1924,1925,1926,1927,1928)), a AS (
 SELECT o.*, (SELECT COUNT(*) FROM payments p WHERE p.order_id=o.id) AS payment_count,
 (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id
  AND oi.quantity>0 AND COALESCE(oi.is_workshop,0)=0
  AND COALESCE(oi.source_type,o.source_type) IN ('warehouse','boutique')) AS stock_lines
 FROM t o
), g AS (
 SELECT *,
  CASE WHEN manager_id=436 AND COALESCE(order_status,'active')='active'
   AND COALESCE(archived_at,'')='' AND COALESCE(shipping_status,'not_sent')='not_sent'
   AND UPPER(TRIM(COALESCE(order_payment_method,'')))='КАСПИ МАГАЗИН'
   AND COALESCE(received_amount,0)=0 AND COALESCE(debt_amount,0)=total_amount
   AND COALESCE(return_amount,0)=0 AND payment_count=0 AND total_amount>0
   THEN 1 ELSE 0 END eligible
 FROM a
)
SELECT COUNT(*) AS target_count,COALESCE(SUM(total_amount),0) AS target_total,
 COALESCE(SUM(eligible),0) AS eligible_count,
 COALESCE(SUM(CASE WHEN eligible=1 THEN total_amount ELSE 0 END),0) AS eligible_total,
 COALESCE(SUM(CASE WHEN stock_lines>0 THEN 1 ELSE 0 END),0) AS stock_or_boutique_orders,
 COALESCE(SUM(CASE WHEN stock_lines=0 THEN 1 ELSE 0 END),0) AS workshop_only_orders,
 COALESCE(SUM(payment_count),0) AS existing_payment_rows,
 (SELECT COUNT(*) FROM payments
   WHERE comment='kaspi_asiya_unshipped_assumed_paid_20261019') AS existing_tagged_payments,
 (SELECT COUNT(*) FROM financial_events
   WHERE reason='kaspi_asiya_legacy_assumed_paid') AS existing_tagged_events
FROM g;

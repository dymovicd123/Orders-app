-- Kaspi order separation: persist the order-level intended payment method independently
-- from factual payment rows. Zero-value payment placeholders remain non-financial and are not stored.
ALTER TABLE orders ADD COLUMN order_payment_method TEXT;

-- Conservative historical recovery: only orders whose persisted positive payments are exclusively
-- KASPI MAGAZIN are classified automatically. Delivery type is intentionally not used as proof.
UPDATE orders
SET order_payment_method = 'КАСПИ МАГАЗИН'
WHERE EXISTS (
  SELECT 1
  FROM payments p
  WHERE p.order_id = orders.id
    AND UPPER(TRIM(COALESCE(p.method, ''))) = 'КАСПИ МАГАЗИН'
    AND COALESCE(p.amount, 0) > 0
)
AND NOT EXISTS (
  SELECT 1
  FROM payments p
  WHERE p.order_id = orders.id
    AND COALESCE(p.amount, 0) > 0
    AND UPPER(TRIM(COALESCE(p.method, ''))) <> 'КАСПИ МАГАЗИН'
);

CREATE INDEX IF NOT EXISTS idx_orders_order_payment_method_status_date
ON orders(order_payment_method, order_status, order_date, id);

-- SINGLE-USE production duplicate correction. Exact expected D1 read-only preflight:
-- workflow runs 38625549969 and 38625928812, issue #406.
-- No DELETE, refund, physical stock writes, movement rewrites or exchange cancellations.
-- The command must run as ONE bounded D1 batch, no separate statements over multiple API calls.
-- Any unexpected state aborts via integer-overflow sentinel before mutations.
SELECT CASE WHEN
  (SELECT COUNT(*) FROM orders WHERE id=1734 AND external_id='ORD-20261004144759-D27C0954'
     AND order_status='active' AND shipping_status='not_sent' AND order_date='2026-10-04'
     AND total_amount=67500 AND received_amount=65000 AND debt_amount=2500
     AND updated_at='2026-10-11T14:28:00.578Z')=1
  AND (SELECT COUNT(*) FROM orders WHERE id=1974 AND order_status='active'
     AND shipping_status='not_sent' AND order_date='2026-10-04'
     AND total_amount=65000 AND received_amount=65000 AND debt_amount=0
     AND updated_at='2026-10-14T13:48:42.535Z')=1
  AND (SELECT COUNT(*) FROM payments WHERE order_id=1734 AND id=1989 AND amount=65000
     AND payment_date='2026-10-04' AND method='ТЕРМИНАЛ' AND payment_kind='primary')=1
  AND (SELECT COUNT(*) FROM payments WHERE order_id=1734)=1
  AND (SELECT COUNT(*) FROM payments WHERE order_id=1974 AND id=2158 AND amount=65000
     AND payment_date='2026-10-04' AND method='ТЕРМИНАЛ' AND payment_kind='primary')=1
  AND (SELECT COUNT(*) FROM payments WHERE order_id=1974)=1
  AND (SELECT COUNT(*) FROM exchanges WHERE id=78 AND order_id=1734
    AND status='completed' AND financial_action='none' AND financial_amount=0)=1
  AND (SELECT COUNT(*) FROM exchanges WHERE id=80 AND order_id=1974
    AND status='completed' AND financial_action='none' AND financial_amount=0)=1
  AND (SELECT COUNT(*) FROM returns WHERE order_id IN (1734,1974))=0
  AND (SELECT COUNT(*) FROM inventory_reservations
       WHERE order_id=1734 AND status='active' AND
        ((id=1467 AND order_item_id=4263 AND inventory_source='boutique' AND variant_id=1293 AND quantity=1)
        OR (id=1468 AND order_item_id=4264 AND inventory_source='boutique' AND variant_id=1345 AND quantity=1)))=2
  AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1734 AND status='active')=2
  AND (SELECT COUNT(*) FROM inventory_reservations
       WHERE id=1674 AND order_id=1734 AND status='fulfilled' AND variant_id=231)=1
  AND (SELECT COUNT(*) FROM inventory_reservations
       WHERE id=1755 AND order_id=1974 AND status='fulfilled' AND variant_id=231)=1
  AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1974 AND status='active')=2
  AND (SELECT COUNT(*) FROM order_items WHERE id=4263 AND order_id=1734
     AND variant_id=1293 AND stock_writeoff_status='reserved')=1
  AND (SELECT COUNT(*) FROM order_items WHERE id=4264 AND order_id=1734
     AND variant_id=1345 AND stock_writeoff_status='reserved')=1
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1106 AND inventory_source='boutique'
     AND variant_id=1293 AND quantity=0 AND reserved_quantity=1)=1
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1285 AND inventory_source='boutique'
     AND variant_id=1345 AND quantity=0 AND reserved_quantity=1)=1
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1377 AND inventory_source='boutique'
     AND variant_id=1466 AND quantity=1 AND reserved_quantity=1)=1
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1822 AND inventory_source='boutique'
     AND variant_id=1660 AND quantity=0 AND reserved_quantity=1)=1
  AND (SELECT COUNT(*) FROM inventory_lifecycle_events WHERE operation_type='exchange'
     AND operation_id IN(78,80) AND event_type='exchange_new_out' AND status='applied')=2
  AND (SELECT COUNT(*) FROM inventory_movements WHERE id=4873
     AND variant_id=231 AND quantity_delta=-1 AND reference_type='exchange_new' AND reference_id='78')=1
  AND (SELECT COUNT(*) FROM cash_register_entries WHERE order_id=1734)=0
  AND (SELECT COUNT(*) FROM financial_events WHERE order_id=1734 AND id=2055
     AND event_type='order_payment' AND amount_delta=65000 AND reason='order_create')=1
  AND (SELECT COUNT(*) FROM financial_events WHERE order_id=1734)=1
  AND (SELECT COUNT(*) FROM financial_events WHERE order_id=1974 AND id=2239
     AND event_type='order_payment' AND amount_delta=65000 AND reason='order_create')=1
  AND (SELECT COUNT(*) FROM financial_events WHERE order_id=1974)=1
  AND (SELECT COUNT(*) FROM financial_events
       WHERE event_key='ops:20261015:duplicate-order:1734:payment:1989:reversal')=0
THEN 1 ELSE abs(-9223372036854775808) END AS preflight_ok;

-- Release only the two abandoned promises, never the physical quantity.
UPDATE inventory_stock
SET reserved_quantity=0, last_action='Резерв снят',
    last_source_ref='oneoff:duplicate-order:1734',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (id=1106 AND inventory_source='boutique' AND variant_id=1293
       AND quantity=0 AND reserved_quantity=1)
   OR (id=1285 AND inventory_source='boutique' AND variant_id=1345
       AND quantity=0 AND reserved_quantity=1);

UPDATE inventory_reservations
SET status='released', released_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE order_id=1734 AND status='active' AND id IN(1467,1468);

UPDATE order_items
SET stock_writeoff_status='reservation_released',
    stock_quantity_before=NULL,stock_quantity_after=NULL
WHERE order_id=1734 AND id IN(4263,4264) AND stock_writeoff_status='reserved';

-- Correct the duplicated BOOKKEEPING payment, without refunding actual money.
-- Retain payment #1989 as audit evidence. Mark its order deleted so current
-- sales/payment reports exclude it. The dated history now nets to zero.
INSERT INTO financial_events (
  event_key,order_id,external_order_id,event_date,event_at,
  event_type,related_type,amount_delta,payment_method,source_type,
  source_id,source_ref,reason,comment,is_backfill,created_at
)
SELECT
  'ops:20261015:duplicate-order:1734:payment:1989:reversal',
  1734,o.external_id,p.payment_date,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  'payment_reversal','order_payment',-65000,p.method,'payment',
  p.id,'payments:'||p.id,'duplicate_order_record',
  'Точечное исправление ошибочного дублирования оплаты. Фактического возврата денег клиенту нет',
  0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM orders o JOIN payments p ON p.order_id=o.id
WHERE o.id=1734 AND p.id=1989 AND p.amount=65000
  AND o.order_status='active';

-- Soft deletion preserves original exchange #78, fulfilled reservation #1674,
-- movement #4873, and the post-13-Oct physical stocktake with no reversal.
UPDATE orders
SET order_status='deleted',
    comment=TRIM(COALESCE(comment,'')||char(10)||
      '[Audit 2026-10-15] Ошибочный повтор заказа 1974. Исключено из активных заказов и финансов. Два резерва сняты. Повторная бухгалтерская оплата нейтрализована без реального возврата. Физические движения и обмен сохранены как история.'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1734 AND order_status='active' AND total_amount=67500 AND received_amount=65000
  AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1734 AND status='active')=0
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id IN(1106,1285) AND reserved_quantity=0)=2
  AND EXISTS (SELECT 1 FROM financial_events
    WHERE event_key='ops:20261015:duplicate-order:1734:payment:1989:reversal'
      AND amount_delta=-65000);

-- Fail loudly rather than claim success if any constrained mutation did not land.
SELECT CASE WHEN
  (SELECT COUNT(*) FROM orders WHERE id=1734 AND order_status='deleted'
    AND total_amount=67500 AND received_amount=65000)=1
  AND (SELECT COUNT(*) FROM orders WHERE id=1974 AND order_status='active'
    AND total_amount=65000 AND received_amount=65000 AND debt_amount=0
    AND updated_at='2026-10-14T13:48:42.535Z')=1
  AND (SELECT COUNT(*) FROM payments WHERE id=1989 AND order_id=1734 AND amount=65000)=1
  AND (SELECT COUNT(*) FROM payments WHERE id=2158 AND order_id=1974 AND amount=65000)=1
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id IN (1106,1285)
    AND inventory_source='boutique' AND quantity=0 AND reserved_quantity=0)=2
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1377
    AND quantity=1 AND reserved_quantity=1)=1
  AND (SELECT COUNT(*) FROM inventory_stock WHERE id=1822
    AND quantity=0 AND reserved_quantity=1)=1
  AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1734 AND status='active')=0
  AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1734 AND status='released')=3
  AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1734 AND status='fulfilled')=1
  AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1974 AND status='active')=2
  AND (SELECT COUNT(*) FROM order_items WHERE order_id=1734 AND id IN(4263,4264)
    AND stock_writeoff_status='reservation_released')=2
  AND (SELECT COUNT(*) FROM financial_events WHERE order_id=1734
    AND event_key='ops:20261015:duplicate-order:1734:payment:1989:reversal'
    AND event_type='payment_reversal' AND amount_delta=-65000)=1
  AND (SELECT SUM(amount_delta) FROM financial_events WHERE order_id=1734)=0
  AND (SELECT SUM(amount_delta) FROM financial_events WHERE order_id=1974)=65000
  AND (SELECT COUNT(*) FROM cash_register_entries WHERE order_id=1734)=0
  AND (SELECT COUNT(*) FROM inventory_lifecycle_events WHERE operation_type='exchange'
    AND operation_id IN(78,80) AND event_type='exchange_new_out' AND status='applied')=2
  AND (SELECT COUNT(*) FROM exchanges WHERE id=78 AND order_id=1734 AND status='completed')=1
  AND (SELECT COUNT(*) FROM exchanges WHERE id=80 AND order_id=1974 AND status='completed')=1
  AND (SELECT COUNT(*) FROM inventory_movements WHERE id=4873
    AND variant_id=231 AND quantity_delta=-1)=1
THEN 1 ELSE abs(-9223372036854775808) END AS postcondition_ok;

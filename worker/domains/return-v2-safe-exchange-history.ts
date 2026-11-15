// A zero-money historical exchange can coexist with a new Return only when its
// replaced item has actually left the contract and every replacement is owned by
// the same order. The old one-to-one exchange and the multi-line Exchange Set
// have different journals; either can be independently proven without guessing.
export function unsafeActiveExchangeSql(orderIdSql:string):string {
  return `EXISTS(SELECT 1 FROM exchanges e
    WHERE e.order_id=${orderIdSql}
      AND COALESCE(e.status,'completed')<>'cancelled'
      AND (
        COALESCE(e.financial_action,'none')<>'none'
        OR COALESCE(e.financial_amount,0)<>0
        OR e.payment_id IS NOT NULL OR e.refund_return_id IS NOT NULL
        OR NOT (
          (
            e.old_order_item_id IS NOT NULL
            AND e.new_order_item_id IS NOT NULL
            AND e.old_order_item_id<>e.new_order_item_id
            AND EXISTS(SELECT 1 FROM order_items oi
              WHERE oi.id=e.old_order_item_id AND oi.order_id=e.order_id
                AND oi.quantity=0)
            AND EXISTS(SELECT 1 FROM order_items oi
              WHERE oi.id=e.new_order_item_id AND oi.order_id=e.order_id)
          ) OR (
            e.old_order_item_id IS NULL AND e.new_order_item_id IS NULL
            AND EXISTS(SELECT 1 FROM exchange_items ei
              WHERE ei.exchange_id=e.id AND ei.role='old')
            AND EXISTS(SELECT 1 FROM exchange_items ei
              WHERE ei.exchange_id=e.id AND ei.role='new')
            AND (SELECT COALESCE(SUM(ei.quantity),0) FROM exchange_items ei
              WHERE ei.exchange_id=e.id AND ei.role='old')
              =(SELECT COALESCE(SUM(ei.quantity),0) FROM exchange_items ei
                WHERE ei.exchange_id=e.id AND ei.role='new')
            AND NOT EXISTS(SELECT 1 FROM exchange_items ei
              LEFT JOIN order_items oi ON oi.id=ei.order_item_id
              WHERE ei.exchange_id=e.id AND (
                ei.order_item_id IS NULL
                OR ei.quantity<=0
                OR oi.id IS NULL OR oi.order_id<>e.order_id
                OR (ei.role='old' AND oi.quantity<>0 AND NOT EXISTS(
                  SELECT 1 FROM inventory_reservations ir
                  WHERE ir.order_item_id=oi.id AND ir.status='fulfilled'
                    AND ir.quantity=oi.quantity+ei.quantity))
                OR (ei.role='new' AND oi.quantity<0)
              ))
            AND NOT EXISTS(SELECT 1 FROM exchange_items ei
              JOIN exchange_items other ON other.exchange_id=ei.exchange_id
                AND other.order_item_id=ei.order_item_id AND other.id<>ei.id
              WHERE ei.exchange_id=e.id)
          )
        )
      ))`
}

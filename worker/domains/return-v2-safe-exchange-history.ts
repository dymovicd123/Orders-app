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
                OR (ei.role='old' AND oi.quantity<>0 AND NOT (
                  oi.quantity>0
                  AND EXISTS(SELECT 1 FROM orders original_order
                    WHERE original_order.id=e.order_id AND original_order.shipping_status='sent')
                  AND (SELECT COUNT(*) FROM inventory_reservations ir
                    WHERE ir.order_item_id=oi.id AND ir.status='fulfilled')=1
                  AND (SELECT COALESCE(SUM(ir.quantity),0) FROM inventory_reservations ir
                    WHERE ir.order_item_id=oi.id AND ir.status='fulfilled')=
                      oi.quantity
                      +(SELECT COALESCE(SUM(old_ei.quantity),0)
                        FROM exchange_items old_ei JOIN exchanges old_exchange
                          ON old_exchange.id=old_ei.exchange_id
                        WHERE old_ei.order_item_id=oi.id AND old_ei.role='old'
                          AND old_exchange.order_id=e.order_id
                          AND COALESCE(old_exchange.status,'completed')='completed')
                      +(SELECT COALESCE(SUM(ul.contracted_quantity),0)
                        FROM return_v2_unified_lines ul
                        JOIN return_v2_unified_postings up ON up.id=ul.posting_id
                        JOIN returns ret ON ret.id=up.return_id
                        WHERE ul.order_item_id=oi.id
                          AND ul.action='physical_return_pending'
                          AND ret.status='completed')
                      +(SELECT COALESCE(SUM(lb.quantity),0)
                        FROM return_v2_legacy_baseline_items lb
                        WHERE lb.order_item_id=oi.id)
                ))
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

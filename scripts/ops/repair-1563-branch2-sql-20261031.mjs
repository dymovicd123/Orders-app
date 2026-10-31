// Branch2-only replay of already-verified Main historical order #1563 reconciliation: 4 reservations, zero physical quantity or finance changes.
// Statements execute as one D1 batch; failed assertion aborts transaction.
export const EXPECTED_RESERVATIONS = [
  {
    "id": 1226,
    "item": 3907,
    "source": "warehouse",
    "variant": 853,
    "status": "active"
  },
  {
    "id": 1227,
    "item": 3908,
    "source": "warehouse",
    "variant": 1444,
    "status": "active"
  },
  {
    "id": 1228,
    "item": 3909,
    "source": "boutique",
    "variant": 212,
    "status": "active"
  },
  {
    "id": 1229,
    "item": 3910,
    "source": "boutique",
    "variant": null,
    "status": "unresolved"
  }
]
export const BATCH_SQL = [
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM orders WHERE id=1563 AND external_id='ORD-20260923143855-90AAA657' AND shipping_status='not_sent' AND order_status='active' AND return_amount=100000 AND received_amount=100000 AND total_amount=100000) AND (SELECT COUNT(*) FROM order_items WHERE order_id=1563)=6 AND (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=1563 AND oi.quantity=1 AND COALESCE(oi.is_workshop,0)=0 AND COALESCE((SELECT SUM(ri.quantity) FROM return_items ri JOIN returns ret ON ret.id=ri.return_id WHERE ri.order_item_id=oi.id AND ret.order_id=1563 AND COALESCE(ret.status,'completed')<>'cancelled' AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=ret.id AND COALESCE(e.status,'completed')<>'cancelled')),0)=oi.quantity AND EXISTS(SELECT 1 FROM return_items ri JOIN returns ret ON ret.id=ri.return_id WHERE ri.order_item_id=oi.id AND ret.order_id=1563 AND ri.physical_tracking=1 AND ri.physical_received_at IS NOT NULL))=6 AND (SELECT COUNT(*) FROM returns WHERE order_id=1563 AND id IN (43,46) AND COALESCE(status,'completed')<>'cancelled')=2 AND (SELECT COUNT(*) FROM returns WHERE order_id=1563 AND COALESCE(status,'completed')<>'cancelled')=2 AND NOT EXISTS(SELECT 1 FROM exchanges WHERE order_id=1563 AND COALESCE(status,'completed')<>'cancelled') AND (SELECT COUNT(*) FROM inventory_reservations r WHERE (r.id=1226 AND r.order_id=1563 AND r.order_item_id=3907 AND r.inventory_source='warehouse' AND r.variant_id=853 AND r.quantity=1 AND r.status='active') OR (r.id=1227 AND r.order_id=1563 AND r.order_item_id=3908 AND r.inventory_source='warehouse' AND r.variant_id=1444 AND r.quantity=1 AND r.status='active') OR (r.id=1228 AND r.order_id=1563 AND r.order_item_id=3909 AND r.inventory_source='boutique' AND r.variant_id=212 AND r.quantity=1 AND r.status='active') OR (r.id=1229 AND r.order_id=1563 AND r.order_item_id=3910 AND r.inventory_source='boutique' AND r.variant_id IS NULL AND r.quantity=1 AND r.status='unresolved'))=4 AND (SELECT COUNT(*) FROM inventory_stock s WHERE (s.inventory_source='warehouse' AND s.variant_id IN (853,1444)) OR (s.inventory_source='boutique' AND s.variant_id=212))=3 AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE ((s.inventory_source='warehouse' AND s.variant_id IN (853,1444)) OR (s.inventory_source='boutique' AND s.variant_id=212)) AND COALESCE(s.reserved_quantity,0)<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.inventory_source=s.inventory_source AND r.variant_id=s.variant_id AND r.status='active'),0)) THEN 'OK' ELSE json_extract('PRECHECK_1563_FAILED','$.x') END AS gate",
  "UPDATE inventory_reservations SET status='released',released_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),unresolved_reason='historic_return_43_46_reconciled_after_stocktake' WHERE order_id=1563 AND id IN (1226,1227,1228,1229) AND status IN ('active','unresolved')",
  "UPDATE order_items SET stock_writeoff_status='reservation_released',stock_quantity_before=NULL,stock_quantity_after=NULL WHERE order_id=1563 AND id IN (3907,3908,3909,3910) AND EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.order_item_id=order_items.id AND r.status='released')",
  "UPDATE inventory_stock SET reserved_quantity=COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.inventory_source=inventory_stock.inventory_source AND r.variant_id=inventory_stock.variant_id AND r.status='active'),0) WHERE (inventory_source='warehouse' AND variant_id IN (853,1444)) OR (inventory_source='boutique' AND variant_id=212)",
  "INSERT INTO activity_log(event_type,entity_type,entity_id,order_id,external_order_id,title,details,amount,created_at) SELECT 'return_reservations_reconciled_1563_branch2_20261031','order',1563,1563,'ORD-20260923143855-90AAA657','Согласованы резервы исторического возврата №1563','Закрыты четыре устаревших резерва 1226–1229 по возвратам №43 и №46 с учётом поздних ревизий. Физические остатки, движения, деньги и возвраты не изменены.',0,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM activity_log WHERE order_id=1563 AND event_type='return_reservations_reconciled_1563_branch2_20261031')",
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM orders WHERE id=1563 AND external_id='ORD-20260923143855-90AAA657' AND shipping_status='not_sent' AND order_status='active' AND return_amount=100000 AND received_amount=100000 AND total_amount=100000) AND (SELECT COUNT(*) FROM order_items WHERE order_id=1563)=6 AND (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=1563 AND oi.quantity=1 AND COALESCE(oi.is_workshop,0)=0 AND COALESCE((SELECT SUM(ri.quantity) FROM return_items ri JOIN returns ret ON ret.id=ri.return_id WHERE ri.order_item_id=oi.id AND ret.order_id=1563 AND COALESCE(ret.status,'completed')<>'cancelled' AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=ret.id AND COALESCE(e.status,'completed')<>'cancelled')),0)=oi.quantity AND EXISTS(SELECT 1 FROM return_items ri JOIN returns ret ON ret.id=ri.return_id WHERE ri.order_item_id=oi.id AND ret.order_id=1563 AND ri.physical_tracking=1 AND ri.physical_received_at IS NOT NULL))=6 AND (SELECT COUNT(*) FROM returns WHERE order_id=1563 AND id IN (43,46) AND COALESCE(status,'completed')<>'cancelled')=2 AND (SELECT COUNT(*) FROM returns WHERE order_id=1563 AND COALESCE(status,'completed')<>'cancelled')=2 AND NOT EXISTS(SELECT 1 FROM exchanges WHERE order_id=1563 AND COALESCE(status,'completed')<>'cancelled') AND (SELECT COUNT(*) FROM inventory_reservations r WHERE (r.id=1226 AND r.order_id=1563 AND r.order_item_id=3907 AND r.inventory_source='warehouse' AND r.variant_id=853 AND r.quantity=1 AND r.status='released') OR (r.id=1227 AND r.order_id=1563 AND r.order_item_id=3908 AND r.inventory_source='warehouse' AND r.variant_id=1444 AND r.quantity=1 AND r.status='released') OR (r.id=1228 AND r.order_id=1563 AND r.order_item_id=3909 AND r.inventory_source='boutique' AND r.variant_id=212 AND r.quantity=1 AND r.status='released') OR (r.id=1229 AND r.order_id=1563 AND r.order_item_id=3910 AND r.inventory_source='boutique' AND r.variant_id IS NULL AND r.quantity=1 AND r.status='released'))=4 AND (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=1563 AND status IN ('active','unresolved'))=0 AND (SELECT COUNT(*) FROM order_items WHERE order_id=1563 AND id IN (3907,3908,3909,3910) AND stock_writeoff_status='reservation_released')=4 AND (SELECT COUNT(*) FROM activity_log WHERE order_id=1563 AND event_type='return_reservations_reconciled_1563_branch2_20261031')=1 AND (SELECT COUNT(*) FROM inventory_stock s WHERE (s.inventory_source='warehouse' AND s.variant_id IN (853,1444)) OR (s.inventory_source='boutique' AND s.variant_id=212))=3 AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE ((s.inventory_source='warehouse' AND s.variant_id IN (853,1444)) OR (s.inventory_source='boutique' AND s.variant_id=212)) AND COALESCE(s.reserved_quantity,0)<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.inventory_source=s.inventory_source AND r.variant_id=s.variant_id AND r.status='active'),0)) THEN 'OK' ELSE json_extract('POSTCHECK_1563_FAILED','$.x') END AS gate"
]

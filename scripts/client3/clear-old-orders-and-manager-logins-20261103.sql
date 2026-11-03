-- Client3 watch installation ONLY. One-time legacy order and old manager LOGIN reset.
-- NOT Main and NOT Branch2. Only the preflight-approved unbranded orders
-- are targeted, never real watch orders or new watch variants / product catalog.
-- D1 Time Travel bookmark MUST be captured immediately before execution.
-- A request with multiple statements is sent in a single D1 API call.
CREATE TABLE IF NOT EXISTS client3_legacy_reset_20261103_targets (
 order_id INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO client3_legacy_reset_20261103_targets(order_id)
 SELECT id FROM orders
 WHERE NOT EXISTS (SELECT 1 FROM watch_order_details WHERE order_id=orders.id)
 AND NOT EXISTS (SELECT 1 FROM client3_legacy_reset_20261103_targets);

-- Non-cascading order references are removed before parent records.
DELETE FROM exchange_order_item_price_corrections
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM catalog_variant_consolidation_reservation_rows
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM catalog_variant_reserved_undo_reservations
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM reference_value_merge_orders
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM admin_order_delete_sagas
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM order_dispatch_items WHERE dispatch_id IN
 (SELECT id FROM order_dispatches
  WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets));
DELETE FROM order_dispatches
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);

DELETE FROM return_items WHERE return_id IN
 (SELECT id FROM returns
  WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets));
DELETE FROM exchange_items WHERE exchange_id IN
 (SELECT id FROM exchanges
  WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets));
DELETE FROM returns
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM exchanges
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM payments
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM financial_events
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM inventory_reservations
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM order_items
 WHERE order_id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);
DELETE FROM orders
 WHERE id IN (SELECT order_id FROM client3_legacy_reset_20261103_targets);

-- Archive old employee credentials in-place to preserve audit FK identities,
-- but completely revoke login and password and remove from all UI lists.
-- Active administrators and the employee roster are not touched.
DELETE FROM app_sessions WHERE user_id IN
 (SELECT id FROM app_users WHERE role='manager');
UPDATE app_users SET
 login=NULL,
 email='client3-retired-account-' || id || '@orders.invalid',
 password_hash='revoked',
 manager_id=NULL,
 display_name='',
 is_active=0,
 must_change_password=1,
 disabled_at=datetime('now'),
 updated_at=datetime('now')
 WHERE role='manager';

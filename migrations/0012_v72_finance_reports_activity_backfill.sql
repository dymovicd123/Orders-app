PRAGMA foreign_keys = ON;

-- Step 10: отчёты и ускорение журнала действий.
-- Новых обязательных таблиц нет: отчёты считаются по orders/payments/returns/exchanges/inventory_movements.
-- Индексы нужны, чтобы периодические отчёты и backfill журнала не тормозили на росте базы.
CREATE INDEX IF NOT EXISTS idx_payments_payment_date_kind ON payments(payment_date, payment_kind);
CREATE INDEX IF NOT EXISTS idx_returns_date_status ON returns(return_date, status);
CREATE INDEX IF NOT EXISTS idx_exchanges_date_status_finance ON exchanges(exchange_date, status, financial_action);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_type ON inventory_movements(created_at, movement_type, inventory_source);
CREATE INDEX IF NOT EXISTS idx_orders_date_status ON orders(order_date, order_status);
CREATE INDEX IF NOT EXISTS idx_activity_log_unique_return ON activity_log(entity_type, entity_id, event_type);

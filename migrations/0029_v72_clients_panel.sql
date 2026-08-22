-- Step 28: Clients panel performance indexes.
-- No data is moved. Clients are still built from customers + active/archive order history.

CREATE INDEX IF NOT EXISTS idx_orders_customer_status_date
  ON orders(customer_id, order_status, order_date);

CREATE INDEX IF NOT EXISTS idx_orders_customer_debt
  ON orders(customer_id, debt_amount);

CREATE INDEX IF NOT EXISTS idx_customers_display_name_city
  ON customers(display_name, city);

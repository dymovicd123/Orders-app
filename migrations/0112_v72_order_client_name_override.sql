-- Add a per-order display name without changing the shared customer identity or finances.
-- NULL: historical orders continue reading from customers.display_name.
-- Empty string: explicitly cleared name, do not fall back to a previous shared name.
ALTER TABLE orders ADD COLUMN customer_name_override TEXT;

-- Rebuild only the derived orders FTS; items/payments and business records are untouched.
DROP TRIGGER IF EXISTS trg_order_search_orders_ai;
DROP TRIGGER IF EXISTS trg_order_search_orders_au;
DROP TRIGGER IF EXISTS trg_order_search_managers_au;
DROP TRIGGER IF EXISTS trg_order_search_customers_au;

CREATE TRIGGER trg_order_search_orders_ai
AFTER INSERT ON orders
BEGIN
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  VALUES (
    NEW.id, NEW.id,
    COALESCE(NEW.external_id, '') || ' ' || COALESCE(NEW.order_date, '') || ' ' ||
    COALESCE((SELECT name FROM managers WHERE id = NEW.manager_id), '') || ' ' ||
    COALESCE((SELECT phone_normalized FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE(NEW.customer_name_override, (SELECT display_name FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE(NEW.city, '') || ' ' || COALESCE(NEW.delivery_type, '') || ' ' || COALESCE(NEW.comment, '')
  );
END;

CREATE TRIGGER trg_order_search_orders_au
AFTER UPDATE OF external_id, order_date, manager_id, customer_id, city, delivery_type, comment, customer_name_override ON orders
BEGIN
  DELETE FROM order_search_orders_fts WHERE rowid = OLD.id;
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  VALUES (
    NEW.id, NEW.id,
    COALESCE(NEW.external_id, '') || ' ' || COALESCE(NEW.order_date, '') || ' ' ||
    COALESCE((SELECT name FROM managers WHERE id = NEW.manager_id), '') || ' ' ||
    COALESCE((SELECT phone_normalized FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE(NEW.customer_name_override, (SELECT display_name FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE(NEW.city, '') || ' ' || COALESCE(NEW.delivery_type, '') || ' ' || COALESCE(NEW.comment, '')
  );
END;

CREATE TRIGGER trg_order_search_managers_au
AFTER UPDATE OF name ON managers
BEGIN
  DELETE FROM order_search_orders_fts WHERE rowid IN (SELECT id FROM orders WHERE manager_id = NEW.id);
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  SELECT o.id, o.id,
         COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
         COALESCE(NEW.name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
         COALESCE(o.customer_name_override, c.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.manager_id = NEW.id;
END;

CREATE TRIGGER trg_order_search_customers_au
AFTER UPDATE OF phone_normalized, display_name ON customers
BEGIN
  DELETE FROM order_search_orders_fts WHERE rowid IN (SELECT id FROM orders WHERE customer_id = NEW.id);
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  SELECT o.id, o.id,
         COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
         COALESCE(m.name, '') || ' ' || COALESCE(NEW.phone_normalized, '') || ' ' ||
         COALESCE(o.customer_name_override, NEW.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')
  FROM orders o
  LEFT JOIN managers m ON m.id = o.manager_id
  WHERE o.customer_id = NEW.id;
END;

DELETE FROM order_search_orders_fts;
INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
SELECT o.id, o.id,
       COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
       COALESCE(m.name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
       COALESCE(o.customer_name_override, c.display_name, '') || ' ' ||
       COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')
FROM orders o
LEFT JOIN managers m ON m.id = o.manager_id
LEFT JOIN customers c ON c.id = o.customer_id;

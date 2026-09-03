-- D1 read-budget R5.3: trigram FTS candidate indexes for generic order substring search.
-- Search tables are derived indexes only. Business tables remain the source of truth.
-- case_sensitive=1 plus the runtime raw/UPPER/lower query variants preserves the legacy INSTR behavior.

CREATE VIRTUAL TABLE IF NOT EXISTS order_search_orders_fts USING fts5(
  order_id UNINDEXED,
  search_text,
  tokenize='trigram case_sensitive 1'
);

CREATE VIRTUAL TABLE IF NOT EXISTS order_search_items_fts USING fts5(
  order_id UNINDEXED,
  search_text,
  tokenize='trigram case_sensitive 1'
);

CREATE VIRTUAL TABLE IF NOT EXISTS order_search_payments_fts USING fts5(
  order_id UNINDEXED,
  search_text,
  tokenize='trigram case_sensitive 1'
);

DELETE FROM order_search_orders_fts;
INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
SELECT o.id, o.id,
       COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
       COALESCE(m.name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
       COALESCE(c.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')
FROM orders o
LEFT JOIN managers m ON m.id = o.manager_id
LEFT JOIN customers c ON c.id = o.customer_id;

DELETE FROM order_search_items_fts;
INSERT INTO order_search_items_fts(rowid, order_id, search_text)
SELECT oi.id, oi.order_id,
       COALESCE(oi.product_name_snapshot, '') || ' ' || COALESCE(oi.gender_snapshot, '') || ' ' ||
       COALESCE(oi.color_snapshot, '') || ' ' || COALESCE(oi.material_snapshot, '') || ' ' ||
       COALESCE(oi.length_snapshot, '') || ' ' || COALESCE(oi.size_snapshot, '')
FROM order_items oi;

DELETE FROM order_search_payments_fts;
INSERT INTO order_search_payments_fts(rowid, order_id, search_text)
SELECT p.id, p.order_id, COALESCE(p.method, '') || ' ' || COALESCE(p.comment, '')
FROM payments p;

CREATE TRIGGER IF NOT EXISTS trg_order_search_orders_ai
AFTER INSERT ON orders
BEGIN
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  VALUES (
    NEW.id, NEW.id,
    COALESCE(NEW.external_id, '') || ' ' || COALESCE(NEW.order_date, '') || ' ' ||
    COALESCE((SELECT name FROM managers WHERE id = NEW.manager_id), '') || ' ' ||
    COALESCE((SELECT phone_normalized FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE((SELECT display_name FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE(NEW.city, '') || ' ' || COALESCE(NEW.delivery_type, '') || ' ' || COALESCE(NEW.comment, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_orders_ad
AFTER DELETE ON orders
BEGIN
  DELETE FROM order_search_orders_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_orders_au
AFTER UPDATE OF external_id, order_date, manager_id, customer_id, city, delivery_type, comment ON orders
BEGIN
  DELETE FROM order_search_orders_fts WHERE rowid = OLD.id;
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  VALUES (
    NEW.id, NEW.id,
    COALESCE(NEW.external_id, '') || ' ' || COALESCE(NEW.order_date, '') || ' ' ||
    COALESCE((SELECT name FROM managers WHERE id = NEW.manager_id), '') || ' ' ||
    COALESCE((SELECT phone_normalized FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE((SELECT display_name FROM customers WHERE id = NEW.customer_id), '') || ' ' ||
    COALESCE(NEW.city, '') || ' ' || COALESCE(NEW.delivery_type, '') || ' ' || COALESCE(NEW.comment, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_items_ai
AFTER INSERT ON order_items
BEGIN
  INSERT INTO order_search_items_fts(rowid, order_id, search_text)
  VALUES (NEW.id, NEW.order_id, COALESCE(NEW.product_name_snapshot, '') || ' ' || COALESCE(NEW.gender_snapshot, '') || ' ' || COALESCE(NEW.color_snapshot, '') || ' ' || COALESCE(NEW.material_snapshot, '') || ' ' || COALESCE(NEW.length_snapshot, '') || ' ' || COALESCE(NEW.size_snapshot, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_items_ad
AFTER DELETE ON order_items
BEGIN
  DELETE FROM order_search_items_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_items_au
AFTER UPDATE OF order_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot ON order_items
BEGIN
  DELETE FROM order_search_items_fts WHERE rowid = OLD.id;
  INSERT INTO order_search_items_fts(rowid, order_id, search_text)
  VALUES (NEW.id, NEW.order_id, COALESCE(NEW.product_name_snapshot, '') || ' ' || COALESCE(NEW.gender_snapshot, '') || ' ' || COALESCE(NEW.color_snapshot, '') || ' ' || COALESCE(NEW.material_snapshot, '') || ' ' || COALESCE(NEW.length_snapshot, '') || ' ' || COALESCE(NEW.size_snapshot, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_payments_ai
AFTER INSERT ON payments
BEGIN
  INSERT INTO order_search_payments_fts(rowid, order_id, search_text)
  VALUES (NEW.id, NEW.order_id, COALESCE(NEW.method, '') || ' ' || COALESCE(NEW.comment, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_payments_ad
AFTER DELETE ON payments
BEGIN
  DELETE FROM order_search_payments_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_payments_au
AFTER UPDATE OF order_id, method, comment ON payments
BEGIN
  DELETE FROM order_search_payments_fts WHERE rowid = OLD.id;
  INSERT INTO order_search_payments_fts(rowid, order_id, search_text)
  VALUES (NEW.id, NEW.order_id, COALESCE(NEW.method, '') || ' ' || COALESCE(NEW.comment, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_managers_au
AFTER UPDATE OF name ON managers
BEGIN
  DELETE FROM order_search_orders_fts WHERE rowid IN (SELECT id FROM orders WHERE manager_id = NEW.id);
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  SELECT o.id, o.id,
         COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
         COALESCE(NEW.name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
         COALESCE(c.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.manager_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_order_search_customers_au
AFTER UPDATE OF phone_normalized, display_name ON customers
BEGIN
  DELETE FROM order_search_orders_fts WHERE rowid IN (SELECT id FROM orders WHERE customer_id = NEW.id);
  INSERT INTO order_search_orders_fts(rowid, order_id, search_text)
  SELECT o.id, o.id,
         COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
         COALESCE(m.name, '') || ' ' || COALESCE(NEW.phone_normalized, '') || ' ' ||
         COALESCE(NEW.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')
  FROM orders o
  LEFT JOIN managers m ON m.id = o.manager_id
  WHERE o.customer_id = NEW.id;
END;

PRAGMA optimize;

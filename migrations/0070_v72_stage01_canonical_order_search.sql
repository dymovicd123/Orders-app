-- Stage01 R14: keep the derived order-item search index aligned with current canonical
-- catalog identity while preserving immutable order-time snapshots as searchable history.
-- Business rows are not rewritten here; only the derived FTS index/triggers change.

DELETE FROM order_search_items_fts;

INSERT INTO order_search_items_fts(rowid, order_id, search_text)
SELECT
  oi.id,
  oi.order_id,
  COALESCE(p.name, '') || ' ' ||
  COALESCE(v.gender, '') || ' ' ||
  COALESCE(v.color, '') || ' ' ||
  COALESCE(v.material, '') || ' ' ||
  COALESCE(v.length, '') || ' ' ||
  COALESCE(v.size_label, '') || ' ' ||
  COALESCE(oi.product_name_snapshot, '') || ' ' ||
  COALESCE(oi.gender_snapshot, '') || ' ' ||
  COALESCE(oi.color_snapshot, '') || ' ' ||
  COALESCE(oi.material_snapshot, '') || ' ' ||
  COALESCE(oi.length_snapshot, '') || ' ' ||
  COALESCE(oi.size_snapshot, '')
FROM order_items oi
LEFT JOIN catalog_products p ON p.id = oi.product_id
LEFT JOIN catalog_variants v ON v.id = oi.variant_id;

DROP TRIGGER IF EXISTS trg_order_search_items_ai;
DROP TRIGGER IF EXISTS trg_order_search_items_ad;
DROP TRIGGER IF EXISTS trg_order_search_items_au;
DROP TRIGGER IF EXISTS trg_order_search_catalog_products_au;
DROP TRIGGER IF EXISTS trg_order_search_catalog_variants_au;

CREATE TRIGGER trg_order_search_items_ai
AFTER INSERT ON order_items
BEGIN
  INSERT INTO order_search_items_fts(rowid, order_id, search_text)
  VALUES (
    NEW.id,
    NEW.order_id,
    COALESCE((SELECT name FROM catalog_products WHERE id = NEW.product_id), '') || ' ' ||
    COALESCE((SELECT gender FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT color FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT material FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT length FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT size_label FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE(NEW.product_name_snapshot, '') || ' ' ||
    COALESCE(NEW.gender_snapshot, '') || ' ' ||
    COALESCE(NEW.color_snapshot, '') || ' ' ||
    COALESCE(NEW.material_snapshot, '') || ' ' ||
    COALESCE(NEW.length_snapshot, '') || ' ' ||
    COALESCE(NEW.size_snapshot, '')
  );
END;

CREATE TRIGGER trg_order_search_items_ad
AFTER DELETE ON order_items
BEGIN
  DELETE FROM order_search_items_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER trg_order_search_items_au
AFTER UPDATE OF
  order_id,
  product_id,
  variant_id,
  product_name_snapshot,
  gender_snapshot,
  color_snapshot,
  material_snapshot,
  length_snapshot,
  size_snapshot
ON order_items
BEGIN
  DELETE FROM order_search_items_fts WHERE rowid = OLD.id;
  INSERT INTO order_search_items_fts(rowid, order_id, search_text)
  VALUES (
    NEW.id,
    NEW.order_id,
    COALESCE((SELECT name FROM catalog_products WHERE id = NEW.product_id), '') || ' ' ||
    COALESCE((SELECT gender FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT color FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT material FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT length FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE((SELECT size_label FROM catalog_variants WHERE id = NEW.variant_id), '') || ' ' ||
    COALESCE(NEW.product_name_snapshot, '') || ' ' ||
    COALESCE(NEW.gender_snapshot, '') || ' ' ||
    COALESCE(NEW.color_snapshot, '') || ' ' ||
    COALESCE(NEW.material_snapshot, '') || ' ' ||
    COALESCE(NEW.length_snapshot, '') || ' ' ||
    COALESCE(NEW.size_snapshot, '')
  );
END;

CREATE TRIGGER trg_order_search_catalog_products_au
AFTER UPDATE OF name ON catalog_products
BEGIN
  DELETE FROM order_search_items_fts
  WHERE rowid IN (SELECT id FROM order_items WHERE product_id = NEW.id);

  INSERT INTO order_search_items_fts(rowid, order_id, search_text)
  SELECT
    oi.id,
    oi.order_id,
    COALESCE(NEW.name, '') || ' ' ||
    COALESCE(v.gender, '') || ' ' ||
    COALESCE(v.color, '') || ' ' ||
    COALESCE(v.material, '') || ' ' ||
    COALESCE(v.length, '') || ' ' ||
    COALESCE(v.size_label, '') || ' ' ||
    COALESCE(oi.product_name_snapshot, '') || ' ' ||
    COALESCE(oi.gender_snapshot, '') || ' ' ||
    COALESCE(oi.color_snapshot, '') || ' ' ||
    COALESCE(oi.material_snapshot, '') || ' ' ||
    COALESCE(oi.length_snapshot, '') || ' ' ||
    COALESCE(oi.size_snapshot, '')
  FROM order_items oi
  LEFT JOIN catalog_variants v ON v.id = oi.variant_id
  WHERE oi.product_id = NEW.id;
END;

CREATE TRIGGER trg_order_search_catalog_variants_au
AFTER UPDATE OF gender, color, material, length, size_label ON catalog_variants
BEGIN
  DELETE FROM order_search_items_fts
  WHERE rowid IN (SELECT id FROM order_items WHERE variant_id = NEW.id);

  INSERT INTO order_search_items_fts(rowid, order_id, search_text)
  SELECT
    oi.id,
    oi.order_id,
    COALESCE(p.name, '') || ' ' ||
    COALESCE(NEW.gender, '') || ' ' ||
    COALESCE(NEW.color, '') || ' ' ||
    COALESCE(NEW.material, '') || ' ' ||
    COALESCE(NEW.length, '') || ' ' ||
    COALESCE(NEW.size_label, '') || ' ' ||
    COALESCE(oi.product_name_snapshot, '') || ' ' ||
    COALESCE(oi.gender_snapshot, '') || ' ' ||
    COALESCE(oi.color_snapshot, '') || ' ' ||
    COALESCE(oi.material_snapshot, '') || ' ' ||
    COALESCE(oi.length_snapshot, '') || ' ' ||
    COALESCE(oi.size_snapshot, '')
  FROM order_items oi
  LEFT JOIN catalog_products p ON p.id = oi.product_id
  WHERE oi.variant_id = NEW.id;
END;

PRAGMA optimize;

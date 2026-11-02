-- CLIENT3 WATCHES ONLY: shared choices for BOTH brands. No change to Main/Branch2.
-- Additive: existing watch orders, stock, reservations, money are untouched.
CREATE TABLE IF NOT EXISTS watch_reference_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('leatherColors','paymentMethods','deliveryMethods')),
  value TEXT NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 80),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind,value COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS idx_watch_ref_kind_active
  ON watch_reference_values(kind,is_active,value);

INSERT OR IGNORE INTO watch_reference_values(kind,value)
VALUES
  ('paymentMethods','KASPI GOLD'),
  ('paymentMethods','KASPI RED'),
  ('paymentMethods','Рассрочка'),
  ('deliveryMethods','Казпочта'),
  ('deliveryMethods','Курьер'),
  ('deliveryMethods','Самовывоз'),
  ('deliveryMethods','Межгород');

-- Existing leather colors may have been entered in either brand.
-- Preserve every color globally; do not rewrite existing SKU identities.
INSERT OR IGNORE INTO watch_reference_values(kind,value)
SELECT 'leatherColors',trim(v.bracelet_color)
FROM watch_variants v
WHERE v.bracelet_material='leather' AND length(trim(v.bracelet_color)) BETWEEN 1 AND 80
GROUP BY upper(trim(v.bracelet_color));

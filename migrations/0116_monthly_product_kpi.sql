CREATE TABLE IF NOT EXISTS product_kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, title TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES catalog_products(id),
  filters_json TEXT NOT NULL DEFAULT '{}', target_quantity INTEGER NOT NULL CHECK(target_quantity>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_kpis_month ON product_kpis(month,id);
CREATE TABLE IF NOT EXISTS product_kpi_participants (
  kpi_id INTEGER NOT NULL REFERENCES product_kpis(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES managers(id), quota INTEGER NOT NULL CHECK(quota>0),
  bonus_amount INTEGER NOT NULL DEFAULT 0 CHECK(bonus_amount>=0),
  PRIMARY KEY(kpi_id,manager_id)
);
CREATE INDEX IF NOT EXISTS idx_product_kpi_participants_manager ON product_kpi_participants(manager_id,kpi_id);
CREATE TABLE IF NOT EXISTS product_kpi_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,kpi_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,actor TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL
);

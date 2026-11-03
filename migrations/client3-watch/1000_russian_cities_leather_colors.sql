-- Isolated Client3. Main city names copied verbatim from Main
-- migrations/0002_reference_values.sql, with uppercase values as in Main.
-- City editing is independent from watch SKU and order identity.
CREATE TABLE IF NOT EXISTS watch_city_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'cities' CHECK(kind='cities'),
  value TEXT NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 80),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind,value COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS idx_watch_city_values_active
ON watch_city_values(kind,is_active,value);
INSERT OR IGNORE INTO watch_city_values(kind,value,is_active) VALUES
  ('cities','АЛМАТЫ',1),
  ('cities','АСТАНА',1),
  ('cities','ШЫМКЕНТ',1),
  ('cities','КАРАГАНДА',1),
  ('cities','АКТОБЕ',1),
  ('cities','ТАРАЗ',1),
  ('cities','ПАВЛОДАР',1),
  ('cities','СЕМЕЙ',1),
  ('cities','УСТЬ-КАМЕНОГОРСК',1),
  ('cities','ҚЫЗЫЛОРДА',1),
  ('cities','КОСТАНАЙ',1),
  ('cities','АТЫРАУ',1),
  ('cities','АКТАУ',1),
  ('cities','ТАЛДЫКОРГАН',1),
  ('cities','ТУРКЕСТАН',1),
  ('cities','ПЕТРОПАВЛОВСК',1),
  ('cities','КОКШЕТАУ',1),
  ('cities','ЖЕЗКАЗГАН',1),
  ('cities','ТЕМИРТАУ',1),
  ('cities','ЭКИБАСТУЗ',1),
  ('cities','БАЛХАШ',1),
  ('cities','РУДНЫЙ',1),
  ('cities','САТПАЕВ',1),
  ('cities','РИДДЕР',1),
  ('cities','КАСКЕЛЕН',1),
  ('cities','ТАЛГАР',1),
  ('cities','ЕСИК',1),
  ('cities','ШЕЛЕК',1),
  ('cities','САРЫАГАШ',1),
  ('cities','ШИЕЛИ',1),
  ('cities','ЖАНАКОРГАН',1),
  ('cities','АРАЛЬСК',1),
  ('cities','БАЙКОНУР',1),
  ('cities','УРАЛЬСК',1),
  ('cities','АКСАЙ',1),
  ('cities','ЖАРКЕНТ',1),
  ('cities','КЕНТАУ',1),
  ('cities','ЛЕНГЕР',1),
  ('cities','ШУ',1),
  ('cities','КАРАТАУ',1),
  ('cities','АКСУКЕНТ',1),
  ('cities','ЖЕТЫСАЙ',1),
  ('cities','ЖАНАОЗЕН',1),
  ('cities','КУЛЬСАРЫ',1),
  ('cities','ХРОМТАУ',1),
  ('cities','ШАРДАРА',1);

-- Seed requested leather strap colors without duplicating historical
-- 'ЧЁРНЫЙ' as a different stock identity from 'ЧЕРНЫЙ'.
-- Exact existing SKU spellings remain intact (no changes to sold variants).
INSERT OR IGNORE INTO watch_reference_values(kind,value,is_active)
SELECT 'leatherColors','ЧЕРНЫЙ',1
WHERE NOT EXISTS (
  SELECT 1 FROM watch_reference_values
  WHERE kind='leatherColors' AND REPLACE(value,'Ё','Е')='ЧЕРНЫЙ'
);
INSERT OR IGNORE INTO watch_reference_values(kind,value,is_active)
SELECT 'leatherColors','КОРИЧНЕВЫЙ',1
WHERE NOT EXISTS (
  SELECT 1 FROM watch_reference_values
  WHERE kind='leatherColors' AND value='КОРИЧНЕВЫЙ'
);
UPDATE watch_reference_values SET is_active=1
WHERE kind='leatherColors' AND
  (REPLACE(value,'Ё','Е')='ЧЕРНЫЙ' OR value='КОРИЧНЕВЫЙ');

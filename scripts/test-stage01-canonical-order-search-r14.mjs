import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const source = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const baseMigration = fs.readFileSync('migrations/0064_v72_d1_read_budget_r5_order_search_fts.sql', 'utf8')
const migration = fs.readFileSync('migrations/0070_v72_stage01_canonical_order_search.sql', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(source.includes("LEFT JOIN catalog_products search_product ON search_product.id = oi.product_id"), 'Short order search does not read current canonical product identity')
check(source.includes("LEFT JOIN catalog_variants search_variant ON search_variant.id = oi.variant_id"), 'Short order search does not read current canonical variant identity')
check(source.includes("COALESCE(search_product.name, '')"), 'Short order search does not include canonical product name')
check(source.includes("COALESCE(search_variant.size_label, '')"), 'Short order search does not include canonical SKU details')
check(source.includes("COALESCE(oi.product_name_snapshot, '')"), 'Short order search lost historical snapshot vocabulary')
check(source.includes('order_search_items_fts MATCH ?'), '>=3-character order search no longer uses the bounded FTS path')

for (const fragment of [
  'LEFT JOIN catalog_products p ON p.id = oi.product_id',
  'LEFT JOIN catalog_variants v ON v.id = oi.variant_id',
  'AFTER UPDATE OF\\n  order_id,\\n  product_id,\\n  variant_id,',
  'CREATE TRIGGER trg_order_search_catalog_products_au',
  'CREATE TRIGGER trg_order_search_catalog_variants_au',
  "COALESCE(oi.product_name_snapshot, '')",
]) check(migration.includes(fragment), 'Canonical order-search migration missing: ' + fragment)

check(!/\\b(?:UPDATE|DELETE FROM)\\s+(?:orders|order_items|payments|catalog_products|catalog_variants)\\b/i.test(migration), 'R14 migration must not rewrite business/history rows')
check(migration.includes('DELETE FROM order_search_items_fts'), 'R14 must rebuild only the derived item search index')

const db = new DatabaseSync(':memory:')
db.exec([
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, external_id TEXT, order_date TEXT, manager_id INTEGER, customer_id INTEGER, city TEXT, delivery_type TEXT, comment TEXT);',
  'CREATE TABLE managers (id INTEGER PRIMARY KEY, name TEXT);',
  'CREATE TABLE customers (id INTEGER PRIMARY KEY, phone_normalized TEXT, display_name TEXT);',
  'CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id INTEGER, method TEXT, comment TEXT);',
  'CREATE TABLE catalog_products (id INTEGER PRIMARY KEY, name TEXT, category TEXT);',
  'CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY, product_id INTEGER, category TEXT, gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT);',
  'CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, variant_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT);',
  "INSERT INTO orders(id, external_id, order_date, city) VALUES (1, 'ORD-R14-0001', '2026-09-18', 'Алматы');",
  "INSERT INTO order_items(id, order_id, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot) VALUES (11, 1, NULL, NULL, 'ИСТОРИЧЕСКОЕ ПАЛЬТО', 'ЖЕН', 'СТАРЫЙ ЦВЕТ', 'ШЕРСТЬ', 'ДЛИННОЕ', '46');",
  "INSERT INTO catalog_products(id, name, category) VALUES (101, 'КАНОНИЧЕСКОЕ ПАЛЬТО', 'adult');",
  "INSERT INTO catalog_variants(id, product_id, category, gender, color, material, length, size_label) VALUES (201, 101, 'adult', 'ЖЕН', 'СИНИЙ', 'КАШЕМИР', 'МАКСИ', '48');",
].join('\n'))

db.exec(baseMigration)
db.exec(migration)

const find = (query) => db.prepare('SELECT CAST(order_id AS INTEGER) AS order_id FROM order_search_items_fts WHERE order_search_items_fts MATCH ? ORDER BY rowid').all('"' + query + '"').map(row => Number(row.order_id))

check(find('ИСТОРИЧЕСКОЕ ПАЛЬТО').includes(1), 'Historical snapshot stopped being searchable after R14 rebuild')
check(!find('КАНОНИЧЕСКОЕ ПАЛЬТО').includes(1), 'Unlinked canonical product must not be invented into live search')

db.exec('UPDATE order_items SET product_id = 101, variant_id = 201 WHERE id = 11')
check(find('КАНОНИЧЕСКОЕ ПАЛЬТО').includes(1), 'Resolver product link did not refresh the item FTS index')
check(find('СИНИЙ').includes(1), 'Resolver variant link did not refresh canonical SKU search')
check(find('ИСТОРИЧЕСКОЕ ПАЛЬТО').includes(1), 'Resolver repair erased historical search vocabulary')

db.exec("UPDATE catalog_products SET name = 'НОВОЕ КАНОНИЧЕСКОЕ ИМЯ' WHERE id = 101")
check(find('НОВОЕ КАНОНИЧЕСКОЕ ИМЯ').includes(1), 'Catalog product rename did not refresh linked order search')
check(!find('КАНОНИЧЕСКОЕ ПАЛЬТО').includes(1), 'Old canonical product name stayed stale in the derived FTS row')

db.exec("UPDATE catalog_variants SET color = 'ЗЕЛЁНЫЙ', size_label = '50' WHERE id = 201")
check(find('ЗЕЛЁНЫЙ').includes(1), 'Catalog variant edit did not refresh linked SKU search')
check(find('50').includes(1), 'Catalog variant size edit did not refresh linked SKU search')
check(!find('СИНИЙ').includes(1), 'Old canonical SKU value stayed stale in the derived FTS row')

db.exec('UPDATE order_items SET product_id = NULL, variant_id = NULL WHERE id = 11')
check(!find('НОВОЕ КАНОНИЧЕСКОЕ ИМЯ').includes(1), 'Removed canonical link remained searchable')
check(find('ИСТОРИЧЕСКОЕ ПАЛЬТО').includes(1), 'Snapshot fallback disappeared after canonical unlink')

db.close()

console.log('STAGE01 CANONICAL ORDER SEARCH R14 PASSED — working order search follows Resolver/catalog identity changes while immutable order-time vocabulary remains searchable history')

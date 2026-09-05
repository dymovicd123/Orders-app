from pathlib import Path

path = Path('scripts/test-stocktake-functional-acceptance.mjs')
text = path.read_text(encoding='utf-8')

marker = '''    CREATE TABLE inventory_stock (\n'''
insert = '''    CREATE TABLE inventory_lifecycle_events (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      direction TEXT NOT NULL,\n      inventory_source TEXT NOT NULL,\n      variant_id INTEGER REFERENCES catalog_variants(id),\n      is_workshop INTEGER NOT NULL DEFAULT 0,\n      status TEXT NOT NULL DEFAULT 'pending',\n      pending_reason TEXT,\n      resolution_comment TEXT,\n      created_at TEXT NOT NULL,\n      updated_at TEXT,\n      cancelled_at TEXT\n    );\n\n    CREATE TABLE inventory_stock (\n'''

if text.count(marker) != 1:
    raise SystemExit(f'stocktake fixture lifecycle schema: expected 1 match, found {text.count(marker)}')
path.write_text(text.replace(marker, insert, 1), encoding='utf-8')
print('Stocktake functional fixture updated with existing lifecycle table contract')

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

phase = sys.argv[1] if len(sys.argv) == 2 else ''
if phase not in ('before', 'after-foundation', 'after-integrity', 'worker-after'):
    raise SystemExit('Unexpected verification phase')

expected_worker = 'orders-app-branch2'
expected_db = '0904a573-21ff-44d8-93b0-c9200f771702'
expected_name = 'orders_db_branch2_mirror_20261027'
config = json.loads(Path('wrangler.jsonc').read_text())
if config.get('name') != expected_worker or config.get('main') != 'worker/index.ts':
    raise SystemExit('ABORT: wrong Worker source')
if config.get('env') is not None:
    raise SystemExit('ABORT: Wrangler environment override')
if config.get('d1_databases') != [{
    'binding': 'DB', 'database_name': expected_name, 'database_id': expected_db
}]:
    raise SystemExit('ABORT: wrong D1 source configuration')

for migration in ('0136_barcode_physical_units_foundation.sql', '0137_barcode_unit_catalog_integrity.sql'):
    sql = Path('migrations', migration).read_text()
    if re.search(r'(?im)^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\s+', sql):
        raise SystemExit('ABORT: unexpected schema migration write: ' + migration)

account = os.environ['CLOUDFLARE_ACCOUNT_ID'].strip()
token = os.environ['CLOUDFLARE_API_TOKEN'].strip()
root = 'https://api.cloudflare.com/client/v4/accounts/' + account

def request_json(path, payload=None):
    body = None if payload is None else json.dumps(payload).encode('utf8')
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(root + path, headers=headers,
        data=body, method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(request, timeout=40) as response:
        value = json.load(response)
    if not value.get('success'):
        raise SystemExit('ABORT: Cloudflare API failure')
    return value['result']

bindings = request_json('/workers/scripts/' + expected_worker + '/settings').get('bindings', [])
database = [x for x in bindings if x.get('name') == 'DB']
if len(database) != 1 or database[0].get('type') != 'd1':
    raise SystemExit('ABORT: wrong Worker D1 binding count or type')
if (database[0].get('database_id') or database[0].get('id')) != expected_db:
    raise SystemExit('ABORT: active Worker bound to wrong D1')
if not any(x.get('name') == 'ADMIN_MODE_SESSION_SECRET' for x in bindings):
    raise SystemExit('ABORT: session secret missing')

if phase == 'worker-after':
    print('BRANCH2_BARCODE_WORKER_BINDINGS_OK')
    sys.exit(0)

sql = """SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
     AND name IN ('catalog_products','catalog_stock_positions','catalog_variants')) AS catalog_tables,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
     AND name IN ('inventory_units','inventory_unit_labels','inventory_unit_events',
                  'barcode_print_batches','barcode_print_batch_labels')) AS unit_tables,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
     AND name LIKE 'trg_barcode_unit_%') AS unit_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
     AND name='idx_inventory_units_original_variant') AS history_index"""
result = request_json('/d1/database/' + expected_db + '/query', {'sql': sql, 'params': []})
if len(result) != 1 or len(result[0].get('results', [])) != 1:
    raise SystemExit('ABORT: Branch2 D1 inspection incomplete')
values = result[0]['results'][0]
catalog = int(values.get('catalog_tables') or 0)
units = int(values.get('unit_tables') or 0)
triggers = int(values.get('unit_triggers') or 0)
history = int(values.get('history_index') or 0)
if catalog != 3:
    raise SystemExit('ABORT: baseline Branch2 catalog tables missing')
print('BRANCH2_SCHEMA_COUNTS phase=' + phase +
      ' catalog=' + str(catalog) + ' unit_tables=' + str(units) +
      ' triggers=' + str(triggers) + ' history_index=' + str(history))

if phase == 'before':
    if units or triggers or history:
        raise SystemExit('ABORT: schema already applied or partially applied; manual review required')
elif phase == 'after-foundation':
    if (units, triggers, history) != (5, 0, 0):
        raise SystemExit('ABORT: 0136 migration incomplete')
else:
    if (units, triggers, history) != (5, 12, 1):
        raise SystemExit('ABORT: 0137 migration incomplete')

if phase != 'before':
    counts_sql = """SELECT
       (SELECT COUNT(*) FROM inventory_units) AS units,
       (SELECT COUNT(*) FROM inventory_unit_labels) AS labels,
       (SELECT COUNT(*) FROM inventory_unit_events) AS events,
       (SELECT COUNT(*) FROM barcode_print_batches) AS batches,
       (SELECT COUNT(*) FROM barcode_print_batch_labels) AS batch_labels"""
    rows = request_json('/d1/database/' + expected_db + '/query',
                        {'sql': counts_sql, 'params': []})
    if len(rows) != 1 or len(rows[0].get('results', [])) != 1:
        raise SystemExit('ABORT: initial barcode data verification failed')
    if any(int(value or 0) != 0 for value in rows[0]['results'][0].values()):
        raise SystemExit('ABORT: unexpected individual-item data in newly created tables')
print('BRANCH2_BARCODE_SCHEMA_' + phase.upper().replace('-', '_') + '_PASS')

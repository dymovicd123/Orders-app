import json
import os
import sys
import urllib.request
from pathlib import Path

phase = sys.argv[1] if len(sys.argv) == 2 else ''
if phase not in ('before', 'after', 'worker-after'):
    raise SystemExit('ABORT: missing expected phase')

config = json.loads(Path('wrangler.jsonc').read_text())
database_id = '0904a573-21ff-44d8-93b0-c9200f771702'
if config.get('name') != 'orders-app-branch2' or config.get('main') != 'worker/index.ts':
    raise SystemExit('ABORT: wrong Worker')
if config.get('env') is not None or config.get('d1_databases') != [{
    'binding':'DB','database_name':'orders_db_branch2_mirror_20261027','database_id':database_id
}]:
    raise SystemExit('ABORT: unexpected D1 config')

account = os.environ['CLOUDFLARE_ACCOUNT_ID'].strip()
token = os.environ['CLOUDFLARE_API_TOKEN'].strip()
root = 'https://api.cloudflare.com/client/v4/accounts/' + account

def call(path, body=None):
    headers = {'Authorization':'Bearer ' + token, 'Accept':'application/json'}
    content = None if body is None else json.dumps(body).encode('utf8')
    if content is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(root + path, headers=headers, data=content,
        method='POST' if content is not None else 'GET')
    with urllib.request.urlopen(request, timeout=40) as response:
        answer = json.load(response)
    if not answer.get('success'):
        raise SystemExit('ABORT: Cloudflare request unsuccessful')
    return answer['result']

worker = call('/workers/scripts/orders-app-branch2/settings')
bindings = worker.get('bindings', [])
db = [item for item in bindings if item.get('name') == 'DB']
if len(db) != 1 or db[0].get('type') != 'd1' or (
    db[0].get('database_id') or db[0].get('id')) != database_id:
    raise SystemExit('ABORT: active Worker not bound to approved Branch2 D1')
if not any(item.get('name') == 'ADMIN_MODE_SESSION_SECRET' for item in bindings):
    raise SystemExit('ABORT: admin session secret missing')
other_bindings = {item.get('name'):item.get('type') for item in bindings if item.get('name') != 'DB'}
record = Path('.branch2-barcode-prep-bindings-before.json')
if phase == 'before':
    record.write_text(json.dumps(other_bindings))
elif record.exists():
    initial = json.loads(record.read_text())
    if any(other_bindings.get(key) != value for key, value in initial.items()):
        raise SystemExit('ABORT: existing Worker secrets/variables changed')

sql = """SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
   AND name IN ('inventory_units','inventory_unit_labels','inventory_unit_events',
                'barcode_print_batches','barcode_print_batch_labels')) AS table_count,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
   AND name LIKE 'trg_barcode_unit_%') AS original_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
   AND name IN ('trg_barcode_prepared_unit_capacity',
                'trg_barcode_prepared_batch_cancel_integrity')) AS new_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
   AND name='idx_inventory_units_original_variant') AS original_index,
  (SELECT COUNT(*) FROM inventory_units) AS item_count,
  (SELECT COUNT(*) FROM inventory_unit_labels) AS label_count,
  (SELECT COUNT(*) FROM inventory_unit_events) AS event_count,
  (SELECT COUNT(*) FROM barcode_print_batches) AS batch_count,
  (SELECT COUNT(*) FROM barcode_print_batch_labels) AS batch_label_count"""
answers = call('/d1/database/' + database_id + '/query', {'sql':sql,'params':[]})
if len(answers) != 1 or len(answers[0].get('results', [])) != 1:
    raise SystemExit('ABORT: D1 schema inspection returned unexpected shape')
row = answers[0]['results'][0]
if any(int(row.get(key) or 0) != expected for key, expected in [
    ('table_count',5),('original_triggers',12),('original_index',1),
    ('item_count',0),('label_count',0),('event_count',0),
    ('batch_count',0),('batch_label_count',0)
]):
    raise SystemExit('ABORT: Branch2 D1 is not the approved empty barcode baseline: ' + str(row))
expected_triggers = 0 if phase == 'before' else 2
if int(row.get('new_triggers') or 0) != expected_triggers:
    raise SystemExit('ABORT: unexpected preparation migration state: ' + str(row.get('new_triggers')))
print('BRANCH2_BARCODE_PREPARATION_' + phase.upper().replace('-', '_') +
      '_PASS_D1_5_TABLES_12_OLD_TRIGGERS_' + str(expected_triggers) +
      '_NEW_TRIGGERS_0_UNITS')

import json
import os
import sys
import urllib.request
from pathlib import Path

phase = sys.argv[1] if len(sys.argv)==2 else ''
if phase not in ('before','after','worker-after'):
    raise SystemExit('ABORT: invalid release phase')

expected_id = '0904a573-21ff-44d8-93b0-c9200f771702'
cfg=json.loads(Path('wrangler.jsonc').read_text())
if cfg.get('name')!='orders-app-branch2' or cfg.get('main')!='worker/index.ts':
    raise SystemExit('ABORT: target Worker is not Branch2')
if cfg.get('env') is not None or cfg.get('d1_databases')!=[{
    'binding':'DB','database_name':'orders_db_branch2_mirror_20261027',
    'database_id':expected_id
}]:
    raise SystemExit('ABORT: expected Branch2-only DB configuration')

account=os.environ['CLOUDFLARE_ACCOUNT_ID'].strip()
token=os.environ['CLOUDFLARE_API_TOKEN'].strip()
base='https://api.cloudflare.com/client/v4/accounts/'+account
def call(path,payload=None):
    headers={'Authorization':'Bearer '+token,'Accept':'application/json'}
    body=None if payload is None else json.dumps(payload).encode('utf8')
    if body is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request(base+path,headers=headers,data=body,
        method='POST' if payload is not None else 'GET')
    with urllib.request.urlopen(req,timeout=40) as response:result=json.load(response)
    if not result.get('success'):raise SystemExit('ABORT: Cloudflare API check failed')
    return result['result']
worker=call('/workers/scripts/orders-app-branch2/settings')
bindings=worker.get('bindings',[])
db=[x for x in bindings if x.get('name')=='DB']
if len(db)!=1 or db[0].get('type')!='d1' or (db[0].get('database_id') or db[0].get('id'))!=expected_id:
    raise SystemExit('ABORT: active Worker is not connected to approved test D1')
if not any(x.get('name')=='ADMIN_MODE_SESSION_SECRET' for x in bindings):
    raise SystemExit('ABORT: missing session secret')
other={x.get('name'):x.get('type') for x in bindings if x.get('name')!='DB'}
snapshot=Path('.branch2-dds-preflight.json')
if phase=='before':
    snapshot.write_text(json.dumps({'bindings':other}))
elif snapshot.exists() and other!=json.loads(snapshot.read_text())['bindings']:
    raise SystemExit('ABORT: existing Worker binding changed')
def query(sql):
    result=call('/d1/database/'+expected_id+'/query',{'sql':sql,'params':[]})
    if len(result)!=1:raise SystemExit('ABORT: unexpected D1 query result')
    return result[0].get('results',[])
rows=query("""SELECT
 (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dds_entries') AS journal,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dds_categories') AS categories,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dds_articles') AS articles,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dds_entry_edits') AS edit_journal,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN
 ('dds_edit_cas_guard','dds_edit_audit','dds_edit_audit_immutable_update','dds_edit_audit_immutable_delete')) AS edit_triggers,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN
 ('idx_dds_entry_last_edit_request','idx_dds_entry_edits_entry')) AS edit_indexes,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='dds_prevent_overdraft') AS legacy_overdraft,
 (SELECT COUNT(*) FROM dds_entries) AS entry_count,
 (SELECT COALESCE(SUM(amount),0) FROM dds_entries) AS sum_amount""")
if len(rows)!=1:raise SystemExit('ABORT: invalid schema answer')
v=rows[0]
for name,expected in [('journal',1),('categories',1),('articles',1),('legacy_overdraft',0)]:
    if int(v[name])!=expected:raise SystemExit('ABORT: invalid legacy DDS baseline: '+name)
cols=query("PRAGMA table_info(dds_entries)")
column_names={str(x.get('name')) for x in cols}
new_cols={'edit_version','last_edit_request_id','last_edited_by_user_id','last_edited_at','last_edit_reason'}
if phase=='before':
    if int(v['edit_journal'])!=0 or int(v['edit_triggers'])!=0 or int(v['edit_indexes'])!=0 or column_names.intersection(new_cols):
        raise SystemExit('ABORT: migration already present or partial')
    original=json.loads(snapshot.read_text())
    original['count']=int(v['entry_count'])
    original['amount']=int(v['sum_amount'])
    snapshot.write_text(json.dumps(original))
else:
    if int(v['edit_journal'])!=1 or int(v['edit_triggers'])!=4 or int(v['edit_indexes'])!=2 or not new_cols.issubset(column_names):
        raise SystemExit('ABORT: 0139 audit migration not complete')
    if snapshot.exists():
        original=json.loads(snapshot.read_text())
        if int(v['entry_count'])!=original['count'] or int(v['sum_amount'])!=original['amount']:
            raise SystemExit('ABORT: DDS aggregate changed between preflight and postflight')
print('BRANCH2_DDS_'+phase.upper().replace('-','_')+'_PASS schema_and_worker_exact no_production_writes')

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

PHASE=sys.argv[1] if len(sys.argv)==2 else ''
if PHASE not in ('before','after','worker-after'):
    raise SystemExit('ABORT unknown production verification phase')

PROD_DB='17e68a41-1d58-4a36-8a63-47c3e32443c4'
PROD_WORKER='orders-app'
raw=Path('wrangler.jsonc').read_text()
raw=re.sub(r'("(?:\\.|[^"\\])*")|(/\*[\s\S]*?\*/|//[^\n]*)',
           lambda match: match.group(1) if match.group(1) is not None else '', raw)
cfg=json.loads(raw)
if cfg.get('name')!=PROD_WORKER or cfg.get('main')!='worker/index.ts':
    raise SystemExit('ABORT wrong production Worker configuration')
if cfg.get('env') is not None or cfg.get('d1_databases')!=[{
    'binding':'DB','database_name':'orders_db_prod','database_id':PROD_DB
}]:
    raise SystemExit('ABORT production D1 configuration mismatch')
if cfg.get('vars',{}).get('RETURN_V2_ENABLED')!='true':
    raise SystemExit('ABORT Return V2 flag changed')
if 'orders-app-branch2' in cfg.get('name',''):
    raise SystemExit('ABORT test Worker in production release')

account=os.environ['CLOUDFLARE_ACCOUNT_ID'].strip()
token=os.environ['CLOUDFLARE_API_TOKEN'].strip()
root='https://api.cloudflare.com/client/v4/accounts/'+account

def api(path,payload=None):
    headers={'Authorization':'Bearer '+token,'Accept':'application/json'}
    body=None if payload is None else json.dumps(payload).encode('utf-8')
    if payload is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request(root+path,headers=headers,data=body,
                               method='POST' if payload is not None else 'GET')
    with urllib.request.urlopen(req,timeout=45) as response:
        obj=json.load(response)
    if not obj.get('success'):
        raise SystemExit('ABORT Cloudflare API did not confirm success')
    return obj['result']

settings=api('/workers/scripts/'+PROD_WORKER+'/settings')
bindings=settings.get('bindings',[])
db=[entry for entry in bindings if entry.get('name')=='DB']
if len(db)!=1 or db[0].get('type')!='d1' or (
        db[0].get('database_id') or db[0].get('id'))!=PROD_DB:
    raise SystemExit('ABORT live Worker not bound to production D1')
if not any(entry.get('name')=='ADMIN_MODE_SESSION_SECRET' for entry in bindings):
    raise SystemExit('ABORT admin session secret missing')
existing_bindings={entry.get('name'):entry.get('type')
                   for entry in bindings if entry.get('name')!='DB'}
if not any(name=='RETURN_V2_ENABLED' for name in existing_bindings):
    raise SystemExit('ABORT live Return V2 binding missing')

snapshot=Path('.main-dds-0139-preflight-snapshot.json')
if PHASE=='before':
    snapshot.write_text(json.dumps({'bindings':existing_bindings}))
elif snapshot.exists():
    original=json.loads(snapshot.read_text())
    for name,kind in original['bindings'].items():
        if existing_bindings.get(name)!=kind:
            raise SystemExit('ABORT production binding lost or changed: '+name)

def query(sql):
    reply=api('/d1/database/'+PROD_DB+'/query',{'sql':sql,'params':[]})
    if len(reply)!=1:raise SystemExit('ABORT unexpected D1 query response')
    return reply[0].get('results',[])

schema=query("""SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
   AND name IN ('dds_entries','dds_categories','dds_articles')) AS base_tables,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
   AND name='dds_entry_edits') AS audit_table,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
   AND name IN ('dds_edit_cas_guard','dds_edit_audit',
       'dds_edit_audit_immutable_update','dds_edit_audit_immutable_delete')) AS audit_triggers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
   AND name IN ('idx_dds_entry_last_edit_request','idx_dds_entry_edits_entry')) AS audit_indexes,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
   AND name='dds_prevent_overdraft') AS forbidden_overdraft,
  (SELECT COUNT(*) FROM dds_entries) AS entries,
  (SELECT COALESCE(SUM(amount),0) FROM dds_entries) AS sum_amount,
  (SELECT COALESCE(SUM(CASE kind
       WHEN 'funding' THEN amount WHEN 'reversal_expense' THEN amount
       WHEN 'expense' THEN -amount WHEN 'reversal_funding' THEN -amount ELSE 0 END),0)
   FROM dds_entries) AS signed_total""")
if len(schema)!=1:raise SystemExit('ABORT production schema query shape mismatch')
s=schema[0]
if int(s['base_tables'])!=3 or int(s['forbidden_overdraft'])!=0:
    raise SystemExit('ABORT incompatible production DDS baseline')
columns=query('PRAGMA table_info(dds_entries)')
names={row.get('name') for row in columns}
new_fields={'edit_version','last_edit_request_id','last_edited_by_user_id',
            'last_edited_at','last_edit_reason'}
if PHASE=='before':
    if (int(s['audit_table'])!=0 or int(s['audit_triggers'])!=0 or
        int(s['audit_indexes'])!=0 or names.intersection(new_fields)):
        raise SystemExit('ABORT migration already/partially present')
    source=json.loads(snapshot.read_text())
    source['count']=int(s['entries'])
    source['amount']=int(s['sum_amount'])
    source['net']=int(s['signed_total'])
    snapshot.write_text(json.dumps(source))
else:
    if (int(s['audit_table'])!=1 or int(s['audit_triggers'])!=4 or
        int(s['audit_indexes'])!=2 or not new_fields.issubset(names)):
        raise SystemExit('ABORT migration 0139 incomplete')
    if snapshot.exists():
        source=json.loads(snapshot.read_text())
        if (int(s['entries'])!=source['count'] or
            int(s['sum_amount'])!=source['amount'] or
            int(s['signed_total'])!=source['net']):
            raise SystemExit('ABORT DDS financial totals changed during deployment window')

print('MAIN_DDS_'+PHASE.upper().replace('-','_')+
      '_PASS target=production schema_verified=true data_mutation=none')

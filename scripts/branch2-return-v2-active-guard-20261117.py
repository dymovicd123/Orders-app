import json
import os
import sys
import urllib.request
from pathlib import Path

phase = sys.argv[1] if len(sys.argv)==2 else ''
if phase not in ('before','after'):
    raise SystemExit('ABORT: invalid Branch2 Return V2 release verification phase')

worker='orders-app-branch2'
database_id='0904a573-21ff-44d8-93b0-c9200f771702'
cfg=json.loads(Path('wrangler.jsonc').read_text())
if cfg.get('name')!=worker or cfg.get('main')!='worker/index.ts' or cfg.get('env') is not None:
    raise SystemExit('ABORT: this release targets the wrong Worker')
if cfg.get('d1_databases')!=[{
    'binding':'DB','database_name':'orders_db_branch2_mirror_20261027',
    'database_id':database_id,
}]:
    raise SystemExit('ABORT: this release targets the wrong D1')
if cfg.get('vars',{}).get('RETURN_V2_ENABLED')!='true' or cfg.get('keep_vars') is not True:
    raise SystemExit('ABORT: V2 is not permanently enabled in versioned configuration')

account=os.environ['CLOUDFLARE_ACCOUNT_ID'].strip()
token=os.environ['CLOUDFLARE_API_TOKEN'].strip()
api_root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker

def get(path):
    request=urllib.request.Request(api_root+path,headers={
        'Authorization':'Bearer '+token,'Accept':'application/json'})
    with urllib.request.urlopen(request,timeout=35) as response:
        obj=json.load(response)
    if not obj.get('success'):
        raise SystemExit('ABORT: Cloudflare read failed')
    return obj['result']

settings=get('/settings')
bindings=settings.get('bindings') or []
live_db=[b for b in bindings if b.get('name')=='DB']
if len(live_db)!=1 or live_db[0].get('type')!='d1' or (
    live_db[0].get('database_id') or live_db[0].get('id'))!=database_id:
    raise SystemExit('ABORT: live Worker settings point to the wrong D1')
if not any(b.get('name')=='ADMIN_MODE_SESSION_SECRET' for b in bindings):
    raise SystemExit('ABORT: admin session secret missing')

deployments=(get('/deployments?per_page=1').get('deployments') or [])
if len(deployments)!=1:
    raise SystemExit('ABORT: cannot establish currently active Worker deployment')
versions=deployments[0].get('versions') or []
if len(versions)!=1 or float(versions[0].get('percentage') or 0)!=100:
    raise SystemExit('ABORT: Worker version is split; stop')
active_id=versions[0].get('version_id')
if not active_id:
    raise SystemExit('ABORT: active Worker version is missing')
active=get('/versions/'+active_id)
active_bindings=(active.get('resources') or {}).get('bindings') or []
active_d1=[b for b in active_bindings if b.get('name')=='DB']
if len(active_d1)!=1 or (active_d1[0].get('database_id') or active_d1[0].get('id'))!=database_id:
    raise SystemExit('ABORT: active version points to wrong D1')

active_flag=[b for b in active_bindings if b.get('name')=='RETURN_V2_ENABLED']
flag_on=(len(active_flag)==1 and active_flag[0].get('type')=='plain_text'
         and active_flag[0].get('text')=='true')
settings_flag=[b for b in bindings if b.get('name')=='RETURN_V2_ENABLED']
settings_on=(len(settings_flag)==1 and settings_flag[0].get('type')=='plain_text'
             and settings_flag[0].get('text')=='true')

other_bindings={b.get('name'):b.get('type') for b in bindings
                if b.get('name') not in ('RETURN_V2_ENABLED','DB')}
snapshot=Path('.return-v2-active-branch2-preflight.json')
if phase=='before':
    snapshot.write_text(json.dumps({'worker_version':active_id,'other_bindings':other_bindings}))
    print('BRANCH2_RETURN_V2_BEFORE_PASS active_flag_on='+str(flag_on)
          +' settings_flag_on='+str(settings_on)+' test_d1_verified=true')
else:
    if not flag_on or not settings_on:
        raise SystemExit('ABORT: active Return V2 is not enabled after deployment')
    if not snapshot.exists():
        raise SystemExit('ABORT: no verified preflight snapshot')
    original=json.loads(snapshot.read_text())
    if active_id==original['worker_version']:
        raise SystemExit('ABORT: active Worker version has not changed')
    for name,old_type in original['other_bindings'].items():
        if other_bindings.get(name)!=old_type:
            raise SystemExit('ABORT: pre-existing binding was lost or changed: '+name)
    print('BRANCH2_RETURN_V2_AFTER_PASS active_flag_on=true test_d1_verified=true '
          'existing_worker_bindings_preserved=true no_main_changes=true')

"""Exact-version, production-only Return V2 Worker activation. Never writes D1."""
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

SCRIPT = 'orders-app'
DB_ID = '17e68a41-1d58-4a36-8a63-47c3e32443c4'
SECRET_NAMES = {'ADMIN_MODE_PASSWORD', 'ADMIN_MODE_SESSION_SECRET'}
STATE = Path('/tmp/return-v2-main-worker-version-state.json')
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()
ACCOUNT = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '').strip()
if not TOKEN or not ACCOUNT:
    raise SystemExit('STOP: missing Cloudflare credentials.')
ROOT = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}'

def call(path, method='GET', payload=None):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    headers={'Authorization': 'Bearer ' + TOKEN, 'Accept':'application/json'}
    if data is not None: headers['Content-Type'] = 'application/json'
    request=urllib.request.Request(ROOT+path, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(request,timeout=40) as response:
            status=response.status
            body=json.load(response)
    except urllib.error.HTTPError as error:
        status=error.code
        try: body=json.loads(error.read().decode())
        except (ValueError,UnicodeError): body={}
    if status not in (200,201) or body.get('success') is not True:
        codes=[str(x.get('code')) for x in body.get('errors',[]) if isinstance(x,dict)]
        raise SystemExit(f'STOP: Cloudflare operation {method} {path} failed HTTP {status}; codes {codes}.')
    return body.get('result') or {}

def active_id():
    items=call('/deployments').get('deployments') or []
    if not items: raise SystemExit('STOP: no live production deployment.')
    latest=sorted(items,key=lambda x:x.get('created_on',''))[-1]
    versions=latest.get('versions') or []
    if len(versions)!=1 or float(versions[0].get('percentage') or 0)!=100:
        raise SystemExit('STOP: production traffic not 100% on a single version.')
    return versions[0].get('version_id')

def binding_map(version_id, flag):
    resource=call('/versions/'+version_id).get('resources') or {}
    bindings=resource.get('bindings') or []
    if len(bindings)!=3+int(flag): raise SystemExit('STOP: unexpected number of production bindings.')
    by_name={b.get('name'):b for b in bindings}
    expected={'DB',*SECRET_NAMES}
    if flag: expected.add('RETURN_V2_ENABLED')
    if len(by_name)!=len(bindings) or set(by_name)!=expected:
        raise SystemExit('STOP: unexpected production binding names.')
    db=by_name['DB']
    if db.get('type')!='d1' or (db.get('database_id') or db.get('id'))!=DB_ID:
        raise SystemExit('STOP: production Worker is bound to another D1.')
    if any(by_name[name].get('type')!='secret_text' for name in SECRET_NAMES):
        raise SystemExit('STOP: production admin secret binding type drift.')
    if flag:
        v2=by_name['RETURN_V2_ENABLED']
        if v2.get('type')!='plain_text' or v2.get('text')!='true':
            raise SystemExit('STOP: new version does not have exact plain-text true V2 binding.')
    return sorted((b.get('name'),b.get('type')) for b in bindings)

def inventory_ids():
    rows=call('/versions?per_page=100').get('items') or []
    if not rows: raise SystemExit('STOP: Worker version inventory empty.')
    ids={x.get('id') for x in rows if x.get('id')}
    if not ids: raise SystemExit('STOP: invalid version inventory.')
    return ids

def load_state():
    if not STATE.exists(): raise SystemExit('STOP: release version state missing.')
    state=json.loads(STATE.read_text())
    if state.get('script')!=SCRIPT or state.get('db_id')!=DB_ID:
        raise SystemExit('STOP: mismatched production release state.')
    return state

def save(state):
    STATE.write_text(json.dumps(state,separators=(',',':')))
    STATE.chmod(0o600)

def baseline():
    current=active_id()
    print('MAIN_ACTIVE_PRE_RELEASE_VERSION:',current)
    print('MAIN_BINDINGS_BEFORE:',binding_map(current,False))
    ids=inventory_ids()
    if current not in ids: raise SystemExit('STOP: active version not in recent version inventory.')
    save({'script':SCRIPT,'db_id':DB_ID,'before':current,'version_ids':sorted(ids),'new':None,'deployed':False})
    print('MAIN_V2_PRE_RELEASE_PINNED_VERSION_PASS')

def newly_uploaded():
    state=load_state()
    current=active_id()
    if current!=state['before']: raise SystemExit('STOP: active production Worker changed while uploading draft.')
    now=inventory_ids()
    new=now-set(state['version_ids'])
    if len(new)!=1:
        raise SystemExit(f'STOP: expected exactly one newly uploaded Worker version; found {len(new)}.')
    version_id=next(iter(new))
    print('MAIN_NEW_UNDEPLOYED_VERSION:',version_id)
    print('MAIN_BINDINGS_NEW:',binding_map(version_id,True))
    state['new']=version_id
    save(state)
    print('MAIN_V2_NEW_VERSION_READY_TO_DEPLOY')

def deployment(version_id, message):
    if not version_id or not isinstance(version_id,str):
        raise SystemExit('STOP: invalid version id.')
    return call('/deployments','POST',{
       'strategy':'percentage',
       'versions':[{'version_id':version_id,'percentage':100}],
       'annotations':{'workers/message':message}
    })

def verify_active(version_id,flag):
    for attempt in range(1,12):
        if active_id()==version_id:
            print('MAIN_ACTIVE_VERSION_BINDINGS:',binding_map(version_id,flag))
            return
        time.sleep(3)
    raise SystemExit('STOP: desired exact Worker version not verified active after deployment request.')

def deploy():
    state=load_state()
    if not state.get('new'): raise SystemExit('STOP: no exact validated new version.')
    if active_id()!=state['before']:raise SystemExit('STOP: production deployment changed concurrently.')
    binding_map(state['before'],False)
    binding_map(state['new'],True)
    deployment(state['new'],'Main Return V2 activated on reviewed exact Git SHA; schema 0124-0135 verified')
    state['deployed']=True
    save(state)
    verify_active(state['new'],True)
    print('MAIN_RETURN_V2_WORKER_100_PERCENT_ACTIVE')

def rollback():
    state=load_state()
    if not state.get('deployed') or not state.get('before') or not state.get('new'):
        raise SystemExit('STOP: no confirmed release to revert.')
    current=active_id()
    if current!=state['new']:
        raise SystemExit('STOP: do not rollback an unrecognized concurrently changed production deployment.')
    binding_map(state['before'],False)
    deployment(state['before'],'Main Return V2 rollback after release smoke failure; D1 is not restored')
    verify_active(state['before'],False)
    print('MAIN_RETURN_V2_WORKER_ONLY_ROLLED_BACK')

if __name__=='__main__':
    if len(sys.argv)!=2 or sys.argv[1] not in {'baseline','new','deploy','rollback'}:
        raise SystemExit('Usage: main_return_v2_worker_release.py baseline|new|deploy|rollback')
    {'baseline':baseline,'new':newly_uploaded,'deploy':deploy,'rollback':rollback}[sys.argv[1]]()

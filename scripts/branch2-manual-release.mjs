// Reusable, explicitly initiated Branch2 release. No scheduled/GitHub push deploy.
// --check: offline config validation, suitable for CI.
// --ci-preview: no-credentials PR build and real Wrangler dry-run, NEVER publish.
// --dry-run --sha <full SHA>: local full regression + Cloudflare package preview.
// --publish --sha <full SHA> --confirm BRANCH2-ONLY: same verification, then
// read-only Branch2 D1 preflight, Worker-only deploy, read-only postflight.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT=process.cwd()
const WORKER='orders-app-branch2'
const DATABASE='orders_db_branch2_mirror_20261027'
const DATABASE_ID='0904a573-21ff-44d8-93b0-c9200f771702'
const CONFIG='.branch2-safe-manual-release.jsonc'
const DRY_DIR='.branch2-safe-manual-release-dry-run'
const ORIGIN='https://orders-app-branch2.orders-clothes.workers.dev'
const fail=message=>{throw new Error('Branch2 release blocked: '+message)}
const args=process.argv.slice(2)
const mode=args.shift()
if(!['--check','--ci-preview','--dry-run','--publish'].includes(mode)) {
  fail('Usage: --check OR --ci-preview OR --dry-run --sha <40-char SHA> OR --publish --sha <40-char SHA> --confirm BRANCH2-ONLY')
}
const fields=new Map()
while(args.length){
  const flag=args.shift()
  if(!['--sha','--confirm'].includes(flag)||fields.has(flag)||!args.length)fail('Unexpected or duplicate release argument.')
  fields.set(flag,args.shift())
}
if(['--check','--ci-preview'].includes(mode)&&fields.size)fail('Offline validation modes never accept release inputs.')
const sha=fields.get('--sha')
if(!['--check','--ci-preview'].includes(mode) && (!sha||!/^[0-9a-f]{40}$/.test(sha)))fail('Supply a full 40-character lowercase Branch2 Git SHA.')
if(mode==='--publish' && fields.get('--confirm')!=='BRANCH2-ONLY')fail('Explicit --confirm BRANCH2-ONLY is required to publish.')
if(mode!=='--publish'&&fields.has('--confirm'))fail('Confirmation is accepted only for --publish.')

function verifyConfiguration(){
  const cfg=readFileSync(resolve(ROOT,'wrangler.jsonc'),'utf8')
  for(const expected of [
    '"name": "orders-app-branch2"',
    '"main": "worker/index.ts"',
    '"binding": "DB"',
    '"database_name": "orders_db_branch2_mirror_20261027"',
    '"database_id": "0904a573-21ff-44d8-93b0-c9200f771702"',
    '"workers_dev": true',
    '"assets": {',
  ])if(!cfg.includes(expected))fail('Expected isolated Branch2 configuration missing: '+expected)
  for(const forbidden of [
    'orders_db_prod','17e68a41-1d58-4a36-8a63-47c3e32443c4',
    '40065052-854e-44b8-bcd5-251bdd488301',
    '"name": "orders-app"',
    'orders-app.orders-clothes.workers.dev',
  ])if(cfg.includes(forbidden))fail('Forbidden Production or obsolete D1 target in Wrangler config.')
  if((cfg.match(/"binding"\s*:\s*"DB"/g)||[]).length!==1
    ||(cfg.match(/"database_id"\s*:/g)||[]).length!==1
    ||(cfg.match(/"name"\s*:/g)||[]).length!==1)fail('Ambiguous Worker or database binding.')
  if(cfg.includes('"directory"'))fail('Unexpected assets override: review config before release.')
  return cfg
}
const cfg=verifyConfiguration()
console.log('BRANCH2_MANUAL_RELEASE_CONFIG_PASS: exact isolated Worker/D1; no Main target')
if(mode==='--check')process.exit(0)

const npm=process.platform==='win32'?'npm.cmd':'npm'
const npx=process.platform==='win32'?'npx.cmd':'npx'
function run(program,argv,options={}){
  const result=spawnSync(program,argv,{
    cwd:ROOT,encoding:'utf8',
    shell:process.platform==='win32'&&(program===npm||program===npx),
    stdio:options.capture?'pipe':'inherit',
    maxBuffer:1024*1024*4,timeout:options.timeout||900000,
    env:options.env||process.env,
  })
  if(result.error||result.status!==0){
    fail('Command failed: '+program+' '+argv.filter(x=>x!=='--command').slice(0,8).join(' ')
      +' ('+(result.error?.message||result.status)+')'
      +(options.capture?': '+String(result.stderr||'').slice(0,1000):''))
  }
  return options.capture?String(result.stdout).trim():''
}
// Preview is intentionally confined to a no-credentials PR: no GitHub SHA
// promotion and no network writes. Real --dry-run/--publish remain fully pinned.
if(mode!=='--ci-preview'){
  const git=(...argv)=>run('git',argv,{capture:true,timeout:30000})
  if(resolve(git('rev-parse','--show-toplevel'))!==resolve(ROOT))fail('Run from the Orders-app repository root.')
  if(git('branch','--show-current')!=='branch2')fail('Check out the actual branch2 branch; never publish main or a detached checkout.')
  if(git('rev-parse','HEAD')!==sha)fail('Local checkout does not match the explicitly approved SHA.')
  if(git('status','--porcelain','--untracked-files=all'))fail('Git worktree is not clean; no unpublished local code may enter the release.')
  const remote=git('remote','get-url','origin')
  if(!/(?:github\.com[:/])dymovicd123\/Orders-app(?:\.git)?$/.test(remote))fail('The origin remote is not the expected Orders-app repository.')
  const remoteLine=git('ls-remote','origin','refs/heads/branch2')
  const remoteSha=remoteLine.split(/\s+/)[0]
  if(remoteSha!==sha)fail('Remote branch2 HEAD has changed. Fetch/checkout and approve its exact new SHA first.')
  console.log('BRANCH2_MANUAL_RELEASE_SHA_PASS: '+sha+' is clean, exact remote branch2 HEAD')
}
if(existsSync(CONFIG)||existsSync(DRY_DIR))fail('Temporary release config/output already exists; inspect and clear it manually.')
if(existsSync('.wrangler/deploy/config.json'))fail('An unexpected generated Wrangler config could redirect deployment.')

console.log('Running Branch2 build and package safety checks before any remote Cloudflare operation')
run(npm,['ci'])
if(mode==='--ci-preview')run(npm,['run','build'])
else run(npm,['run','release:check'])
if(!existsSync('dist/client/assets'))fail('Required built frontend assets are missing.')
// Only a build-produced redirect is allowed here: preexisting redirect files
// were rejected before npm ci. Remove the single generated pointer so Wrangler
// MUST use the separately verified explicit Branch2 --config, never an implicit
// auto-generated deployment target. Do not delete any generated app bundles.
if(existsSync('.wrangler/deploy/config.json')){
  rmSync('.wrangler/deploy/config.json',{force:true})
  if(existsSync('.wrangler/deploy/config.json'))fail('Cannot remove implicit Wrangler deploy redirect.')
  console.log('BRANCH2_BUILD_REDIRECT_REMOVED: explicit isolated --config enforced')
}
writeFileSync(CONFIG,cfg.replace('"assets": {','"assets": {\n    "directory": "./dist/client",'),{flag:'wx'})
try{
  run(npx,['--no-install','wrangler','deploy','--dry-run','--outdir',DRY_DIR,'--config',CONFIG])
  console.log('BRANCH2_MANUAL_RELEASE_DRY_RUN_PASS: worker+assets package, no deployment')
  if(mode==='--dry-run'||mode==='--ci-preview')process.exitCode=0
  else{
    if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID) {
      fail('Both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be configured for manual publish.')
    }
    const dbQueryEnv={...process.env,WRANGLER_SEND_METRICS:'false'}
    const query=sql=>{
      const output=run(npx,['--no-install','wrangler','d1','execute',DATABASE,
        '--remote','--config',CONFIG,'--command',sql,'--json'],
        {capture:true,env:dbQueryEnv,timeout:180000})
      let value
      try{value=JSON.parse(output)}catch{fail('Remote D1 read-only response was not valid JSON.')}
      const row=Array.isArray(value)?value[0]?.results?.[0]:value?.results?.[0]
      if(!row||typeof row!=='object')fail('Remote D1 did not return the expected row.')
      return row
    }
    const schema=query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('orders','order_items','payments','returns','exchanges','financial_events','inventory_stock','inventory_reservations','order_dispatch_items','critical_operations')")
    if(Number(schema.n)!==10)fail('Remote Branch2 D1 is missing required business tables. No deployment.')
    const fingerprintSql=[
      'SELECT (SELECT COUNT(*) FROM orders) AS orders_count,',
      '(SELECT COUNT(*) FROM order_items) AS item_count,',
      '(SELECT COALESCE(SUM(total_amount),0) FROM orders) AS sales,',
      '(SELECT COALESCE(SUM(received_amount),0) FROM orders) AS received,',
      '(SELECT COUNT(*) FROM payments) AS payment_count,',
      '(SELECT COUNT(*) FROM returns) AS return_count,',
      '(SELECT COUNT(*) FROM exchanges) AS exchange_count,',
      '(SELECT COUNT(*) FROM inventory_movements) AS movement_count,',
      '(SELECT COUNT(*) FROM financial_events) AS financial_count,',
      '(SELECT COALESCE(SUM(quantity),0) FROM inventory_stock) AS physical,',
      '(SELECT COALESCE(SUM(reserved_quantity),0) FROM inventory_stock) AS reserved',
    ].join(' ')
    const before=query(fingerprintSql)
    // This publishes only the verified Branch2 Worker+assets, never a D1 migration.
    run(npx,['--no-install','wrangler','deploy','--config',CONFIG],{env:dbQueryEnv,timeout:180000})
    console.log('BRANCH2_MANUAL_RELEASE_PUBLISHED: exact Git SHA '+sha+' to Worker '+WORKER)
    const after=query(fingerprintSql)
    assert.deepEqual(after,before,'The read-only Branch2 D1 fingerprints differ across deployment; investigate concurrent writes.')
    for(const [route,expected] of [
      ['/api/auth/status',200],
      ['/api/orders',401],
      ['/api/orders/1/shipping/plan',401],
    ]){
      const response=await fetch(ORIGIN+route,{redirect:'manual',signal:AbortSignal.timeout(20000)})
      if(response.status!==expected)fail('Post-deploy anonymous HTTP smoke failed at '+route+' (status '+response.status+').')
    }
    console.log('BRANCH2_MANUAL_RELEASE_VERIFIED: isolated D1 fingerprints equal, public auth=200, guarded routes=401, Git SHA '+sha)
  }
}finally{
  // Never delete arbitrary paths: both generated artifacts were forbidden to
  // exist before this run, and both are fixed in this script.
  rmSync(CONFIG,{force:true})
  rmSync(DRY_DIR,{recursive:true,force:true})
}

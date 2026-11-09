// Main manual release: inspect or promote an ALREADY uploaded, exact-SHA version.
// No build, code upload, D1 execution, migration, or mutation except one explicit
// Worker deployment POST after every guard passes. Fails closed on missing proof.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const WORKER = 'orders-app'
const DB_ID = '17e68a41-1d58-4a36-8a63-47c3e32443c4'
const BRANCH2_DB = ['0904a573-21ff-44d8-93b0-c9200f771702', '40065052-854e-44b8-bcd5-251bdd488301']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{40}$/
const fail = message => { throw new Error('MAIN_RELEASE_BLOCKED: ' + message) }
const check = (condition, message) => { if (!condition) fail(message) }

function verifyConfig(raw) {
  for (const token of [
    '"name": "orders-app"', '"binding": "DB"',
    '"database_name": "orders_db_prod"', '"database_id": "' + DB_ID + '"',
    '"main": "worker/index.ts"',
  ]) check(raw.includes(token), 'Production config mismatch: ' + token)
  for (const token of ['"name": "orders-app-branch2"', ...BRANCH2_DB, 'orders_db_branch2'])
    check(!raw.includes(token), 'Branch2 target leaked into Production config: ' + token)
  check((raw.match(/"database_id"\s*:/g) || []).length === 1, 'Ambiguous D1 bindings')
}

function latestDeployment(list) {
  check(Array.isArray(list) && list.length > 0, 'No Cloudflare deployment history')
  const sorted = [...list].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))
  const current = sorted[0]
  check(UUID.test(current?.id ?? ''), 'Missing active deployment ID')
  check(current.versions?.length === 1 && Number(current.versions[0].percentage) === 100,
    'Cannot release while traffic is split among versions')
  check(UUID.test(current.versions[0].version_id), 'Invalid currently active Version ID')
  return { deploymentId: current.id, versionId: current.versions[0].version_id }
}

function verifyBinding(version, target) {
  const raw = version?.resources?.bindings
  const records = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []
  const d1 = records.filter(entry => entry && typeof entry === 'object' && entry.type === 'd1')
  check(version?.id === target, 'Cloudflare returned another version')
  check(d1.length === 1, 'Target version must expose exactly one inspectable D1 binding')
  check(d1[0].name === 'DB' && (d1[0].database_id ?? d1[0].id) === DB_ID,
    'Target version has incorrect D1 binding: deployment forbidden')
}

function versionIdsFromLog(lines) {
  const ids = new Set()
  for (const line of lines) {
    // Wrangler's final upload summary, not an arbitrary UUID in a log.
    const match = String(line).match(/\b(?:Worker\s+)?Version ID\s*:\s*([0-9a-f-]{36})\b/i)
    if (match && UUID.test(match[1])) ids.add(match[1].toLowerCase())
  }
  return [...ids]
}

function validateReleaseInputs(env) {
  const mode = env.RELEASE_MODE
  check(['inspect', 'promote'].includes(mode), 'Only inspect/promote modes are allowed')
  check(env.GITHUB_REPOSITORY === 'dymovicd123/Orders-app', 'Wrong GitHub repository')
  check(env.GITHUB_REF === 'refs/heads/main', 'Manual release must run on main')
  if (mode === 'promote') {
    check(SHA.test(env.RELEASE_SHA ?? ''), 'Provide complete reviewed 40-hex main SHA')
    for (const key of ['TARGET_VERSION_ID', 'EXPECTED_DEPLOYMENT_ID', 'EXPECTED_ACTIVE_VERSION_ID'])
      check(UUID.test(env[key] ?? ''), 'Provide valid pinned ' + key)
    check(env.CONFIRM_RELEASE === 'PUBLISH-MAIN-100', 'Explicit Main release confirmation missing')
    check(env.RELEASE_SHA === env.GITHUB_SHA, 'Requested SHA is not the checked-out main source')
    check(env.TARGET_VERSION_ID.toLowerCase() !== env.EXPECTED_ACTIVE_VERSION_ID.toLowerCase(),
      'Target is already active; refuse no-op/replay')
  }
  return mode
}

async function main() {
  const env = process.env
  if (process.argv.length === 3 && process.argv[2] === '--self-test') {
    verifyConfig(readFileSync('wrangler.jsonc', 'utf8'))
    assert.deepEqual(latestDeployment([{ id: '11111111-1111-4111-8111-111111111111', created_on: '2026-11-09T10:00:00Z',
      versions: [{ version_id: '22222222-2222-4222-8222-222222222222', percentage: 100 }] }]),
    { deploymentId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222' })
    verifyBinding({id:'33333333-3333-4333-8333-333333333333',resources:{bindings:[
      {type:'d1',name:'DB',database_id:DB_ID}]}},'33333333-3333-4333-8333-333333333333')
    assert.deepEqual(versionIdsFromLog(['Version ID: 33333333-3333-4333-8333-333333333333']),
      ['33333333-3333-4333-8333-333333333333'])
    for (const [label, operation] of [
      ['other DB', () => verifyBinding({id:'33333333-3333-4333-8333-333333333333',resources:{bindings:[
        {type:'d1',name:'DB',database_id:BRANCH2_DB[0]}]}},'33333333-3333-4333-8333-333333333333')],
      ['split traffic', () => latestDeployment([{id:'11111111-1111-4111-8111-111111111111',created_on:'2026-11-09',
        versions:[{version_id:'22222222-2222-4222-8222-222222222222',percentage:50}]}])],
      ['no approval', () => validateReleaseInputs({RELEASE_MODE:'promote',GITHUB_REF:'refs/heads/main',
        GITHUB_REPOSITORY:'dymovicd123/Orders-app',RELEASE_SHA:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),
        TARGET_VERSION_ID:'33333333-3333-4333-8333-333333333333',
        EXPECTED_DEPLOYMENT_ID:'11111111-1111-4111-8111-111111111111',
        EXPECTED_ACTIVE_VERSION_ID:'22222222-2222-4222-8222-222222222222',CONFIRM_RELEASE:'NO'})],
      ['wrong main SHA', () => validateReleaseInputs({RELEASE_MODE:'promote',GITHUB_REF:'refs/heads/main',
        GITHUB_REPOSITORY:'dymovicd123/Orders-app',RELEASE_SHA:'a'.repeat(40),GITHUB_SHA:'b'.repeat(40),
        TARGET_VERSION_ID:'33333333-3333-4333-8333-333333333333',
        EXPECTED_DEPLOYMENT_ID:'11111111-1111-4111-8111-111111111111',
        EXPECTED_ACTIVE_VERSION_ID:'22222222-2222-4222-8222-222222222222',
        CONFIRM_RELEASE:'PUBLISH-MAIN-100'})],
      ['wrong branch', () => validateReleaseInputs({RELEASE_MODE:'promote',GITHUB_REF:'refs/heads/branch2',
        GITHUB_REPOSITORY:'dymovicd123/Orders-app',RELEASE_SHA:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),
        TARGET_VERSION_ID:'33333333-3333-4333-8333-333333333333',
        EXPECTED_DEPLOYMENT_ID:'11111111-1111-4111-8111-111111111111',
        EXPECTED_ACTIVE_VERSION_ID:'22222222-2222-4222-8222-222222222222',
        CONFIRM_RELEASE:'PUBLISH-MAIN-100'})],
      ['replay', () => validateReleaseInputs({RELEASE_MODE:'promote',GITHUB_REF:'refs/heads/main',
        GITHUB_REPOSITORY:'dymovicd123/Orders-app',RELEASE_SHA:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),
        TARGET_VERSION_ID:'22222222-2222-4222-8222-222222222222',
        EXPECTED_DEPLOYMENT_ID:'11111111-1111-4111-8111-111111111111',
        EXPECTED_ACTIVE_VERSION_ID:'22222222-2222-4222-8222-222222222222',
        CONFIRM_RELEASE:'PUBLISH-MAIN-100'})],
    ]) assert.throws(operation, /MAIN_RELEASE_BLOCKED/, label)
    console.log('MAIN_MANUAL_PROMOTION_OFFLINE_SAFETY_PASS: exact worker, immutable version, D1, active compare-and-swap, explicit consent')
    return
  }
  const mode = validateReleaseInputs(env)
  verifyConfig(readFileSync('wrangler.jsonc', 'utf8'))
  check(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN,
    'Cloudflare secrets are unavailable')
  const apiBase = 'https://api.cloudflare.com/client/v4/accounts/' + env.CLOUDFLARE_ACCOUNT_ID
  async function cf(path, method = 'GET', body) {
    const res = await fetch(apiBase + path, {
      method, signal: AbortSignal.timeout(30000),
      headers: {Authorization:'Bearer ' + env.CLOUDFLARE_API_TOKEN,
        ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}),
    })
    check(res.ok, 'Cloudflare HTTP ' + res.status + ' for ' + method + ' ' + path)
    const data = await res.json()
    check(data.success === true, 'Cloudflare API rejected ' + method + ' ' + path)
    return data.result
  }
  const scripts = await cf('/workers/scripts')
  check(Array.isArray(scripts), 'Worker inventory unavailable')
  const script = scripts.find(x => x.id === WORKER)
  check(script?.tag && !scripts.some(x => x.id === 'orders-app-branch2' && x.tag === script.tag),
    'Worker name/tag resolution failed')
  const tag = script.tag
  const triggers = await cf('/builds/workers/' + tag + '/triggers')
  check(Array.isArray(triggers), 'Build trigger inventory unavailable')
  const production = triggers.filter(x => x.deleted_on == null
    && x.branch_includes?.includes('main') && !x.branch_excludes?.includes('main'))
  check(production.length === 1, 'Expected exactly one native main build trigger')
  check((production[0].deploy_command ?? '').trim() === 'npx wrangler versions upload',
    'Native Main trigger is not upload-only; do not promote')
  const deployments = await cf('/workers/scripts/' + WORKER + '/deployments')
  const current = latestDeployment(deployments)
  console.log('MAIN_ACTIVE_BASELINE', JSON.stringify(current))
  if (mode === 'inspect') {
    const builds = await cf('/builds/workers/' + tag + '/builds')
    check(Array.isArray(builds), 'Build inventory unavailable')
    const latest = builds.filter(x => x.build_trigger_metadata?.branch === 'main')
      .sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on)).slice(0,5)
    console.log('MAIN_LAST_NATIVE_BUILDS',JSON.stringify(latest.map(x=>({
      sha:x.build_trigger_metadata?.commit_hash,
      build:x.build_uuid,status:x.status,outcome:x.build_outcome,created:x.created_on
    }))))
    console.log('MAIN_RELEASE_INSPECTION_OK: GET-only; no traffic or D1 changes')
    return
  }

  // The exact SHA must still be the live GitHub main HEAD after this run started.
  check(env.GITHUB_TOKEN, 'GitHub read-only token required')
  const gh = await fetch('https://api.github.com/repos/dymovicd123/Orders-app/git/ref/heads/main', {
    headers:{Authorization:'Bearer ' + env.GITHUB_TOKEN,Accept:'application/vnd.github+json'},
    signal:AbortSignal.timeout(15000),
  })
  check(gh.ok && (await gh.json()).object?.sha === env.RELEASE_SHA,
    'Main HEAD moved since approval')
  check(current.deploymentId === env.EXPECTED_DEPLOYMENT_ID &&
        current.versionId === env.EXPECTED_ACTIVE_VERSION_ID,
    'Production deployment has changed since review')

  const target = env.TARGET_VERSION_ID.toLowerCase()
  const version = await cf('/workers/scripts/' + WORKER + '/versions/' + target)
  verifyBinding(version, target)
  const builds = await cf('/builds/workers/' + tag + '/builds')
  check(Array.isArray(builds), 'Cannot prove uploaded version from Cloudflare builds')
  const matching = builds.filter(x => x.status === 'stopped' && x.build_outcome === 'success'
    && x.build_trigger_metadata?.branch === 'main'
    && x.build_trigger_metadata?.commit_hash === env.RELEASE_SHA).slice(0,5)
  check(matching.length > 0, 'No successful native build for exact SHA')
  let proven = false
  for (const build of matching) {
    let cursor = ''
    const allLines = []
    for (let i = 0; i < 15; i++) {
      const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : ''
      const response = await fetch(apiBase + '/builds/builds/' + build.build_uuid + '/logs' + query, {
        headers:{Authorization:'Bearer ' + env.CLOUDFLARE_API_TOKEN},
        signal:AbortSignal.timeout(30000),
      })
      check(response.ok, 'Cloudflare build logs unavailable for exact SHA')
      const body = await response.json()
      check(body.success === true, 'Build log API failed')
      for (const raw of body.result?.lines ?? []) {
        allLines.push(Array.isArray(raw) ? raw.map(String).join(' ') : String(raw))
      }
      const next = body.result?.cursor
      if (!body.result?.truncated || !next) break
      cursor = next
    }
    if (versionIdsFromLog(allLines).includes(target)) { proven = true; break }
  }
  check(proven, 'Target Version ID is not proven in exact SHA native upload logs; REFUSE deployment')

  const preview = 'https://' + target.slice(0,8) + '-' + WORKER + '.orders-clothes.workers.dev'
  for (const [route, expected] of [['/api/auth/status', 200], ['/api/orders', 401]]) {
    const response = await fetch(preview + route, {
      redirect:'manual',signal:AbortSignal.timeout(20000),
    })
    check(response.status === expected, 'Pinned candidate preview HTTP ' + route
      + ' returned ' + response.status + ', expected ' + expected)
  }
  // One last GET before the sole mutating Cloudflare API request.
  const unchanged = latestDeployment(await cf('/workers/scripts/' + WORKER + '/deployments'))
  check(unchanged.deploymentId === current.deploymentId
    && unchanged.versionId === current.versionId, 'Active deployment changed during preflight')

  const result = await cf('/workers/scripts/' + WORKER + '/deployments', 'POST', {
    strategy:'percentage',
    versions:[{version_id:target,percentage:100}],
    annotations:{'workers/message': 'Approved Main release git ' + env.RELEASE_SHA
      + ' replacing ' + current.versionId},
  })
  check(UUID.test(result?.id ?? ''), 'Deployment response lacked ID; inspect Cloudflare manually')
  const active = latestDeployment(await cf('/workers/scripts/' + WORKER + '/deployments'))
  check(active.versionId === target && active.deploymentId === result.id,
    'POST returned, but exact target is not serving 100%; investigate immediately')
  for (const [route, expected] of [['/api/auth/status',200],['/api/orders',401]]) {
    const response = await fetch('https://orders-app.orders-clothes.workers.dev' + route, {
      redirect:'manual',signal:AbortSignal.timeout(20000),
    })
    check(response.status === expected, 'Main public read-only smoke failed for ' + route)
  }
  console.log('MAIN_MANUAL_PROMOTION_CONFIRMED',JSON.stringify({
    sha:env.RELEASE_SHA,version:target,deployment:result.id,previous:current,
  }))
}

main().catch(error => { console.error(error.message); process.exitCode=1 })

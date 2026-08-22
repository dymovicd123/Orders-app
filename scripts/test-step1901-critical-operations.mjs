import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { readWorkerSource } from './lib/worker-source.mjs'
const fail = (m) => { throw new Error(m) }
const check = (v,m) => { if (!v) fail(m) }
const read = (p) => fs.readFileSync(p,'utf8')
const slice = (s,a,b) => { const x=s.indexOf(a), y=s.indexOf(b,x+a.length); if(x<0||y<0) fail(`slice ${a}`); return s.slice(x,y) }

try {
  const worker=readWorkerSource(), app=read('src/App.tsx'), team=read('src/features/sections/TeamSection.tsx')
  const migration=read('migrations/0059_v72_critical_operation_idempotency.sql')
  const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON;'); db.exec(migration); db.exec(migration)
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)))
  check(tables.has('critical_operations') && tables.has('critical_operation_entities'),'0059 tables missing')
  const idx=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>String(r.name)))
  check(idx.has('idx_critical_operations_status_updated') && idx.has('idx_critical_operation_entities_entity'),'0059 indexes missing')
  db.prepare("INSERT INTO critical_operations(request_id,operation_type,request_fingerprint,status,step,context_json,lease_token,lease_until_ms,created_at,updated_at) VALUES('r1','order_create','f','started','started','{}','l',1,'t','t')").run()
  db.prepare("INSERT INTO critical_operation_entities(request_id,entity_type,entity_key,entity_id,created_at) VALUES('r1','order_item','i1',7,'t')").run()
  check(Number(db.prepare("SELECT entity_id FROM critical_operation_entities WHERE request_id='r1'").get().entity_id)===7,'mapping failed')

  for (const marker of ['beginCriticalOperation','completeCriticalOperation','insertCriticalMappedEntity',"criticalOperationReliability: '1901'"]) check(worker.includes(marker),`worker marker missing ${marker}`)
  for (const op of ['order_create','order_edit','return_create','return_cancel','exchange_create','exchange_cancel']) check(worker.includes(`'${op}'`),`critical op missing ${op}`)
  check(worker.includes('X-Idempotency-Key'),'server idempotency header support missing')
  check(app.includes("'X-Idempotency-Key': critical.requestId"),'frontend idempotency header missing')
  check(app.includes('prepareCriticalRequest') && app.includes('completeCriticalRequest'),'frontend request reuse missing')
  check(!team.includes('Это не контроль того, кто нажимал кнопки.'),'internal Team explanation still visible')
  check(worker.includes('Money-only returns intentionally have no return_items'),'money-only return rule missing')
  const createReturn=slice(worker,'async function createReturn','async function listExchanges')
  check(createReturn.includes('ownOperationReturnAmount'),'return retry must not reject its own refund')
  const createExchange=slice(worker,'async function createExchange','async function listExchanges')
  check(createExchange.includes('!operationContext.baselineCaptured && await hasActiveStandaloneReturn'),'exchange retry standalone-return guard not protected')
  check(createExchange.includes('!operationContext.baselineCaptured && humanInventoryModelEnabled'),'exchange retry physical-issued guard not protected')
  const cancelExchange=slice(worker,'async function cancelExchange','function normalizeWorkshopViewMode')
  check(cancelExchange.includes('restoredOldQuantityTarget') && cancelExchange.includes('restoredTotalAmountTarget'),'exchange cancel target snapshot missing')
  check(!app.includes('new Set([408, 425, 429, 500,'),'deterministic HTTP 500 must not be blindly retried')
  console.log('Step 190.1 critical operation reliability tests: OK')
} catch(e) { console.error(`Step 190.1 tests FAILED: ${e?.message||e}`); process.exit(1) }

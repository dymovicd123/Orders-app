import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'

const source = fs.readFileSync('worker/domains/team.ts', 'utf8')
const body = source.slice(source.indexOf('export async function listPlans('), source.indexOf('export async function saveManagerPlan('))
const queries = [...body.matchAll(/`([\s\S]*?)`/g)].map(match => match[1])
const baseline = JSON.parse(fs.readFileSync('scripts/fixtures/o1-plans-baseline.json', 'utf8'))
assert.equal(queries.length, 2)
const db = new DatabaseSync(':memory:')
db.exec(`
 CREATE TABLE managers(id INTEGER PRIMARY KEY, name TEXT, color_key TEXT);
 CREATE TABLE orders(id INTEGER PRIMARY KEY, manager_id INTEGER, order_status TEXT);
 CREATE TABLE payments(order_id INTEGER, payment_date TEXT, amount INTEGER);
 CREATE TABLE returns(order_id INTEGER, manager_id INTEGER, return_date TEXT, amount INTEGER, status TEXT);
 CREATE TABLE plans(id INTEGER PRIMARY KEY, period_start TEXT, period_end TEXT, manager_id INTEGER,
   planned_amount INTEGER, salary_base INTEGER, bonus_hit_percent INTEGER, bonus_miss_percent INTEGER,
   bonus_amount INTEGER, total_salary INTEGER, comment TEXT);
 CREATE TABLE department_plans(id INTEGER PRIMARY KEY, period_start TEXT, period_end TEXT, planned_amount INTEGER, comment TEXT);
 INSERT INTO managers VALUES (1,'A',NULL),(2,'B','red'),(3,'Empty',NULL);
 INSERT INTO orders VALUES (1,1,'active'),(2,2,'closed'),(3,1,'deleted'),(4,NULL,'active');
 INSERT INTO payments VALUES (1,'2026-08-01',10),(1,'2026-09-01',100),(1,'2026-09-30',200),
   (2,'2026-09-15',300),(3,'2026-09-15',9999),(4,'2026-09-15',40),(1,'2026-10-01',50);
 INSERT INTO returns VALUES (1,NULL,'2026-09-01',20,NULL),(1,2,'2026-09-15',30,'completed'),
   (2,1,'2026-09-16',400,'completed'),(1,1,'2026-09-15',9999,'cancelled'),
   (3,1,'2026-09-15',9999,'completed'),(4,NULL,'2026-09-15',5,'completed');
 INSERT INTO plans VALUES (1,'2026-09-01','2026-09-30',1,1000,100,5,3,0,0,NULL),
   (2,'2026-09-01','2026-09-30',2,1000,100,5,3,0,0,'x'),
   (3,'2026-08-01','2026-10-01',1,1000,100,5,3,0,0,NULL),
   (4,'2026-09-01','2026-09-30',3,1000,100,5,3,0,0,NULL),
   (5,'2026-09-01','2026-09-30',999,1000,100,5,3,0,0,NULL);
 INSERT INTO department_plans VALUES (1,'2026-09-01','2026-09-30',1000,NULL),
   (2,'2026-08-01','2026-10-01',2000,'overlap');
`)
for (const dates of [['2026-09-01','2026-09-30'],['2026-09-15','2026-09-15'],['2026-10-01','2026-10-01'],['2027-01-01','2027-01-31']]) {
  for (let i = 0; i < queries.length; i++) {
    assert.deepEqual(db.prepare(queries[i]).all(...dates), db.prepare(baseline[i]).all(...dates), `plan ${i}: ${dates}`)
  }
}
db.exec('DELETE FROM plans; DELETE FROM department_plans;')
for (let i = 0; i < queries.length; i++) assert.deepEqual(db.prepare(queries[i]).all('2026-09-01','2026-09-30'), [])
db.close()
const app = fs.readFileSync('src/App.tsx','utf8')
const refresh = app.slice(app.indexOf('const refreshInventoryModule ='),app.indexOf('const {',app.indexOf('const refreshInventoryModule =')))
assert.ok(refresh.includes("loadInventoryData('warehouse', force"))
assert.ok(refresh.includes("loadInventoryData('boutique', force"))
assert.ok(refresh.includes('loadCatalogData(force)') && refresh.includes('loadReferencesData(force)'))
console.log('O1 passed: SQL result parity, overlapping periods, attribution, cancelled/deleted, negative facts, empty plans; explicit refresh remains fresh')

const helper = ts.transpileModule(fs.readFileSync('src/app/controllers/coalesceReads.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { createReadCoalescer } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`)
const run = createReadCoalescer()
let calls = 0
let finish
const fetcher = () => { calls++; return new Promise(resolve => { finish = resolve }) }
const first = run('manager:stock',false,fetcher)
const second = run('manager:stock',false,fetcher)
await Promise.resolve()
assert.equal(calls,1)
finish(new Response('fresh'))
assert.deepEqual(await Promise.all([first.then(r=>r.text()),second.then(r=>r.text())]),['fresh','fresh'])
await run('manager:stock',false,async()=>{ calls++; return new Response('new') })
assert.equal(calls,2,'completed reads must not be cached')
const old = run('manager:stock',false,fetcher)
await Promise.resolve()
const finishOld = finish
await run(null,true,async()=>new Response('saved'))
assert.equal(await (await run('manager:stock',false,async()=>new Response('after write'))).text(),'after write')
finishOld(new Response('before write'))
await old
let finishWrite
const write = run(null,true,()=>new Promise(resolve=>{ finishWrite=resolve }))
let during = 0
await Promise.all([1,2].map(()=>run('manager:stock',false,async()=>{during++;return new Response('during')})))
assert.equal(during,2,'reads overlapping writes must not be shared')
finishWrite(new Response('saved')); await write
await assert.rejects(run('x',false,async()=>{throw new Error('offline')}),/offline/)
assert.equal(await (await run('x',false,async()=>new Response('retry'))).text(),'retry')
let isolated = 0
await Promise.all(['manager:stock','admin:stock',null,null].map(key=>run(key,false,async()=>{isolated++;return new Response('ok')})))
assert.equal(isolated,4)
console.log('O1 passed: concurrent GET coalescing, independent bodies, no completed cache, role separation, failures and mutation barriers')

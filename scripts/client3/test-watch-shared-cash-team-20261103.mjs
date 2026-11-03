import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {
 getWatchSharedCash,setupWatchSharedCash,writeWatchSharedCash,reverseWatchSharedCash,
 setWatchSharedCashAuto,resetWatchSharedCashCycle,
} from '../../worker/domains/client3-watch-shared-cash.ts'
import {
 listClient3WatchTeam,saveClient3WatchEmployee,setClient3WatchEmployeeActive,
 listClient3WatchTimesheet,saveClient3WatchTimesheet,listClient3WatchTeamSalary,
 listClient3WatchTeamActivity,
} from '../../worker/domains/client3-watch-team-main.ts'
import {createAuthUser,listAuthUsers} from '../../worker/domains/auth.ts'
import {listWatchBrands,listWatchModels,listWatchLogistics,assignWatchManagerBrands} from '../../worker/domains/client3-watches.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const path of fs.readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
 sqlite.exec(fs.readFileSync('migrations/'+path,'utf8'))
if(!sqlite.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
 sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const paths=fs.readdirSync('migrations/client3-watch').filter(x=>/^\d+.*\.sql$/.test(x)).sort()
for(const path of paths.filter(x=>x<'1003_shared_cash_main_team.sql'))
 sqlite.exec(fs.readFileSync('migrations/client3-watch/'+path,'utf8'))
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM watch_brands').get().n,2)
sqlite.prepare("INSERT OR IGNORE INTO managers(id,name,role,created_at) VALUES(1,'ТЕСТОВЫЙ МЕНЕДЖЕР','Менеджер','2026-11-03')").run()
sqlite.prepare("INSERT OR IGNORE INTO watch_manager_brands(manager_id,brand_id) VALUES(1,1)").run()
const now='2026-11-03T10:00:00Z'
sqlite.prepare(`INSERT INTO watch_brand_cash_registers
 (brand_id,opening_amount,financial_event_watermark,initialized_at,initialized_by)
 VALUES (1,10000,0,?,1),(2,7000,0,?,1)`).run(now,now)
sqlite.prepare(`INSERT INTO watch_brand_cash_entries
 (brand_id,request_id,entry_type,amount_delta,business_date,comment,actor_user_id,created_at)
 VALUES (1,'historic-brand-one-001','manual_in',2000,'2026-11-03','Историческое внесение',1,?),
        (2,'historic-brand-two-001','manual_out',-500,'2026-11-03','Историческая выдача',1,?)`)
 .run(now,now)
const initialOld=sqlite.prepare('SELECT SUM(opening_amount) AS n FROM watch_brand_cash_registers').get().n+
 sqlite.prepare('SELECT SUM(amount_delta) AS n FROM watch_brand_cash_entries').get().n
assert.equal(initialOld,18500)
sqlite.exec(fs.readFileSync('migrations/client3-watch/1003_shared_cash_main_team.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/1003_shared_cash_main_team.sql','utf8'))
const migrated=sqlite.prepare('SELECT * FROM watch_shared_cash_register').get()
assert.equal(migrated.opening_amount,18500,'Both brand balances merged once')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM watch_shared_cash_register').get().n,1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM watch_brand_cash_entries').get().n,2,'Legacy audit entries preserved')
const stmt=(q,args=[])=>({
 bind(...values){return stmt(q,values)},
 async first(){return sqlite.prepare(q).get(...args)||null},
 async all(){return {results:sqlite.prepare(q).all(...args)}},
 async run(){const res=sqlite.prepare(q).run(...args)
  return {meta:{changes:res.changes,last_row_id:res.lastInsertRowid}}},
})
const db={
 prepare:stmt,
 async batch(statements){
  sqlite.exec('SAVEPOINT cli3_test')
  try{const r=[];for(const s of statements)r.push(await s.run())
   sqlite.exec('RELEASE cli3_test');return r}
  catch(e){sqlite.exec('ROLLBACK TO cli3_test');sqlite.exec('RELEASE cli3_test');throw e}
 },
}
const parse=async value=>{const r=await value;return {...await r.json(),status:r.status}}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Админ'}
const manager={id:2,role:'manager',managerId:1,employeeRole:'Менеджер'}
const unified=await parse(getWatchSharedCash(db,admin))
assert.equal(unified.status,200)
assert.equal(unified.currentBalance,18500)
assert.equal(unified.legacyEntries.length,2)
assert(unified.legacyEntries.some(x=>x.brand==='TAUWACH'))
assert(unified.legacyEntries.some(x=>x.brand==='WACHIZEN'))
assert.equal((await parse(getWatchSharedCash(db,manager))).status,403)
const noDuplicateSetup=await parse(setupWatchSharedCash(db,admin,{openingAmount:20000}))
assert.equal(noDuplicateSetup.status,409)
const cashIn={amount:1200,direction:'in',comment:'Общая ручная операция',
 expectedBalance:18500,requestId:'shared-cash-in-20261103'}
const after=await parse(writeWatchSharedCash(db,admin,'manual',cashIn))
assert.equal(after.currentBalance,19700)
assert.equal((await parse(writeWatchSharedCash(db,admin,'manual',cashIn))).currentBalance,19700)
assert.equal((await parse(writeWatchSharedCash(db,admin,'manual',{
 amount:200,direction:'out',comment:'Устаревший остаток',
 expectedBalance:18500,requestId:'shared-cash-stale-20261103'}))).status,409)
assert.equal((await parse(writeWatchSharedCash(db,admin,'manual',{
 amount:200000,direction:'out',comment:'Превышение остатка',
 expectedBalance:19700,requestId:'shared-cash-overdraw-20261103'}))).status,409)
const manualEntry=sqlite.prepare('SELECT id FROM watch_shared_cash_entries WHERE request_id=?')
 .get(cashIn.requestId).id
const undone=await parse(reverseWatchSharedCash(db,admin,{entryId:manualEntry,expectedBalance:19700}))
assert.equal(undone.currentBalance,18500)
assert.equal((await parse(reverseWatchSharedCash(db,admin,{entryId:manualEntry,expectedBalance:19700}))).currentBalance,18500)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM watch_shared_cash_entries WHERE reverses_entry_id=?')
 .get(manualEntry).n,1)
assert.equal((await parse(setWatchSharedCashAuto(db,admin,false))).autoTrackingEnabled,false)
assert.equal((await parse(setWatchSharedCashAuto(db,admin,true))).autoTrackingEnabled,true)
const resetRequest={comment:'Единый новый цикл после пересчёта',
 requestId:'shared-cash-cycle-20261103',expectedBalance:18500}
const reset=await parse(resetWatchSharedCashCycle(db,admin,resetRequest))
assert.equal(reset.status,200,JSON.stringify(reset))
assert.equal(reset.currentBalance,0)
assert.equal(reset.cycles.length,1)
assert.equal(reset.cycles[0].closingBalance,18500)
assert.equal((await parse(resetWatchSharedCashCycle(db,admin,resetRequest))).cycles.length,1)
assert.equal((await parse(writeWatchSharedCash(db,admin,'manual',{
 direction:'in',amount:400,comment:'Новые наличные',
 expectedBalance:0,requestId:'shared-second-cycle-20261103'}))).currentBalance,400)

// Team is shared across brands, reusing Main roster and its active-status guard.
const read0=await parse(listClient3WatchTeam(db,admin))
assert.equal(read0.status,200,JSON.stringify(read0))
assert.equal(read0.employees.find(e=>e.id===1).brands.length,1)
assert.equal((await parse(listClient3WatchTeam(db,manager))).status,403)
const created=await parse(saveClient3WatchEmployee(db,admin,{
 name:'НОВЫЙ ЛОГИСТ',role:'Логист',phone:'+7 777 111 22 33',
 birthDate:'1999-05-06',hiredAt:'2026-11-03',colorKey:'#7C3AED',
 comment:'Работает по двум брендам',
}))
assert.equal(created.status,200,JSON.stringify(created))
const employeeId=created.id
const read1=await parse(listClient3WatchTeam(db,admin))
const logistic=read1.employees.find(e=>e.id===employeeId)
assert.equal(logistic.role,'Логист','Original logistics permissions must survive Main team edits')
assert.equal(logistic.birthDate,'1999-05-06')
assert.deepEqual(logistic.brands,[],'A logist is independent of brand assignments')
assert.equal(logistic.allBrandsLogistics,true,'Logistics employee sees both brand queues')
assert.equal(logistic.phone,'+7 777 111 22 33')
assert.equal((await parse(saveClient3WatchEmployee(db,manager,{name:'BAD',role:'Админ'}))).status,403)
assert.equal((await parse(saveClient3WatchEmployee(db,admin,{name:'ПОСТОРОННИЙ',role:'Упаковщик'}))).status,400,
 'New packager role must not be offered or accepted')
const logistActor={id:3,role:'manager',managerId:employeeId,employeeRole:'Логист'}
const availableBrands=await parse(listWatchBrands(db,logistActor))
assert.deepEqual(availableBrands.brands.map(x=>x.code),['TAUWACH','WACHIZEN'],
 'A logist must see both watch brands without a brand assignment')
const globalLogistics=await parse(listWatchLogistics(db,logistActor,
  new URL('https://client3.test/api/client3/watches/logistics?status=all')))
assert.equal(globalLogistics.status,200,'Logist must reach a two-brand order queue')
const salesDenied=await parse(listWatchModels(db,logistActor,
  new URL('https://client3.test/api/client3/watches/models?brand=TAUWACH')))
assert.equal(salesDenied.status,403,'Logist may not access sales catalog')
const deniedLogistBrand=await parse(assignWatchManagerBrands(db,admin,employeeId,{
 brands:['TAUWACH'],expectedBrands:[],requestId:'test-logist-nobrands-20261103',
}))
assert.equal(deniedLogistBrand.status,400,'Logists cannot be assigned brand memberships')
const loginRequest=new Request('https://client3.test/api/auth/users',{
 method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({login:'client3_logist',password:'TempPass345!',role:'manager',
   managerId:employeeId,displayName:'НОВЫЙ ЛОГИСТ'}),
})
const createdAccount=await parse(createAuthUser(db,loginRequest,admin))
assert.equal(createdAccount.status,201,JSON.stringify(createdAccount))
assert.equal(sqlite.prepare('SELECT role,manager_id FROM app_users WHERE id=?')
 .get(createdAccount.id).manager_id,employeeId)
assert((await listAuthUsers(db)).items.some(u=>u.login==='client3_logist'&&u.managerId===employeeId))
const duplicateAccount=await parse(createAuthUser(db,new Request('https://client3.test/api/auth/users',{
 method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({login:'client3_other',password:'TempPass345!',role:'manager',managerId:employeeId}),
}),admin))
assert.equal(duplicateAccount.status,409,'Cannot create duplicate staff account')
assert.equal((await parse(saveClient3WatchEmployee(db,admin,{
 id:employeeId,name:'НОВЫЙ ЛОГИСТ',role:'Логист',hiredAt:'2026-11-03',
 colorKey:'#2563EB',birthDate:'1999-05-06',
}))).status,200)
const timesheetURL=new URL('https://client3.test/api/client3/watches/team/timesheet?month=2026-11')
const sheet=await parse(listClient3WatchTimesheet(db,admin,timesheetURL))
assert.equal(sheet.status,200)
assert(sheet.employees.some(x=>x.id===employeeId))
const stored=await parse(saveClient3WatchTimesheet(db,admin,{
 dates:['2026-11-02'],managerIds:[employeeId],workUntil:'18:00',comment:'Смена'}))
assert.equal(stored.status,200)
const reread=await parse(listClient3WatchTimesheet(db,admin,timesheetURL))
assert(reread.entries.some(x=>x.managerId===employeeId&&x.date==='2026-11-02'))
const reportUrl=new URL('https://client3.test/api/client3/watches/team/salary?from=2026-11-01&to=2026-11-30')
const salary=await parse(listClient3WatchTeamSalary(db,admin,reportUrl))
assert.equal(salary.status,200)
assert(salary.rows.some(x=>x.managerId===employeeId))
const activity=await parse(listClient3WatchTeamActivity(db,admin,reportUrl))
assert.equal(activity.status,200)
assert(activity.rows.some(x=>x.managerId===employeeId))
const dismissed=await parse(setClient3WatchEmployeeActive(db,admin,employeeId,false))
assert.equal(dismissed.status,200,JSON.stringify(dismissed))
assert.equal((await parse(listClient3WatchTeam(db,admin))).employees.find(x=>x.id===employeeId).isActive,false)
assert.equal((await parse(setClient3WatchEmployeeActive(db,admin,employeeId,true))).status,200)
// A lightweight Client3 roster does not depend on Main-only history tables.
sqlite.exec('DROP TABLE attendance_days')
const afterMissingMainHistory=await parse(listClient3WatchTeam(db,admin))
assert.equal(afterMissingMainHistory.status,200)
assert(afterMissingMainHistory.employees.some(e=>e.id===1),
 'Existing managers must remain visible when old Main history tables are absent')
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_SHARED_CASH_MAIN_TEAM_ACCEPTANCE_PASS: cash 2 brands merged once, archive, idempotency, reversal, pause, cycles and Main roster/logistics/timesheet/rights')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { addDdsExpense, addDdsFunds, editDdsEntry, readDdsEntryEdits, readDdsHistoryPage, readDdsMonth, reverseDdsEntry, canManageDds } from '../worker/domains/dds.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const name of [
 '0120_shared_dds_ledger.sql','0121_dds_directory.sql','0123_dds_allow_negative_balance.sql',
 '0139_dds_entry_edits_audit.sql',
])sqlite.exec(readFileSync('migrations/'+name,'utf8'))

const db={
 prepare(query) {
  const bind=(...args)=>({
   async first(){return sqlite.prepare(query).get(...args)||null},
   async all(){return {results:sqlite.prepare(query).all(...args)}},
   async run(){const r=sqlite.prepare(query).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
  })
  return {bind,...bind()}
 },
}
const admin={id:1,role:'admin',employeeRole:''}
const supervisor={id:2,role:'manager',employeeRole:'Завсклад'}
const manager={id:3,role:'manager',employeeRole:'Менеджер'}
assert.equal(canManageDds(admin),true)
assert.equal(canManageDds(supervisor),true)
assert.equal(canManageDds(manager),false)
const days=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
const part=(key)=>days.find(x=>x.type===key).value
const today=part('year')+'-'+part('month')+'-'+part('day')
const older='2026-10-10'
const month=today.slice(0,7)
let seq=0
const id=()=>('dds-audit-test-'+(++seq).toString().padStart(6,'0'))
const payment=await addDdsFunds(db,{businessDate:today,amount:100000,requestId:id()},admin)
const cost=await addDdsExpense(db,{businessDate:today,amount:20000,category:'Помещение',
 article:'Ремонт и оборудование',comment:'СТУЛЬЧИК',requestId:id()},manager)
assert.equal((await readDdsMonth(db,month,supervisor)).permissions.canEdit,true)
assert.equal((await readDdsMonth(db,month,manager)).permissions.canEdit,false)
const before=await readDdsHistoryPage(db,{},manager)
assert.equal(before.entries.length,2)
assert.equal(before.hasMore,false)
assert.equal(before.entries[0].editVersion,0)
const revision=id()
await assert.rejects(editDdsEntry(db,cost.id,{
 businessDate:older,amount:21000,category:'Помещение',article:'Ремонт и оборудование',
 comment:'СТУЛЬЧИК',expectedVersion:0,reason:'Ошибка суммы',requestId:id(),
},manager),/администратор или завсклад/)
const corrected=await editDdsEntry(db,cost.id,{
 businessDate:older,amount:26500,category:'Помещение',article:'Ремонт и оборудование',
 comment:'СТУЛЬЧИК, уточнено',expectedVersion:0,reason:'Ошибка суммы и даты',requestId:revision,
},supervisor)
assert.equal(corrected.ok,true)
assert.equal(corrected.alreadySaved,false)
const replay=await editDdsEntry(db,cost.id,{
 businessDate:older,amount:26500,category:'Помещение',article:'Ремонт и оборудование',
 comment:'СТУЛЬЧИК, уточнено',expectedVersion:0,reason:'Ошибка суммы и даты',requestId:revision,
},supervisor)
assert.equal(replay.alreadySaved,true)
await assert.rejects(editDdsEntry(db,cost.id,{
 businessDate:today,amount:100,category:'Помещение',article:'Ремонт и оборудование',comment:'',
 expectedVersion:0,reason:'Чужая версия',requestId:id(),
},supervisor),/Запись изменилась/)
const history=await readDdsEntryEdits(db,cost.id,admin)
assert.equal(history.edits.length,1)
assert.deepEqual([
 history.edits[0].oldAmount,history.edits[0].newAmount,
 history.edits[0].oldBusinessDate,history.edits[0].newBusinessDate,
 history.edits[0].oldComment,history.edits[0].newComment,
],[20000,26500,today,older,'СТУЛЬЧИК','СТУЛЬЧИК, уточнено'])
await assert.rejects(readDdsEntryEdits(db,cost.id,manager),/администратор или завсклад/)
assert.equal((await readDdsMonth(db,month,manager)).monthSpent,0)
assert.equal((await readDdsMonth(db,month,manager)).currentBalance,73500)
assert.equal((await readDdsMonth(db,older.slice(0,7),manager)).monthSpent,26500)
const page=await readDdsHistoryPage(db,{throughDate:older},manager)
assert.equal(page.entries.length,1)
assert.equal(page.entries[0].amount,26500)
assert.equal(page.entries[0].editVersion,1)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
const count=sqlite.prepare('SELECT COUNT(*) AS n FROM dds_entry_edits').get().n
assert.equal(count,1)
assert.throws(()=>sqlite.prepare("UPDATE dds_entry_edits SET reason='changed' WHERE entry_id=?").run(cost.id),/DDS_EDIT_AUDIT_IMMUTABLE/)
assert.throws(()=>sqlite.prepare('DELETE FROM dds_entry_edits WHERE entry_id=?').run(cost.id),/DDS_EDIT_AUDIT_IMMUTABLE/)
await reverseDdsEntry(db,cost.id,{requestId:id(),comment:'Отменено полностью'},supervisor)
await assert.rejects(editDdsEntry(db,cost.id,{
 businessDate:today,amount:15000,category:'Помещение',article:'Ремонт и оборудование',
 comment:'Попытка',expectedVersion:1,reason:'Ошибка данных',requestId:id(),
},supervisor),/уже отменена/)
await assert.rejects(editDdsEntry(db,payment.id,{
 businessDate:today,amount:0,comment:'',reason:'Неверная сумма',expectedVersion:0,requestId:id(),
},supervisor),/от 1 до/)
const wrong=await addDdsExpense(db,{businessDate:today,amount:2000,category:'Упаковка',
 article:'Коробки',requestId:id()},manager)
await assert.rejects(editDdsEntry(db,wrong.id,{
 businessDate:today,amount:2200,category:'Упаковка',article:'Фальшивая',
 comment:'',reason:'Исправление',expectedVersion:0,requestId:id(),
},supervisor),/действующую категорию/)
assert.equal(sqlite.prepare("SELECT amount FROM dds_entries WHERE id=?").get(wrong.id).amount,2000)
for(let n=0;n<68;n++)await addDdsExpense(db,{businessDate:older,amount:1,
 category:'Упаковка',article:'Коробки',requestId:id()},manager)
let cursor,found=[],loops=0
do{
 const p=await readDdsHistoryPage(db,cursor||{},manager)
 found.push(...p.entries.map(r=>r.id))
 cursor=p.hasMore?p.nextCursor:null
 loops++
}while(cursor&&loops<10)
assert.equal(new Set(found).size,found.length)
assert.equal(found.length,sqlite.prepare('SELECT COUNT(*) AS n FROM dds_entries').get().n)
assert(loops>=3)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='cash_register_entries'").get().n,0)
const app=readFileSync('src/App.tsx','utf8')
const worker=readFileSync('worker/index.ts','utf8')
assert(app.includes("const canManageFinance = isAdmin || authUser?.employeeRole === 'Завсклад'"))
assert(worker.includes("cleanText(proposal.kind) === 'paymentMethods'"))
assert(worker.includes("url.pathname === '/api/dds/entries'"))
assert(worker.includes("ddsEditMatch && request.method === 'PATCH'"))
const ui=readFileSync('src/features/finance/DdsWorkspace.tsx','utf8')
assert(ui.includes('Загрузить более ранние записи'))
assert(ui.includes('Сохранить исправление'))
assert(ui.includes('Причина исправления'))
sqlite.close()
console.log('DDS_EDIT_PAGINATION_PASS: scoped privilege, immutable old/new audit, version CAS, reversed lock, date balance, cross-month pagination')

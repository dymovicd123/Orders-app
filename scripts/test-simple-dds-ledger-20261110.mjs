// Isolated DDS journal contract: in-memory SQLite only, no remote D1, orders or office cash.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { DDS_CATEGORIES } from '../shared/dds-categories.ts'
import { addDdsExpense, addDdsFunds, readDdsMonth, reverseDdsEntry } from '../worker/domains/dds.ts'
import { addDdsCategory, addDdsArticle, readDdsDirectory, setDdsCategoryActive, setDdsArticleActive } from '../worker/domains/dds-directory.ts'

const sql = new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec(readFileSync('migrations/0120_shared_dds_ledger.sql','utf8'))
sql.exec(readFileSync('migrations/0121_dds_directory.sql','utf8'))
const db = {
  prepare(query) {
    return { bind(...args) {
      return {
        async first() { return sql.prepare(query).get(...args) ?? null },
        async all() { return { results: sql.prepare(query).all(...args) } },
        async run() {
          const result = sql.prepare(query).run(...args)
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        },
      }
    }}
  },
}
const admin = { id: 1, role:'admin' }
const manager = { id: 2, role:'manager' }
const d = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
const take = k=>d.find(x=>x.type===k).value
const date=take('year')+'-'+take('month')+'-'+take('day')
const month=date.slice(0,7)
let i=0
const id=()=>('dds-test-request-'+String(++i).padStart(5,'0'))
const report=()=>readDdsMonth(db,month,manager)

assert.equal(DDS_CATEGORIES.length,12)
const initialDirectory = await readDdsDirectory(db,manager)
assert.equal(initialDirectory.length,12,'All original categories must be migrated')
assert.equal(initialDirectory.reduce((sum,group)=>sum+group.articles.length,0),50,'All original articles must be migrated')
assert.ok(initialDirectory.every(group=>group.active&&group.articles.every(article=>article.active)))
assert.equal((await report()).currentBalance,0)
await assert.rejects(()=>addDdsFunds(db,{amount:1000,businessDate:date,requestId:id()},manager),/администратор/)
await assert.rejects(()=>addDdsExpense(db,{amount:200,businessDate:date,category:'Упаковка',article:'Некорректно',requestId:id()},manager),/статью/)
const fundId=id()
const first=await addDdsFunds(db,{amount:100000,businessDate:date,requestId:fundId},admin)
assert.equal(first.alreadySaved,false)
const replay=await addDdsFunds(db,{amount:100000,businessDate:date,requestId:fundId},admin)
assert.equal(replay.alreadySaved,true)
assert.equal((await report()).currentBalance,100000)
await assert.rejects(()=>addDdsFunds(db,{amount:100001,businessDate:date,requestId:fundId},admin),/другими данными/)
const expense=await addDdsExpense(db,{amount:30000,businessDate:date,category:'Упаковка',article:'Коробки',comment:'20 штук',requestId:id()},manager)
assert.equal(expense.ok,true)
await addDdsFunds(db,{amount:20000,businessDate:date,requestId:id()},admin)
let state=await report()
assert.deepEqual([state.currentBalance,state.monthAdded,state.monthSpent,state.closingBalance],[90000,120000,30000,90000])
assert.equal(state.categories.find(c=>c.name==='Упаковка').total,30000)
assert.equal(state.entries.filter(e=>e.kind==='funding').length,2)

const settled=await Promise.allSettled([60000,60000].map(amount=>
 addDdsExpense(db,{amount,businessDate:date,category:'Доставка клиенту',article:'Курьер — авиа',requestId:id()},manager)))
assert.equal(settled.filter(x=>x.status==='fulfilled').length,1,'Only one of two competing last-money expenses may succeed')
assert.equal((await report()).currentBalance,30000)
await assert.rejects(()=>addDdsExpense(db,{amount:31000,businessDate:date,category:'Упаковка',article:'Коробки',requestId:id()},manager),/Недостаточно/)
await assert.rejects(()=>addDdsExpense(db,{amount:1,businessDate:date,category:'Зарплата — менеджеры',article:'Оклад',requestId:id()},manager),/комментарии/)
await assert.rejects(()=>reverseDdsEntry(db,expense.id,{comment:'Ошибка',requestId:id()},manager),/администратор/)
const reverseId=id()
await reverseDdsEntry(db,expense.id,{comment:'Ошибочная покупка',requestId:reverseId},admin)
assert.equal((await report()).currentBalance,60000)
assert.equal((await reverseDdsEntry(db,expense.id,{comment:'Ошибочная покупка',requestId:reverseId},admin)).alreadySaved,true)
await assert.rejects(()=>reverseDdsEntry(db,expense.id,{comment:'Повторная отмена',requestId:id()},admin),/уже отменена/)
await assert.rejects(()=>reverseDdsEntry(db,first.id,{comment:'Ошибка пополнения',requestId:id()},admin),/Недостаточно/)
state=await report()
assert.deepEqual([state.monthAdded,state.monthSpent,state.closingBalance],[120000,60000,60000])
assert.equal(state.categories.find(c=>c.name==='Упаковка').total,0)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM dds_entries').get().n,5,'No duplicate entries after replay and rejected writes')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='cash_register_entries'").get().n,0)

// Client-managed directory is admin-only, never modifies historical money or category strings.
await assert.rejects(()=>addDdsCategory(db,'Командировки',manager),/администратор/)
const newCategory=await addDdsCategory(db,'Командировки',admin)
assert.equal(newCategory.ok,true)
assert.equal((await addDdsCategory(db,'командировки',admin)).id,newCategory.id,'Case-insensitive duplicate must not create another')
const newArticle=await addDdsArticle(db,newCategory.id,'Такси',admin)
assert.equal((await addDdsArticle(db,newCategory.id,'такси',admin)).id,newArticle.id)
assert.equal((await readDdsDirectory(db,manager)).length,13)
await assert.rejects(()=>addDdsArticle(db,newCategory.id,'Отель',manager),/администратор/)
const newExpense=await addDdsExpense(db,{
  amount:1000,businessDate:date,category:'Командировки',article:'Такси',
  comment:'Поездка в цех',requestId:id(),
},manager)
assert.equal(newExpense.ok,true)
assert.equal((await report()).currentBalance,59000)
assert.equal((await report()).categories.find(group=>group.name==='Командировки').total,1000)
await assert.rejects(()=>setDdsArticleActive(db,newArticle.id,false,manager),/администратор/)
await setDdsArticleActive(db,newArticle.id,false,admin)
await assert.rejects(()=>addDdsExpense(db,{
  amount:100,businessDate:date,category:'Командировки',article:'Такси',requestId:id(),
},manager),/статью/)
assert.equal((await report()).categories.find(group=>group.name==='Командировки').total,1000,
  'Archived article remains in historical monthly reports')
// Even a concurrent raw insert cannot bypass archived-article validation.
assert.throws(()=>sql.prepare(`INSERT INTO dds_entries
  (request_id,kind,amount,business_date,category,article,comment,created_at)
  VALUES(?,?,?,?,?,?,?,?)`).run(id(),'expense',100,date,'Командировки','Такси','',date),
  /DDS_INVALID_ARTICLE/)
await setDdsArticleActive(db,newArticle.id,true,admin)
await setDdsCategoryActive(db,newCategory.id,false,admin)
await assert.rejects(()=>addDdsExpense(db,{
  amount:100,businessDate:date,category:'Командировки',article:'Такси',requestId:id(),
},manager),/статью/)
assert.equal((await report()).categories.find(group=>group.name==='Командировки').total,1000)
await setDdsCategoryActive(db,newCategory.id,true,admin)
assert.ok((await readDdsDirectory(db,manager)).find(group=>group.name==='Командировки').active)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM dds_entries").get().n,6)
console.log('SIMPLE_DDS_LEDGER_PASS: 12+1 categories, 50+1 articles, self-managed directory, history preserved, archived article write guard, repeated funds and nonnegative balances')

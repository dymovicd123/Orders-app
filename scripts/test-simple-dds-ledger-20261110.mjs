// Isolated DDS journal contract: in-memory SQLite only, no remote D1, orders or office cash.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { DDS_CATEGORIES } from '../shared/dds-categories.ts'
import { addDdsExpense, addDdsFunds, readDdsMonth, reverseDdsEntry } from '../worker/domains/dds.ts'

const sql = new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec(readFileSync('migrations/0120_shared_dds_ledger.sql','utf8'))
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
console.log('SIMPLE_DDS_LEDGER_PASS: roles, repeated topups, independent month, atomic nonnegative balance, retry, reversal, 12 categories')

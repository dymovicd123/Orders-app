import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {watchManagerReportNameSql as manager} from '../../worker/domains/client3-watch-manager-name.ts'

const analytics=fs.readFileSync('worker/domains/client3-watch-analytics.ts','utf8')
const details=fs.readFileSync('worker/domains/client3-watch-report-details.ts','utf8')
const orders=fs.readFileSync('worker/domains/client3-watch-orders-read.ts','utf8')
assert(manager.includes('o.manager_snapshot_name'))
assert(manager.includes('m.id=o.manager_id'))
assert(manager.includes("'НЕ УКАЗАН'"))
assert(analytics.includes('GROUP BY o.manager_id,${watchManagerReportNameSql}'))
assert(details.includes('GROUP BY o.manager_id,${watchManagerReportNameSql}'))
assert((analytics.match(/\$\{watchManagerReportNameSql\}/g)||[]).length>=4)
assert((details.match(/\$\{watchManagerReportNameSql\}/g)||[]).length>=3)
assert(orders.includes('(SELECT m.name FROM managers m WHERE m.id=o.manager_id LIMIT 1)'))

const db=new DatabaseSync(':memory:')
try{
  db.exec("CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT NOT NULL)")
  db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY,manager_id INTEGER,manager_snapshot_name TEXT,order_date TEXT,total_amount INTEGER)")
  db.exec("INSERT INTO managers(id,name) VALUES (1,'МЕНЕДЖЕР А'),(2,'МЕНЕДЖЕР Б'),(3,'ТЕСТОВЫЙ МЕНЕДЖЕР')")
  const add=db.prepare('INSERT INTO orders(manager_id,manager_snapshot_name,order_date,total_amount) VALUES (?,?,?,?)')
  for(let i=0;i<9;i++)add.run(1,i%2?'':null,'2026-11-01',i===8?96950:70000)
  for(let i=0;i<4;i++)add.run(2,i%2?'   ':null,'2026-11-02',i===3?17970:80000)
  add.run(3,'СОХРАНЁННОЕ ИМЯ','2026-11-03',50000)
  add.run(3,'СОХРАНЁННОЕ ИМЯ','2026-11-04',62990)
  const query='SELECT o.manager_id AS managerId,'+manager+
    ' AS manager,COUNT(*) AS orders,SUM(o.total_amount) AS sales FROM orders o'+
    ' GROUP BY o.manager_id,'+manager+' ORDER BY o.manager_id'
  const rows=db.prepare(query).all()
  assert.equal(rows.length,3)
  assert.deepEqual(rows.map(x=>[x.manager,Number(x.orders),Number(x.sales)]),[
    ['МЕНЕДЖЕР А',9,656950],
    ['МЕНЕДЖЕР Б',4,257970],
    ['СОХРАНЁННОЕ ИМЯ',2,112990],
  ])
  assert.equal(rows.reduce((n,x)=>n+Number(x.orders),0),15)
  assert.equal(rows.reduce((n,x)=>n+Number(x.sales),0),1027910)
  assert.equal(rows.filter(x=>x.manager==='НЕ УКАЗАН').length,0)
  db.prepare("UPDATE managers SET name='НОВОЕ ИМЯ' WHERE id=3").run()
  assert.equal(db.prepare('SELECT '+manager+' AS manager FROM orders o WHERE o.manager_id=3 LIMIT 1').get().manager,'СОХРАНЁННОЕ ИМЯ')
  add.run(99,null,'2026-11-05',0)
  assert.equal(db.prepare('SELECT '+manager+' AS manager FROM orders o WHERE o.manager_id=99').get().manager,'НЕ УКАЗАН')
  console.log('CLIENT3_MANAGER_REPORT_NAMES_PASS: resolved managers, historical snapshot retained, totals unchanged')
}finally{db.close()}

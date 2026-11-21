import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {listTeamScheduleWeek,saveTeamScheduleWeek} from '../worker/domains/team-weekly-schedule.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER,
   color_key TEXT,hired_at TEXT,created_at TEXT);
 CREATE TABLE team_timesheet(id INTEGER PRIMARY KEY,work_date TEXT NOT NULL,manager_id INTEGER NOT NULL,
   work_until TEXT,comment TEXT,created_at TEXT,updated_at TEXT,UNIQUE(work_date,manager_id));
 CREATE TABLE team_attendance_marks(id INTEGER PRIMARY KEY,work_date TEXT,manager_id INTEGER,
   status TEXT,finished_at TEXT,comment TEXT,updated_at TEXT);
 CREATE TABLE activity_log(id INTEGER PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id INTEGER,
   order_id INTEGER,external_order_id TEXT,title TEXT,details TEXT,amount INTEGER,created_at TEXT);
 INSERT INTO managers VALUES
 (1,'Асия','Менеджер',1,'#113355','2026-09-01','2026-09-01'),
 (2,'Айым','Менеджер',1,'#225577','2026-09-01','2026-09-01'),
 (3,'Айторы','Менеджер',1,'#337799','2026-09-01','2026-09-01'),
 (4,'Бывший','Менеджер',0,'#555555','2026-09-01','2026-09-01'),
 (5,'Сымбат','Администратор',1,'#999999','2026-09-01','2026-09-01');
 INSERT INTO team_timesheet(work_date,manager_id,work_until,comment,created_at,updated_at) VALUES
 ('2026-11-23',1,'18:00','Старая смена','2026-11-01','2026-11-01'),
 ('2026-11-24',2,'19:00','Снять','2026-11-01','2026-11-01'),
 ('2026-11-26',3,'17:30','Оставить','2026-11-01','2026-11-01');
 INSERT INTO team_attendance_marks(work_date,manager_id,status,finished_at,comment,updated_at)
 VALUES ('2026-11-24',2,'present','18:00','Факт сохранён','2026-11-24');
`)
const db={
 prepare(query){
   const prepareBound=(args=[])=>({
     sql:query,args,
     bind(...input){return prepareBound(input)},
     async all(){return {results:sql.prepare(query).all(...args)}},
     async first(){return sql.prepare(query).get(...args)||null},
     async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
   })
   return prepareBound()
 },
 async batch(statements){
   sql.exec('BEGIN IMMEDIATE')
   const results=[]
   try{
     for(const stmt of statements){
       if(stmt.sql.trim().startsWith('SELECT'))results.push({results:sql.prepare(stmt.sql).all(...stmt.args)})
       else{const r=sql.prepare(stmt.sql).run(...stmt.args);results.push({meta:{changes:Number(r.changes)}})}
     }
     sql.exec('COMMIT')
     return results
   }catch(error){sql.exec('ROLLBACK');throw error}
 }
}
const rows=()=>sql.prepare('SELECT id,work_date,manager_id,work_until,comment,created_at,updated_at FROM team_timesheet ORDER BY work_date,manager_id').all()
const original=rows()
const initial=await listTeamScheduleWeek(db,'2026-11-23')
assert.equal(initial.startDate,'2026-11-23')
assert.equal(initial.entries.length,3)
assert.equal(initial.attendance.length,1)
assert.equal(initial.employees.length,3,'Inactive/admin accounts must not be shown in schedule')

const updateBase=initial.entries.find(x=>x.date==='2026-11-23')
const removeBase=initial.entries.find(x=>x.date==='2026-11-24')
const build=(date,managerId,kind,workUntil,comment='',base=null)=>({
 date,managerId,kind,workUntil,comment,
 baseId:base?.id??null,baseUpdatedAt:base?.updatedAt||'',
 baseWorkUntil:base?.workUntil||'',baseComment:base?.comment||''
})
const patch=[
 build('2026-11-23',1,'update','21:00','Точное изменение',updateBase),
 build('2026-11-24',2,'remove','19:00','Снять',removeBase),
 build('2026-11-23',2,'add','18:00'),
 build('2026-11-24',3,'add','19:00'),
 build('2026-11-25',1,'add','18:30'),
]
const result=await saveTeamScheduleWeek(db,{start:'2026-11-23',changes:patch})
assert.deepEqual([result.created,result.updated,result.removed],[3,1,1])
assert.equal(rows().length,5)
assert.equal(rows().find(x=>x.work_date==='2026-11-23'&&x.manager_id===1).work_until,'21:00')
assert.equal(rows().find(x=>x.work_date==='2026-11-24'&&x.manager_id===2),undefined)
assert.equal(rows().find(x=>x.work_date==='2026-11-26'&&x.manager_id===3).comment,'Оставить')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM team_attendance_marks').get().n,1,
 'Removing a shift must not delete recorded attendance')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM activity_log').get().n,1)

const after=rows()
await assert.rejects(
 ()=>saveTeamScheduleWeek(db,{start:'2026-11-23',changes:[
   build('2026-11-27',1,'add','18:00'),
   build('2026-11-23',1,'update','22:00','Несвежий редактор',updateBase),
 ]}),/изменился после открытия/,
 'A stale edit must reject the entire weekly batch, including unrelated additions')
assert.deepEqual(rows(),after,'A conflict must roll back all drafted day changes')
await assert.rejects(
 ()=>saveTeamScheduleWeek(db,{start:'2026-11-23',changes:[build('2026-11-23',2,'add','17:00')]}),
 /изменился после открытия/,'Lost-response retries must not duplicate an inserted shift')
assert.deepEqual(rows(),after)
await assert.rejects(
 ()=>saveTeamScheduleWeek(db,{start:'2026-11-23',changes:[build('2026-11-25',4,'add','18:00')]}),
 /недоступен/,'Former staff may not be assigned')
await assert.rejects(
 ()=>saveTeamScheduleWeek(db,{start:'2026-11-23',changes:[build('2026-11-25',5,'add','18:00')]}),
 /недоступен/,'Admin special employee may not be assigned')
await assert.rejects(
 ()=>saveTeamScheduleWeek(db,{start:'2026-11-23',changes:[build('2026-11-30',1,'add','18:00')]}),
 /неверные даты/,'Out-of-week day is forbidden')
await assert.rejects(
 ()=>saveTeamScheduleWeek(db,{start:'2026-11-23',changes:[
   build('2026-11-27',1,'add','18:00'),build('2026-11-27',1,'add','18:00')
 ]}),/дважды/)
await assert.rejects(
 ()=>saveTeamScheduleWeek(db,{start:'2026-11-23',changes:[build('2026-11-27',2,'add','25:70')]}),
 /время/)
assert.deepEqual(rows(),after,'Invalid requests never alter the database')

sql.prepare('INSERT INTO team_timesheet(work_date,manager_id,work_until,comment,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run('2026-11-30',1,'18:00','Перенос месяца','2026-11-01','2026-11-01')
sql.prepare('INSERT INTO team_timesheet(work_date,manager_id,work_until,comment,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run('2026-12-01',2,'19:00','Декабрь','2026-11-01','2026-11-01')
const boundary=await listTeamScheduleWeek(db,'2026-11-30')
assert.equal(boundary.entries.length,2,'A week across two months must include all 7 days')
const dec=boundary.entries.find(x=>x.date==='2026-12-01')
await saveTeamScheduleWeek(db,{start:'2026-11-30',changes:[
 build('2026-11-30',3,'add','18:00'),
 build('2026-12-01',2,'update','20:00','Декабрь изменён',dec),
]})
assert.equal(rows().find(x=>x.work_date==='2026-12-01'&&x.manager_id===2).work_until,'20:00')

const worker=readFileSync('worker/index.ts','utf8')
const ui=readFileSync('src/features/team/WeeklyScheduleEditor.tsx','utf8')
const shell=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
const css=readFileSync('src/features/team/weeklyScheduleEditor.css','utf8')
assert(worker.includes('canManageTeamSchedule(env.DB, authUser)')&&
 worker.includes("url.pathname === '/api/team/timesheet/week'"))
assert(ui.includes('tw-week-days')&&ui.includes('stageMassAdd')&&ui.includes('stageMassRemove')&&
 ui.includes('copyPrevious')&&ui.includes('saveWeek()')&&ui.includes('onDirtyChange'))
assert(shell.includes("view==='week'?<WeeklyScheduleEditor")&&shell.includes("view==='calendar'"))
assert(css.includes('@media(max-width:550px)'))
console.log('TEAM_WEEKLY_SCHEDULE_PASS: 7-day/month-boundary view, one atomic save, mixed operations, stale rollback, staff checks, attendance retention and mobile editor')

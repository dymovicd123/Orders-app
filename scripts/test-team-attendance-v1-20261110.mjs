import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { readTeamAttendance, saveTeamAttendance } from '../worker/domains/team-attendance.ts'

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec("CREATE TABLE managers (id INTEGER PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER,color_key TEXT)")
sql.exec("CREATE TABLE team_timesheet (id INTEGER PRIMARY KEY,work_date TEXT,manager_id INTEGER,work_until TEXT,comment TEXT,UNIQUE(work_date,manager_id))")
sql.exec("INSERT INTO managers VALUES (1,'Асия','Менеджер',1,'#228844'),(2,'Дана','Менеджер',1,'#BB5522'),(3,'Сымбат','Администратор',1,'#334455')")
const migration=readFileSync('migrations/0122_team_actual_attendance.sql','utf8')
sql.exec(migration);sql.exec(migration)
const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
const p=k=>parts.find(v=>v.type===k)?.value
const date=p('year')+'-'+p('month')+'-'+p('day')
const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1)
const future=next.toISOString().slice(0,10)
sql.prepare("INSERT INTO team_timesheet(work_date,manager_id,work_until,comment) VALUES(?,?,?,?)").run(date,1,'18:00','Смена')
sql.prepare("INSERT INTO team_timesheet(work_date,manager_id,work_until,comment) VALUES(?,?,?,?)").run(date,2,'19:00','')
sql.prepare("INSERT INTO team_timesheet(work_date,manager_id,work_until,comment) VALUES(?,?,?,?)").run(future,1,'18:00','')
const db={prepare(statement){return {bind(...args){return {
  async first(){return sql.prepare(statement).get(...args)||null},
  async all(){return {results:sql.prepare(statement).all(...args)}},
  async run(){const x=sql.prepare(statement).run(...args);return {meta:{changes:Number(x.changes),last_row_id:Number(x.lastInsertRowid)}}},
}}}}}
const admin={id:10,role:'admin'}
const manager={id:11,role:'manager'}
const mark=(managerId,status,finishedAt='',comment='',workDate=date,actor=admin)=>
  saveTeamAttendance(db,{date:workDate,managerId,status,finishedAt,comment},actor)
const month=date.slice(0,7)
assert.deepEqual(await readTeamAttendance(db,month),[])
assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM team_timesheet").get().count,3)
await assert.rejects(()=>mark(1,'present','','',date,manager),/администратор/)
await assert.rejects(()=>mark(3,'present'),/не найден|не участвует/)
await assert.rejects(()=>mark(1,'present','', '',future),/будущий/)
await assert.rejects(()=>mark(1,'unknown'),/состояние/)
await assert.rejects(()=>mark(1,'absent','18:00'),/только/)
await assert.rejects(()=>mark(1,'present','25:70'),/Время/)
await assert.rejects(()=>mark(99,'present'),/не найден/)
await mark(1,'present')
let records=await readTeamAttendance(db,month)
assert.equal(records.length,1)
assert.equal(records[0].status,'present')
assert.equal(records[0].finishedAt,'')
await mark(1,'present','17:45','Отпустили раньше')
records=await readTeamAttendance(db,month)
assert.equal(records[0].finishedAt,'17:45')
assert.equal(records[0].comment,'Отпустили раньше')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM team_attendance_marks").get().n,1)
await mark(2,'absent')
await mark(2,'excused','','Болел')
records=await readTeamAttendance(db,month)
assert.equal(records.length,2)
assert.equal(records.find(x=>x.managerId===2).status,'excused')
await assert.rejects(()=>mark(2,'unmarked','17:00'),/только/)
await mark(1,'unmarked','','',date,{id:12,role:'admin'})
records=await readTeamAttendance(db,month)
assert.deepEqual(records.map(x=>x.managerId),[2])
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM team_attendance_changes").get().n,5)
assert.equal(sql.prepare("SELECT actor_user_id AS actor FROM team_attendance_changes WHERE change_kind='cleared'").get().actor,12)
assert.deepEqual(sql.prepare("SELECT change_kind FROM team_attendance_changes ORDER BY id").all().map(x=>x.change_kind),
  ['created','updated','created','updated','cleared'])
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM team_timesheet").get().n,3,'Attendance must not change planned shifts')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='attendance_days'").get().n,0)
const section=readFileSync('src/features/sections/TeamSection.tsx','utf8')
const ui=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
assert.ok(section.includes('<TeamTimesheetWorkspace'))
assert.ok(ui.includes('Журнал по дням')&&ui.includes('Отметить явку')&&ui.includes('Пришёл')&&ui.includes('Не пришёл'))
assert.ok(ui.includes('Уважительная причина')&&ui.includes('Время ухода (необязательно)'))
assert.ok(ui.includes('Без отметки')&&ui.includes('Назначить смены'))
assert.ok(!ui.includes('Количество часов')&&!ui.includes('Часов отработано'))
console.log('TEAM_ATTENDANCE_V1_PASS: idempotent migration, admin permission, schedule independence, actual presence, optional leave time, absence reason, historic audit, monthly UI')

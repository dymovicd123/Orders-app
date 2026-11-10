import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { saveTeamTimesheet } from '../worker/domains/team.ts'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`
  CREATE TABLE managers (id INTEGER PRIMARY KEY, name TEXT, role TEXT, is_active INTEGER);
  CREATE TABLE team_timesheet (
    id INTEGER PRIMARY KEY, work_date TEXT, manager_id INTEGER, work_until TEXT,
    comment TEXT, created_at TEXT, updated_at TEXT, UNIQUE(work_date,manager_id)
  );
  CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY, event_type TEXT, entity_type TEXT, entity_id INTEGER,
    order_id INTEGER, external_order_id TEXT, title TEXT, details TEXT, amount INTEGER,
    created_at TEXT
  );
  INSERT INTO managers VALUES
    (1,'Асия','Менеджер',1),(2,'Айым','Менеджер',1),
    (3,'Айторы','Менеджер',1),(4,'Сымбат','Администратор',1);
  INSERT INTO team_timesheet(work_date,manager_id,work_until,comment,created_at,updated_at)
  VALUES
    ('2026-11-10',1,'18:00','Старый комментарий','2026-11-01','2026-11-01'),
    ('2026-11-10',2,'19:00','Другой сотрудник','2026-11-01','2026-11-01'),
    ('2026-11-11',1,'17:30','Вторая дата','2026-11-01','2026-11-01');
`)
const db={prepare(query){
  const bound=(args=[])=>({
    async all(){return {results:sqlite.prepare(query).all(...args)}},
    async first(){return sqlite.prepare(query).get(...args)||null},
    async run(){const r=sqlite.prepare(query).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
  })
  return {...bound(),bind(...args){return bound(args)}}
}}
const shifts=()=>sqlite.prepare('SELECT work_date,manager_id,work_until,comment,created_at,updated_at FROM team_timesheet ORDER BY work_date,manager_id').all()
const original=shifts()
await saveTeamTimesheet(db,{dates:['2026-11-10','2026-11-11'],managerIds:[1,3],
  workUntil:'20:00',comment:'Только новым',preserveExisting:true})
let rows=shifts()
assert.equal(rows.length,5,'Only two missing employee/day pairs should be added')
for(const before of original){
  assert.deepEqual(rows.find(v=>v.work_date===before.work_date&&v.manager_id===before.manager_id),before,
    'Bulk addition must not edit existing shift metadata or timestamps')
}
assert.equal(rows.find(v=>v.work_date==='2026-11-10'&&v.manager_id===3).work_until,'20:00')
await saveTeamTimesheet(db,{dates:['2026-11-10','2026-11-11'],managerIds:[1,3],
  workUntil:'21:00',comment:'Повтор',preserveExisting:true})
assert.deepEqual(shifts(),rows,'Repeated bulk addition must be idempotent')
await saveTeamTimesheet(db,{dates:['2026-11-10'],managerIds:[1],
  workUntil:'16:00',comment:'Изменили конкретную смену',clear:false})
rows=shifts()
assert.equal(rows.find(v=>v.work_date==='2026-11-10'&&v.manager_id===1).work_until,'16:00')
assert.equal(rows.find(v=>v.work_date==='2026-11-11'&&v.manager_id===1).work_until,'17:30')
assert.equal(rows.find(v=>v.work_date==='2026-11-10'&&v.manager_id===2).work_until,'19:00')
await saveTeamTimesheet(db,{dates:['2026-11-10'],managerIds:[3],clear:true})
rows=shifts()
assert.equal(rows.length,4,'Removing one employee/day must not remove other shifts')
assert.equal(rows.find(v=>v.work_date==='2026-11-10'&&v.manager_id===3),undefined)
const ui=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
const css=readFileSync('src/features/team/teamTimesheetWorkspace.css','utf8')
assert.ok(ui.includes('preserveExisting:!clear'),'Bulk planner must use insert-only mode')
assert.ok(ui.includes('tw-calendar-shift')&&ui.includes('shift.manager')&&ui.includes('shift.workUntil'))
assert.ok(ui.includes('tw-plan-snapshot')&&ui.includes('tw-already-chip'),
  'Planner must reveal existing assignments before saving')
assert.ok(ui.includes('openPlannerForDate(date)')&&ui.includes('openShiftEditor(shift)'),
  'Single-day additions and exact shift editing must remain available')
assert.ok(ui.includes('duplicateAssignments')&&ui.includes('newAssignments'))
assert.ok(css.includes('.tw-calendar-detail')&&css.includes('.tw-plan-snapshot'))
console.log('TEAM_TIMESHEET_BULK_SAFE_PASS: add-only, repeat idempotence, scoped edits/removal, visible existing shifts')

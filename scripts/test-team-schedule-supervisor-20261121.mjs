import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { canManageTeamSchedule } from '../worker/domains/team-schedule-access.ts'
import { saveTeamTimesheet } from '../worker/domains/team.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`
  CREATE TABLE managers (id INTEGER PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
  CREATE TABLE team_timesheet (
    id INTEGER PRIMARY KEY,work_date TEXT,manager_id INTEGER,work_until TEXT,
    comment TEXT,created_at TEXT,updated_at TEXT,UNIQUE(work_date,manager_id)
  );
  CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id INTEGER,
    order_id INTEGER,external_order_id TEXT,title TEXT,details TEXT,amount INTEGER,created_at TEXT
  );
  INSERT INTO managers VALUES
    (1,'Завсклад','Завсклад',1),(2,'Менеджер','Менеджер',1),
    (3,'Бывший завсклад','Завсклад',0),(4,'Упаковщик','Упаковщик',1),
    (5,'Сымбат','Администратор',1);
  INSERT INTO team_timesheet(work_date,manager_id,work_until,comment)
    VALUES('2026-11-25',2,'18:00','Уже назначено');
`)
const db={prepare(sql){
  const make=(args=[])=>({
    async first(){return sqlite.prepare(sql).get(...args)||null},
    async all(){return {results:sqlite.prepare(sql).all(...args)}},
    async run(){const row=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(row.changes)}}},
  })
  return {...make(),bind(...args){return make(args)}}
}}
const actor=(managerId,employeeRole='Завсклад',role='manager')=>
  ({id:10,role,managerId,employeeRole})
assert.equal(await canManageTeamSchedule(db,{id:9,role:'admin',managerId:null}),true)
assert.equal(await canManageTeamSchedule(db,actor(1)),true)
assert.equal(await canManageTeamSchedule(db,actor(2,'Менеджер')),false)
assert.equal(await canManageTeamSchedule(db,actor(2,'Завсклад')),false,
  'Forged/stale job title cannot grant permission without matching active employee')
assert.equal(await canManageTeamSchedule(db,actor(3)),false,
  'A dismissed supervisor may not edit shifts')
assert.equal(await canManageTeamSchedule(db,actor(4,'Упаковщик')),false)
assert.equal(await canManageTeamSchedule(db,actor(null)),false)
assert.equal(await canManageTeamSchedule(db,actor(1,'Завсклад','viewer')),false)
assert.equal(await canManageTeamSchedule(db,{...actor(1),mustChangePassword:true}),false)
assert.equal(await canManageTeamSchedule(db,null),false)

const shifts=()=>sqlite.prepare('SELECT work_date,manager_id,work_until,comment FROM team_timesheet ORDER BY work_date,manager_id').all()
const original=shifts()
assert.equal((await canManageTeamSchedule(db,actor(1))),true)
await saveTeamTimesheet(db,{dates:['2026-11-25','2026-11-26'],managerIds:[1,2],
  workUntil:'20:00',comment:'Завсклад',preserveExisting:true})
assert.equal(shifts().length,4)
assert.deepEqual(shifts().find(x=>x.manager_id===2&&x.work_date==='2026-11-25'),original[0],
  'Supervisors must not overwrite a pre-existing employee shift during bulk add')
await saveTeamTimesheet(db,{dates:['2026-11-25'],managerIds:[1],
  workUntil:'21:00',comment:'Точное изменение'})
assert.equal(shifts().find(x=>x.manager_id===1&&x.work_date==='2026-11-25').work_until,'21:00')
await saveTeamTimesheet(db,{dates:['2026-11-25'],managerIds:[1],clear:true})
assert.equal(shifts().find(x=>x.manager_id===1&&x.work_date==='2026-11-25'),undefined)
assert.deepEqual(shifts().find(x=>x.manager_id===2&&x.work_date==='2026-11-25'),original[0])
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activity_log').get().n,3)

const worker=readFileSync('worker/index.ts','utf8')
const section=readFileSync('src/features/sections/TeamSection.tsx','utf8')
const workspace=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
assert.ok(worker.includes('if (!await canManageTeamSchedule(env.DB, authUser))'),
  'Authenticated schedule POST must enforce the scoped server permission')
assert.ok(section.includes("canManageSchedule={isAdmin || (authUser?.role === 'manager'"),
  'The supervisor must see the same existing planner as admin')
assert.ok(section.includes("authUser.employeeRole === 'Завсклад'"))
assert.ok(workspace.includes('const canEditSchedule=isAdmin||canManageSchedule'))
assert.ok(workspace.includes('!canEditSchedule||busy.current'))
assert.ok(section.includes('{isAdmin ?')&&section.includes('saveTeamEmployee'),
  'The schedule permission must not grant employee management')
assert.ok(workspace.includes('preserveExisting:!clear'),
  'Supervisor bulk planning must preserve existing shifts')
console.log('TEAM_SCHEDULE_SUPERVISOR_PASS: active validated role, denied manager/packer/former, scoped schedule writes, existing shifts retained')

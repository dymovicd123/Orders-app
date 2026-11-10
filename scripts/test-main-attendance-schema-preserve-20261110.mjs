import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

const db=new DatabaseSync(':memory:')
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE managers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, is_active INTEGER);
CREATE TABLE team_timesheet (
 id INTEGER PRIMARY KEY,work_date TEXT NOT NULL,manager_id INTEGER NOT NULL,
 work_until TEXT,comment TEXT,created_at TEXT,updated_at TEXT,
 UNIQUE(work_date,manager_id)
);
INSERT INTO managers(id,name,role,is_active) VALUES(11,'Тестовый менеджер','Менеджер',1);
INSERT INTO team_timesheet VALUES
 (7,'2026-11-10',11,'18:00','Не менять','2026-11-01','2026-11-01'),
 (8,'2026-11-11',11,'19:00','График','2026-11-01','2026-11-01');
`)
const snapshot=()=>db.prepare('SELECT * FROM team_timesheet ORDER BY id').all()
const before=snapshot()
const migration=readFileSync('migrations/0122_team_actual_attendance.sql','utf8')
assert.ok(!/^\s*(?:UPDATE|DELETE|DROP|ALTER|REPLACE|TRUNCATE)\b/im.test(migration),
 'Schema must not edit existing production schedule data')
db.exec(migration)
db.exec(migration)
assert.deepEqual(snapshot(),before,'Current assigned shifts must remain byte-for-byte unchanged')
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('team_attendance_marks','team_attendance_changes')").get().n,2)
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'team_attendance_audit_%'").get().n,3)
assert.equal(db.prepare('SELECT count(*) AS n FROM team_attendance_marks').get().n,0)
db.prepare(`INSERT INTO team_attendance_marks(work_date,manager_id,status,finished_at,comment,created_at,updated_at,updated_by_user_id)
VALUES(?,?,?,?,?,?,?,?)`).run('2026-11-10',11,'present',null,'','2026-11-10','2026-11-10',22)
assert.equal(db.prepare('SELECT count(*) AS n FROM team_attendance_changes').get().n,1)
assert.deepEqual(snapshot(),before,'Attendance writes must not alter existing planned shifts')
console.log('MAIN_ATTENDANCE_ADDITIVE_SCHEMA_PRESERVES_SCHEDULE_PASS')

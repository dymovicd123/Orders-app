import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read=path=>readFileSync(path,'utf8')
const ui=read('src/features/team/TeamTimesheetWorkspace.tsx')
const section=read('src/features/sections/TeamSection.tsx')
const app=read('src/App.tsx')
const worker=read('worker/index.ts')
const domain=read('worker/domains/team-attendance.ts')
const css=read('src/features/team/teamTimesheetWorkspace.css')

// A new onClose closure on each keystroke must not re-run dialog focus setup.
assert.ok(ui.includes('const closeRef=useRef(onClose)'))
assert.ok(ui.includes('closeRef.current=onClose'))
assert.ok(ui.includes("if(e.key==='Escape'){e.preventDefault();closeRef.current()}"))
assert.ok(ui.includes('  },[])'), 'Dialog focus effect must only run on mount')
assert.ok(ui.includes('firstField||items().find'), 'Dialog should focus its editor, not the X button')

// Attendance is a manager job, not an administrator-only action.
assert.ok(app.includes('askActionConfirmation, authUser, authUsers'))
assert.ok(section.includes('canMarkAttendance={isAdmin || (authUser?.role'))
assert.ok(ui.includes('canMarkAttendance&&date<=current'))
assert.ok(!worker.includes("requireAdminUser(authUser, 'Только администратор может отмечать явку.')"))
assert.ok(domain.includes("actor.role!=='manager'"))
assert.ok(domain.includes('SELECT id,role,is_active FROM managers WHERE id=?'))
assert.ok(domain.includes('updated_by_user_id'), 'Audit actor must remain preserved')

// The UI must react before the network call and refresh without blocking the row.
const update=ui.indexOf('setOptimisticMarks(previous=>({...previous,[key]:nextMark}))')
const network=ui.indexOf("const response=await apiFetch('/api/team/attendance'")
assert.ok(update>=0&&network>update,'Show chosen attendance immediately')
assert.ok(ui.includes('markingRef.current.has(key)')&&ui.includes('pendingMarks[date+\':\'+row.id]'),
  'Only concurrent edits to the same employee/day should be blocked')
assert.ok(ui.includes('void loadTeamTimesheet(date.slice(0,7)).catch(()=>{})'),
  'Attendance refresh must not hold up interaction')
assert.ok(ui.includes('setMarkErrors(previous=>'), 'Failed saves must be made visible')

// Single click for presence/absence/excuse and one tap for today's real departure.
assert.ok(ui.includes("record(row,'present')")&&ui.includes("record(row,'absent')"))
assert.ok(ui.includes("record(row,'excused')"))
assert.ok(ui.includes("record(row,'present',currentDepartureTime(),row.mark?.comment||'')"))
assert.ok(ui.includes("timeZone:'Asia/Almaty'"))
assert.ok(css.includes('.tw-quick.departed')&&css.includes('.tw-quick.excused'))
console.log('TEAM_ATTENDANCE_MANAGER_UX_PASS: dialog focus stability, manager role, optimistic per-row save and instant departure')

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(p,'utf8')
const section=read('src/features/sections/TeamSection.tsx')
const editor=read('src/features/team/TeamTimesheetWorkspace.tsx')
const week=read('src/features/team/WeeklyScheduleEditor.tsx')
const access=read('worker/domains/team-schedule-access.ts')
const handler=read('worker/index.ts')
const auth=read('worker/domains/team-attendance.ts')
const team=read('worker/domains/team.ts')
const app=read('src/App.tsx')
const types=read('src/app/types.ts')
const wrapper=section.slice(section.indexOf('if (!isAdmin) return ('),section.indexOf('  return (\n    <article',section.indexOf('if (!isAdmin) return (')))
assert(wrapper.includes('<TeamTimesheetWorkspace')&&wrapper.includes('isAdmin={false}'),
  'Main manager-only Team view must remain a restricted attendance workspace')
assert(wrapper.includes("canManageSchedule={isAdmin || (authUser?.role === 'manager'")&&
  wrapper.includes("authUser.employeeRole === 'Завсклад'")&&
  wrapper.includes('canMarkAttendance='),
  'Main supervisor must have graph edit control while existing attendance controls remain')
assert(section.includes("teamMode === 'salary'")&&section.includes("teamMode === 'employees'")&&
  section.includes('saveTeamEmployeeAccess')&&section.includes('disableTeamEmployeeAccess'),
  'Main administrator employee/account/salary features must remain unchanged')
assert(editor.includes('isAdmin||canManageSchedule')&&
  editor.includes("view==='week'?<WeeklyScheduleEditor")&&
  week.includes('WeekAutosaveQueue')&&week.includes('Добавить и сохранить'),
  'Main supervisor should use the Branch2 reviewed per-action weekly editor')
assert(access.includes("actor.role==='admin'")&&
  access.includes("actor.employeeRole!=='Завсклад'")&&
  access.includes('Number(person?.is_active)===1'),
  'Server must check active supervisor against live D1 employee role')
assert(handler.includes("url.pathname === '/api/team/timesheet/week'")&&
  handler.includes('canManageTeamSchedule(env.DB, authUser)')&&
  handler.includes('const input = await readJson<TimesheetInput>(request)'),
  'Both new and legacy schedule POST paths must enforce supervisor rights')
assert(auth.includes("actor.role!=='manager'"),
  'Schedule permissions must not expand attendance write rights')
assert(team.includes('preserveExisting')&&
  team.includes('team_timesheet'),
  'Preserve original schedule schema and protected mass assignment')
assert(types.includes('createdAt?: string')&&types.includes('updatedAt?: string'),
  'Row versions must be typed for optimistic concurrency')
assert(app.includes("module.id === 'team' && !isAdmin ? 'Посещаемость'"),
  'Main-only manager sidebar/permission policy must remain unchanged')
assert(!week.includes('Сохранить график'),
  'Do not restore the old week-level save button')
console.log('MAIN_TIMESHEET_AUTOSAVE_PORT_PASS: nonadmin supervisor planner, Main restricted account panel, server ACL, no salary/account scope changes')

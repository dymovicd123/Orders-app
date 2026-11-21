import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const editor=readFileSync('src/features/team/WeeklyScheduleEditor.tsx','utf8')
const shell=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
const weeklyCss=readFileSync('src/features/team/weeklyScheduleEditor.css','utf8')
const monthCss=readFileSync('src/features/team/teamTimesheetWorkspace.css','utf8')
const worker=readFileSync('worker/index.ts','utf8')
assert.ok(editor.includes("start:stepDate(weekStart,-7)")&&
 editor.includes("start:stepDate(weekStart,7)")&&
 editor.includes("Перейти к неделе по дате")&&editor.includes("weekMonday(localToday())"),
 'Week navigation must include preceding and future dates and return to current week')
assert.ok(editor.includes('requestDestination({kind:')&&
 editor.includes('setPendingTarget(destination)')&&
 editor.includes('setWeekStart(destination.start)'),
 'Navigation must await pending saves without accidentally discarding a shift')
assert.ok(editor.includes('Переход к другой странице ожидает завершения сохранения')&&
 editor.includes('queue.state.pending.length||queue.state.saving||queue.state.error'),
 'Week transition must not bypass queued changes or a server error')
assert.ok(editor.includes("window.addEventListener('beforeunload',protect)")&&
 editor.includes("window.removeEventListener('beforeunload',protect)"),
 'Browser reload must warn about pending autosave or edits')
assert.ok(editor.includes('tw-week-autosave')&&
 editor.includes('Все изменения сохранены')&&editor.includes('Сохраняется')&&
 editor.includes('Обновить и повторить'),
 'Status must distinguish saving, saved and failures')
assert.ok(weeklyCss.includes('.tw-week-autosave.failed'))
assert.ok(editor.includes('Подтвердить снятие')&&
 editor.includes('setConfirmRemove(intents)'),'Mass removal must require confirmation')
assert.ok(shell.includes('const [weekAnchor,setWeekAnchor]=useState(current)')&&
 shell.includes('onWeekChange={setWeekAnchor}')&&shell.includes('initialDate={weekAnchor}'),
 'Returning from the month overview must preserve the selected week')
assert.ok(shell.includes('Вернуться к недельному графику')&&
 shell.includes('onClick={()=>openWeekForDate(d)}')&&
 shell.includes('onClick={()=>openWeekForDate(day)}'),
 'Month overview remains read-only and both platforms return to weekly editor')
assert.ok(monthCss.includes('.tw-month-overview-guide'))
assert.ok(worker.includes("url.pathname === '/api/team/timesheet/week'")&&
 worker.includes('canManageTeamSchedule(env.DB, authUser)'),
 'Admin/active supervisor access must remain server-enforced')
console.log('TEAM_WEEKLY_NAVIGATION_SAVE_PASS: autosave pending protection, future weeks, read-only month and scoped role')

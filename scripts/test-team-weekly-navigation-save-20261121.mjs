import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const editor=readFileSync('src/features/team/WeeklyScheduleEditor.tsx','utf8')
const shell=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
const weeklyCss=readFileSync('src/features/team/weeklyScheduleEditor.css','utf8')
const monthCss=readFileSync('src/features/team/teamTimesheetWorkspace.css','utf8')
const worker=readFileSync('worker/index.ts','utf8')

assert.ok(editor.includes("onClick={()=>moveWeek(-1)}")&&editor.includes("onClick={()=>moveWeek(1)}")&&
  editor.includes("Перейти к неделе по дате")&&editor.includes("weekMonday(localToday())"),
  'Week navigation must allow previous, next, arbitrary date and present-day shortcuts')
assert.ok(editor.includes('requestDestination({kind:')&&
  editor.includes('setPendingTarget(destination)')&&
  editor.includes('setWeekStart(destination.start)'),
  'Dates must navigate even across month boundaries, with a pending action for unsaved work')
assert.ok(editor.includes('Сохранить и перейти')&&editor.includes('Не сохранять и перейти')&&
  editor.includes('Остаться')&&editor.includes('saveWeek(pendingTarget)'),
  'Dirty navigation needs a visible, actionable save/discard/stay choice')
assert.ok(editor.includes("window.addEventListener('beforeunload',protect)")&&
  editor.includes("window.removeEventListener('beforeunload',protect)"),
  'Leaving/reloading the page must warn about an unsaved week')
assert.ok(editor.includes("tw-week-savebar'+(dirty?' dirty':'')")&&
  editor.includes("'Сохранить '+edits.length+' изменений'"),
  'The saving affordance must show exactly how many changes remain unsaved')
assert.ok(weeklyCss.includes('.tw-week-savebar.dirty')&&
  weeklyCss.includes('.tw-week-savebar{top:8px;bottom:auto')&&
  weeklyCss.lastIndexOf('.tw-week-savebar{top:8px;bottom:auto')>
  weeklyCss.indexOf('position:sticky;bottom:0'),
  'Dirty savebar should remain visually prominent at the top rather than only below long lists')
assert.ok(editor.includes("if(after)applyDestination(after)")&&
  editor.includes('if(weekRef.current===requestedWeek)setSnapshot(latest)'),
  'Post-save background fetch must not replace a newly navigated week')
assert.ok(editor.includes('Будут сняты')&&
  editor.includes('saveWeek(pendingTarget||undefined)'),
  'Confirming removed shifts must still work before any pending navigation')
assert.ok(shell.includes('const [weekAnchor,setWeekAnchor]=useState(current)')&&
  shell.includes('onWeekChange={setWeekAnchor}')&&
  shell.includes('initialDate={weekAnchor}'),
  'The month view must preserve the last chosen week for the return trip')
assert.ok(shell.includes('Вернуться к недельному графику')&&
  shell.includes('onClick={()=>openWeekForDate(d)}')&&
  shell.includes('onClick={()=>openWeekForDate(day)}'),
  'Desktop/mobile month overview must return to selected week for edits rather than open a second editor')
assert.ok(monthCss.includes('.tw-month-overview-guide'),
  'Clear week-return action must also be visible on mobile')
assert.ok(worker.includes("url.pathname === '/api/team/timesheet/week'")&&
  worker.includes('canManageTeamSchedule(env.DB, authUser)'),
  'All weekly writes must retain admin/active warehouse-supervisor permission')
console.log('TEAM_WEEKLY_NAVIGATION_SAVE_PASS: visible sticky save, safe dirty navigation, future dates, read-only month, cross-view return and permissions')

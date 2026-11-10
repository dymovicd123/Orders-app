import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read=path=>readFileSync(path,'utf8')
const ui=read('src/features/team/TeamTimesheetWorkspace.tsx')
const report=read('src/features/team/TeamAttendanceReport.tsx')
const css=read('src/features/team/teamTimesheetWorkspace.css')

assert.ok(ui.includes('className="tw-dialog-head"')&&css.includes('position:sticky;top:-20px'),
  'Close button must remain visible while the dialog scrolls')
assert.ok(ui.includes('aria-label="Закрыть окно"')&&ui.includes('<span>Закрыть</span>'),
  'Closing the planner should be clearly labeled, not a tiny X')
assert.ok(ui.includes('className="tw-plan-footer-left"')&&ui.includes('onClick={closePlan} disabled={saving}>Закрыть'),
  'Bulk planner must also close directly from its actions row')
assert.ok(ui.includes('<details className="tw-plan-snapshot">'),
  'Existing assignments must be available without making the default form longer')
assert.ok(ui.includes('tw-plan-snapshot-days')&&ui.includes('[...planDates].sort().map(d=>'),
  'Open preview must show every selected date, not silently truncate it')
assert.ok(ui.includes('tw-calendar-mobile')&&ui.includes('tw-mobile-schedule-day'))
assert.ok(ui.includes('setShowEmptyCalendarDays(previous=>!previous)'),
  'Mobile calendar must allow picking previously empty dates')
assert.ok(ui.includes("||(data?.attendance||[]).some(mark=>mark.date===day)"),
  'Calendar cannot hide historical attendance when a shift was later removed')
assert.ok(report.includes('tw-report-mobile-days')&&report.includes('tw-report-mobile-person'),
  'Attendance history must render day-and-person mobile rows')
assert.ok(report.includes('<ReportCell cell={day.cells.get(person.id)}/>'),
  'Mobile report must use the same source-of-truth status and actual departure as desktop')
assert.ok(report.includes('onClick={()=>onOpenDay(day.date)}'),
  'Tapping a report day must open actual attendance for that date')
assert.ok(css.includes('.tw-report-table-scroll{display:none}')&&css.includes('.tw-calendar-scroll{display:none}'),
  'A narrow device must not be forced to pan a full-width monthly table or calendar')
assert.ok(css.includes('.tw-report-mobile-days{display:grid')&&css.includes('.tw-calendar-mobile{display:grid'),
  'Responsive views must be visible')
assert.ok(css.includes('@media(max-width:370px)')&&css.includes('@media(max-width:550px)'),
  'Small phones need dedicated breakpoints')
assert.ok(!ui.includes('window.confirm(')&&!ui.includes('window.prompt('))
console.log('TEAM_TIMESHEET_MOBILE_UX_PASS: accessible close, shorter planner, mobile calendar/report, old attendance retention, narrow breakpoints')

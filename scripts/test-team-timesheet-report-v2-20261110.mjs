import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAttendanceReport } from '../src/features/team/teamTimesheetReport.ts'

const data={
  ok:true,month:'2026-11',startDate:'2026-11-01',endDate:'2026-11-30',
  employees:[
    {id:1,name:'Асия',role:'Менеджер',isActive:true,colorKey:'#31826b'},
    {id:2,name:'Дана',role:'Менеджер',isActive:true,colorKey:'#bc5947'},
    {id:3,name:'Айторі',role:'Менеджер',isActive:true,colorKey:'#607fa8'},
  ],
  entries:[
    {id:1,date:'2026-11-09',managerId:1,manager:'Асия',workUntil:'18:00',comment:''},
    {id:2,date:'2026-11-09',managerId:2,manager:'Дана',workUntil:'19:00',comment:''},
    {id:3,date:'2026-11-10',managerId:1,manager:'Асия',workUntil:'18:00',comment:''},
    {id:4,date:'2026-11-10',managerId:2,manager:'Дана',workUntil:'18:00',comment:''},
    {id:5,date:'2026-11-11',managerId:2,manager:'Дана',workUntil:'18:00',comment:''},
  ],
  attendance:[
    {id:1,date:'2026-11-09',managerId:1,manager:'Асия',status:'present',finishedAt:'17:35',comment:'Отпустили раньше',updatedAt:'2026-11-09T18:00:00Z'},
    {id:2,date:'2026-11-09',managerId:2,manager:'Дана',status:'absent',finishedAt:'',comment:'',updatedAt:'2026-11-09T18:00:00Z'},
    {id:3,date:'2026-11-10',managerId:1,manager:'Асия',status:'present',finishedAt:'',comment:'',updatedAt:'2026-11-10T18:00:00Z'},
    {id:4,date:'2026-11-08',managerId:3,manager:'Айторі',status:'excused',finishedAt:'',comment:'Плохо себя чувствовал',updatedAt:'2026-11-08T12:00:00Z'},
  ]
}
const result=buildAttendanceReport(data,'2026-11-10')
assert.deepEqual(result.people.map(x=>x.name),['Айторі','Асия','Дана'])
assert.deepEqual(result.days.map(x=>x.date),['2026-11-11','2026-11-10','2026-11-09','2026-11-08'])
assert.deepEqual(result.totals,{scheduled:5,present:2,absent:1,excused:1,pending:1,finished:1})
const today=result.days.find(x=>x.date==='2026-11-10')
assert.equal(today.cells.get(1).kind,'present')
assert.equal(today.cells.get(1).label,'Пришёл · уход не указан')
assert.equal(today.cells.get(2).kind,'pending')
assert.equal(today.pending,1)
const yesterday=result.days.find(x=>x.date==='2026-11-09')
assert.equal(yesterday.cells.get(1).finishedAt,'17:35')
assert.equal(yesterday.cells.get(1).label,'Пришёл · ушёл в 17:35')
assert.equal(yesterday.cells.get(1).schedule.workUntil,'18:00','Plan must not override actual finish')
assert.equal(yesterday.cells.get(2).kind,'absent')
const future=result.days.find(x=>x.date==='2026-11-11')
assert.equal(future.cells.get(2).kind,'future','Future scheduled shift is not absence or missing mark')
assert.equal(future.pending,0)
const excused=result.days.find(x=>x.date==='2026-11-08')
assert.equal(excused.cells.get(3).kind,'excused','Existing mark must remain after shift is removed')
assert.equal(excused.cells.get(3).schedule,undefined)
const empty=buildAttendanceReport({...data,employees:[],entries:[],attendance:[]},'2026-11-10')
assert.deepEqual(empty.days,[])
assert.equal(empty.totals.pending,0)
const ui=readFileSync('src/features/team/TeamTimesheetWorkspace.tsx','utf8')
const reportUi=readFileSync('src/features/team/TeamAttendanceReport.tsx','utf8')
const css=readFileSync('src/features/team/teamTimesheetWorkspace.css','utf8')
assert.ok(ui.includes('Отметить явку')&&ui.includes('Журнал по дням')&&ui.includes('График'))
assert.ok(ui.includes('tw-date-strip')&&ui.includes('tw-needs-attention'))
assert.ok(ui.includes('unmarkedDays[0][0]'),'Oldest unmarked date must be one click away')
assert.ok(ui.includes("view==='day'")&&ui.includes('const selectMonth='))
assert.ok(ui.includes("setPlanDates(days.filter(d=>weekday(d)>0&&weekday(d)<6))"))
assert.ok(ui.includes("['Пн','Вт','Ср','Чт','Пт','Сб','Вс']"),'Planner calendar must label weekdays')
assert.ok(ui.includes("(weekday(days[0])+6)%7"),'Planner must pad month to correct weekday')
assert.ok(ui.includes('duplicateAssignments'),'Overwriting existing shifts must warn first')
assert.ok(reportUi.includes('Ушёл в')&&reportUi.includes('Уход не указан'))
assert.ok(reportUi.includes('Фильтр по сотруднику')&&reportUi.includes('Только даты без отметок'))
assert.ok(reportUi.includes('onOpenDay(day.date)'),'Report date must open daily editor')
assert.ok(css.includes('.tw-report-table')&&css.includes('.tw-primary-assign'))
assert.ok(!ui.includes('Подсчёт часов')&&!reportUi.includes('Отработано часов'))
console.log('TEAM_TIMESHEET_REPORT_V2_PASS: actual departures per date, plan/fact separated, missing/future logic, jump to day, readable planning and report')

import assert from 'node:assert/strict'
import React from 'react'
import fs from 'node:fs'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const source=p=>fs.readFileSync(p,'utf8')
const create=source('src/features/client3/WatchOrderForm.tsx')
const serverCreate=source('worker/domains/client3-watch-create.ts')
const editor=source('src/features/client3/WatchOrderCorrections.tsx')
const time=source('src/features/client3/WatchTimesheetWorkspace.tsx')
const parent=source('src/features/client3/WatchTeamMainPanel.tsx')
for(const x of [
 'Дата оплаты *',"setPayments(rows=>rows.map((p,i)=>i===0||!p.dateCustomized",
 'readOnly={index===0}','paymentDate:x.paymentDate',
 'paymentDate:orderDate,dateCustomized:false','row.paymentDate===orderDate',
])assert(create.includes(x),'Payment auto-sync must have '+x)
for(const x of [
 'WATCH_PRIMARY_PAYMENT_DATE_MISMATCH','WATCH_PAYMENT_DATE_INVALID',
 'paymentDate:row.paymentDate===undefined?orderDate:row.paymentDate'
])assert(serverCreate.includes(x),'Explicit payment dates must be checked and sent through Main: '+x)
assert(serverCreate.includes("date>today"),'Future payments must be rejected')
for(const x of ["submit(event,'metadata')","submit(event,'watch')","submit(event,'prices')",
 'watch-editor-unified','Изменить состав товаров','WatchAdminOrderActions',
 'WatchAdminCompositionEditor'
])assert(editor.includes(x),'Unified editor is missing '+x)
assert(!editor.includes('watch-corrections-tabs'))
assert(parent.includes('<WatchTimesheetWorkspace')&&!parent.includes('team-timesheet-days'))
const vite=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true},logLevel:'error'})
try{
 const {watchTimesheetCalendarSlots,WatchTimesheetWorkspace}=await vite.ssrLoadModule('/src/features/client3/WatchTimesheetWorkspace.tsx')
 const november=watchTimesheetCalendarSlots('2026-11')
 assert.equal(november.length,36,'Nov 2026 starts on Sunday and has 30 days')
 assert.equal(november[0],null)
 assert.equal(november[5],null)
 assert.equal(november[6],'2026-11-01')
 assert.equal(november.at(-1),'2026-11-30')
 assert.equal(watchTimesheetCalendarSlots('bad').length,0)
 const props={
  month:'2026-11',onMonthChange:()=>{},
  employees:[{id:21,name:'АДИНА ТАУ'},{id:31,name:'ЛОГИСТ'}],
  entries:[{id:1,date:'2026-11-05',managerId:21,workUntil:'19:00',comment:'Смена'},
   {id:2,date:'2026-11-05',managerId:31,workUntil:'18:00',comment:'Помощь'},
   {id:3,date:'2026-11-06',managerId:0,workUntil:'19:00',comment:'old placeholder'}],
  selectedDays:['2026-11-05'],selectedManagers:[21],workUntil:'19:00',
  setSelectedDays:()=>{},setSelectedManagers:()=>{},setWorkUntil:()=>{},setComment:()=>{},
  comment:'',saving:false,onSave:()=>{},onClear:()=>{},
 }
 const html=renderToStaticMarkup(React.createElement(WatchTimesheetWorkspace,props))
 for(const word of ['Рабочий календарь команды','Будни','Выходные','Чётные','Нечётные',
  'АДИНА ТАУ','ЛОГИСТ','19:00','18:00','Назначить выбранное','Показать список всех назначений']){
  assert(html.includes(word),'Timesheet calendar misses '+word)
 }
 assert(!html.includes('old placeholder'),'Old blank/unknown manager records should not be shown')
 assert(html.includes('aria-pressed="true"'),'Selected days should be apparent')
 assert((html.match(/class="watch-ts-day/g)||[]).length>=30)
 const {WatchOrderForm}=await vite.ssrLoadModule('/src/features/client3/WatchOrderForm.tsx')
 const orderHTML=renderToStaticMarkup(React.createElement(WatchOrderForm,{
  allowedBrands:['TAUWACH','WACHIZEN'],catalog:[],deliveryMethods:['Курьер'],paymentMethods:['Наличные','Kaspi'],
  onSave:async()=>{},references:{movements:[],bracelets:[],dials:[],leatherColors:[],cities:[]},
 }))
 assert(orderHTML.includes('Дата оплаты *'),'Payment date must be visible in new orders')
 assert(orderHTML.includes('Совпадает с датой заказа автоматически'))
 console.log('CLIENT3_QA_PAYMENT_DATE_EDITOR_CALENDAR_PASS')
}finally{await vite.close()}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
const source=p=>fs.readFileSync(p,'utf8')
const form=source('src/features/client3/WatchOrderForm.tsx')
const server=source('worker/domains/client3-watch-create.ts')
const team=source('src/features/client3/WatchTeamMainPanel.tsx')
for(const token of [
 'Дата оплаты *',
 'setPayments(rows=>rows.map((p,i)=>i===0||!p.dateCustomized',
 'readOnly={index===0}',
 'paymentDate:x.paymentDate',
 'paymentDate:orderDate,dateCustomized:false',
 'row.paymentDate===orderDate',
])assert(form.includes(token),'Expected payment date synchronization: '+token)
for(const token of [
 'WATCH_PRIMARY_PAYMENT_DATE_MISMATCH','WATCH_PAYMENT_DATE_INVALID',
 'paymentDate:row.paymentDate===undefined?orderDate:row.paymentDate',
 'date>today',
])assert(server.includes(token),'Server payment-date guard missing '+token)
assert(!team.includes('WatchTimesheetWorkspace')&&team.includes('team-timesheet-days'),
 'Legacy timesheet must remain unchanged on original Client3')
const vite=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {WatchOrderForm}=await vite.ssrLoadModule('/src/features/client3/WatchOrderForm.tsx')
 const html=renderToStaticMarkup(React.createElement(WatchOrderForm,{
   allowedBrands:['TAUWACH','WACHIZEN'],isAdmin:true,catalog:[],managers:[],
   deliveryMethods:['КАЗПОЧТА'],paymentMethods:['KASPI GOLD'],
   onSave:async()=>{},references:{movements:[],bracelets:[],dials:[],leatherColors:[],cities:[]},
 }))
 assert(html.includes('Дата оплаты *'))
 assert(html.includes('Совпадает с датой заказа автоматически'))
 console.log('CLIENT3_RELEASE_PAYMENT_DATES_EDITOR_NO_TIMESHEET_PASS')
}finally{await vite.close()}

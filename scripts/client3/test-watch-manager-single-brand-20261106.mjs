import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
const read=path=>fs.readFileSync(path,'utf8')
const route=read('worker/domains/client3-watches.ts')
const team=read('worker/domains/client3-watch-team-main.ts')
const create=read('worker/domains/client3-watch-create.ts')
const managerEdit=read('worker/domains/client3-watch-admin-order.ts')
const form=read('src/features/client3/WatchOrderForm.tsx')
const orders=read('src/features/client3/WatchOrdersPanel.tsx')
const roster=read('src/features/client3/WatchTeamMainPanel.tsx')
for(const check of ['WATCH_MANAGER_BRAND_ASSIGNMENT','managerSingleBrandError',
  "Number(row?.total)===1&&Number(row?.matches)===1",
  "manager.role||'Менеджер')==='Менеджер'&&next.length!==1"]){
 assert(route.includes(check),'Server brand invariant missing: '+check)
}
assert(create.includes("Number(assignment?.total)!==1||Number(assignment?.matches)!==1"))
assert(team.includes("role==='Менеджер'&&brands.length!==1"))
assert(managerEdit.includes('SELECT COUNT(*) FROM watch_manager_brands b'))
assert(form.includes('const fixedBrand')&&form.includes('isAdmin?<label>Бренд'))
assert(orders.includes('isAdmin&&allowedBrands.length>1'))
assert(roster.includes('type="radio" name="new-manager-brand"'))
assert(roster.includes('name={\'manager-brand-\'+person.id}'))
const vite=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {WatchOrderForm}=await vite.ssrLoadModule('/src/features/client3/WatchOrderForm.tsx')
 const base={catalog:[],managers:[],deliveryMethods:['КАЗПОЧТА'],paymentMethods:['KASPI GOLD'],
   references:{models:[],movements:[],bracelets:[],dials:[],leatherColors:[]},onSave:()=>{}}
 const manager=renderToStaticMarkup(React.createElement(WatchOrderForm,{
   ...base,allowedBrands:['TAUWACH'],isAdmin:false}))
 const admin=renderToStaticMarkup(React.createElement(WatchOrderForm,{
   ...base,allowedBrands:['TAUWACH','WACHIZEN'],isAdmin:true}))
 assert(manager.includes('Закреплённый бренд менеджера'))
 assert(manager.includes('value="TAUWACH"'))
 assert(!manager.includes('<option value="WACHIZEN"'))
 assert(admin.includes('Выберите бренд'))
 assert(admin.includes('<option value="WACHIZEN"'))
 console.log('CLIENT3_MANAGER_SINGLE_BRAND_PASS')
}finally{await vite.close()}

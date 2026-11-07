import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'

const order=fs.readFileSync('src/features/sections/CreateOrderSection.tsx','utf8')
assert(order.indexOf('Клиент и условия заказа')<order.indexOf('Товары в заказе'),'Customer details must come first')
assert(order.includes('<MainWorkshopOrderModal'),'Workshop form must open separately')
assert(!order.includes('setManualMode('),'Old manual draft-in-basket path must be absent')
assert(order.includes('setTimeout(()=>setNotice(null),2200'),'Confirmation must disappear automatically')
assert(order.includes('main-basket-details'),'Basket must separate name from identifiable variant details')
const picker=fs.readFileSync('src/features/orders/MainClothingSourcePicker.tsx','utf8')
assert(!picker.includes('colorTones'),'Decorative color labels must not make false claims about colors')
assert(!picker.includes('clothing-source-tone'),'Swatches not verified against product colors must be absent')
assert(picker.includes('clothing-source-refinements'),'Large material families require local filters')

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Real Chrome is required')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orders-workshop-ux-'))
const stock={physical:5,reserved:0,cachedReserved:0,free:5,listed:true}
const rows=[]
for(let i=0;i<20;i++){
 rows.push({
  variantId:1000+i,productId:1,productName:'БАЯН СҰЛУ ШАПАН',category:'adult',
  gender:i%2===0?'ЖЕН':'МУЖ',color:i%3===0?'БЕЖЕВЫЙ':i%3===1?'БЕЛЫЙ':'ЧЕРНЫЙ',
  material:'ЗАМША ВЕЛЮР',length:i%2===0?'СТАНДАРТ':'ДЛИННЫЙ',
  size:String(42+(i%7)*2),salePrice:45000,warehouse:stock,boutique:stock
 })
}
const app=[
 "import React,{useState} from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {flushSync} from 'react-dom'",
 "import {MainClothingSourcePicker} from './src/features/orders/MainClothingSourcePicker.tsx'",
 "import {MainWorkshopOrderModal} from './src/features/orders/MainWorkshopOrderModal.tsx'",
 'const rows='+JSON.stringify(rows)+';',
 'window.__saved=[];window.__modalOpen=0;',
 "function View(){const [modal,setModal]=useState(false);window.__modalOpen=Number(modal);return <div>",
 "<MainClothingSourcePicker initialVariants={rows} allocated={new Map()} onCommit={()=>{}} onManual={()=>setModal(true)}/>",
 "<span data-order-items={window.__saved.length}></span>",
 "{modal&&<MainWorkshopOrderModal onClose={()=>setModal(false)} onSave={item=>{window.__saved.push(item);setModal(false)}} suggestions={{products:['БАЯН СҰЛУ ШАПАН'],colors:['БЕЖЕВЫЙ']}}/>}",
 "</div>}",
 "flushSync(()=>createRoot(document.getElementById('root')).render(<View/>))"
].join('\n')
const result=await build({stdin:{contents:app,loader:'jsx',resolveDir:process.cwd(),sourcefile:'workshop-ui-test.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',
 jsx:'automatic',jsxImportSource:'react',logLevel:'error'})
fs.writeFileSync(path.join(dir,'bundle.js'),result.outputFiles.find(x=>x.path.endsWith('.js')).text)
const css=fs.readFileSync('src/styles/main-clothing-source-picker.css','utf8')+
 fs.readFileSync('src/styles/main-sale-picker.css','utf8')
const browser=String.raw
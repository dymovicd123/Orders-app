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

const browser=["const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));","const click=async el=>{if(!el)throw Error('Missing control');el.click();await wait(100)};","const change=(node,value)=>{if(!node)throw Error('Missing input');const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const set=Object.getOwnPropertyDescriptor(proto,'value').set;set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))};","(async()=>{try{","await wait(300);","if(document.querySelector('.clothing-source-tone'))throw Error('Unverified decorative color still visible');","await click(document.querySelector('.clothing-source-model'));","const filters=document.querySelector('.clothing-source-refinements');if(!filters)throw Error('Missing large-execution filters');","const color=filters.querySelector('select[aria-label=\"Фильтр по цвету\"]');if(!color)throw Error('Missing color filter');","color.value='БЕЖЕВЫЙ';color.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);","const names=[...document.querySelectorAll('.clothing-source-color-title strong')].map(el=>el.textContent);","if(names.length!==1||names[0]!=='БЕЖЕВЫЙ')throw Error('Color filter did not narrow selection');","const size=filters.querySelector('select[aria-label=\"Фильтр по размеру\"]');size.value='42';size.dispatchEvent(new Event('change',{bubbles:true}));await wait(90);","if(!document.querySelector('.clothing-source-refinement-head')?.textContent.includes('из 20'))throw Error('Filtered count unavailable');","await click(document.querySelector('.clothing-source-manual'));","let modal=document.querySelector('[role=dialog][aria-modal=true]');if(!modal)throw Error('Workshop modal missing');","if(window.__saved.length)throw Error('Unsaved workshop item already committed');","for(const title of ['Какой товар изготовить','Количество и цена','Задание и комментарий','Срок изготовления'])if(!modal.textContent.includes(title))throw Error('Missing section: '+title);","await click(modal.querySelector('.main-workshop-close'));","if(document.querySelector('[role=dialog]')||window.__saved.length)throw Error('Modal cancel committed item');","await click(document.querySelector('.clothing-source-manual'));modal=document.querySelector('[role=dialog]');","","const byLabel=word=>[...modal.querySelectorAll('.main-workshop-field')].find(el=>el.textContent.includes(word))?.querySelector('input,textarea');","change(byLabel('Название товара'),'БАЯН СҰЛУ ШАПАН');change(byLabel('Размер *'),'46');","change(byLabel('Цена за штуку'),'32000');change(byLabel('Что нужно изготовить'),'Пожелание к пошиву');","await click(modal.querySelector('.main-workshop-checkbox input'));","change(byLabel('Нужно до'),'2026-11-30');","modal.querySelector('button[type=submit]').click();await wait(170);","if(window.__saved.length!==1||window.__saved[0].productName!=='БАЯН СҰЛУ ШАПАН'||window.__saved[0].workshopComment!=='Пожелание к пошиву'||!window.__saved[0].workshopUrgent||window.__saved[0].workshopDueDate!=='2026-11-30')throw Error('Workshop data not committed correctly');","if(document.querySelector('[role=dialog]'))throw Error('Modal not closed after save');","document.body.dataset.reviewPass='yes';","}catch(e){document.body.dataset.reviewPass='no';document.body.dataset.reviewError=String(e.message)}","})();"].join('\n')
fs.writeFileSync(path.join(dir,'index.html'),'<html lang="ru"><meta charset="utf-8"><style>body{font:14px Arial;background:#eff4fa;padding:12px}.clothing-source-picker{max-width:750px;background:white;padding:22px}'+css+'</style><div id="root"></div><script src="/bundle.js"></script><script>'+browser+'</script></html>')
const http=spawn('python3',['-m','http.server','38929','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,650))
let run
try{run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--virtual-time-budget=7500','--dump-dom','http://127.0.0.1:38929/index.html'],{encoding:'utf8',timeout:45000,maxBuffer:18*1024*1024})}finally{http.kill()}
assert.equal(run.status,0,'Chrome failed: '+String(run.stderr).slice(-1000))
const failure=run.stdout.match(/data-review-error="([^"]*)"/)?.[1]||'unknown'
assert.match(run.stdout,/data-review-pass="yes"/,'Review browser acceptance failed: '+failure)
console.log('BRANCH2_ORDER_UX_PASS: customer-first, clear basket, material filters, workshop modal cancel/save and deadline')

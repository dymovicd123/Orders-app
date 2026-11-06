import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Google Chrome is required for real CSS rendering acceptance')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-picker-visual-'))
const htmlFile=path.join(dir,'picker.html')
const screenshot=path.resolve('artifacts/main-order-picker-visual.png')
fs.mkdirSync(path.dirname(screenshot),{recursive:true})
const server=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true},logLevel:'error'})
try{
 const {MainOrderSourcePicker,suggestOrderModels,groupPickerExecutions}=await server.ssrLoadModule('/src/features/orders/MainOrderSourcePicker.tsx')
 const variants=[]
 let nextId=1
 for(let group=1;group<=97;group++){
   const count=group===1?48:1
   for(let i=0;i<count;i++){
     const available=group===1?i%6!==0:group%2!==0
     const physical=available?5:0
     variants.push({
       variantId:nextId++,productId:group,productName:group===1?'АЙДАЙ ЖИЛЕТ':'ШАПАН КАТАЛОГ '+group,
       category:'adult',gender:i%2===0?'ЖЕН':'МУЖ',
       color:['ВЕРБЛЮЖКА','БЕЛЫЙ','СИНИЙ'][i%3],
       material:['ЗАМША ВЕЛЮР','АТЛАС'][i%2],
       length:i%3===0?'ДЛИННЫЙ':'СТАНДАРТ',size:String(42+(i%8)*2),
       salePrice:22500,
       warehouse:{physical,reserved:0,cachedReserved:0,free:physical},
       boutique:{physical:0,reserved:0,cachedReserved:0,free:0},
     })
   }
 }
 const first=variants.filter(x=>x.productId===1)
 const executions=groupPickerExecutions(first)
 assert(executions.length>=3,'Execution groups must separate materials, gender and length')
 assert.equal(executions.flatMap(x=>x.colors.flatMap(c=>c.rows)).length,48)
 const suggestions=suggestOrderModels([
  {id:1,name:'АЙДАЙ ЖИЛЕТ',variants:first,free:80,physical:80,reserved:0},
  {id:2,name:'АЙДАР БОМБЕР',variants:[],free:0,physical:0,reserved:0},
  {id:3,name:'АБАЙ ШАПАН',variants:[],free:0,physical:0,reserved:0},
 ],'ай')
 assert.deepEqual(suggestions.map(x=>x.name),['АЙДАЙ ЖИЛЕТ','АЙДАР БОМБЕР','АБАЙ ШАПАН'])
 const main=renderToStaticMarkup(React.createElement(MainOrderSourcePicker,{
   initialVariants:variants,initialSelectedId:1,allocated:new Map(),onPick:()=>{},onManual:()=>{},
 }))
 const zero=renderToStaticMarkup(React.createElement(MainOrderSourcePicker,{
   initialVariants:variants,initialIntent:'all',initialSelectedId:2,
   allocated:new Map(),onPick:()=>{},onManual:()=>{},
 }))
 assert(main.includes('Поиск по названию товара'))
 assert(main.includes('Со свободным остатком'))
 assert(main.includes('АЙДАЙ ЖИЛЕТ'))
 assert(main.includes('Выберите нужный размер'))
 assert(main.includes('На месте'))
 assert(main.includes('В резерве'))
 assert(zero.includes('Нет свободного остатка'))
 assert(zero.includes('Оформить')||zero.includes('0 свободно'))
 const css=fs.readFileSync('src/styles/main-order-source-picker.css','utf8')
 const checks=[
  'const root=document.querySelector(".qa-default");',
  'const workspace=root.querySelector(".main-order-picker-workspace");',
  'const nav=[...root.querySelectorAll(".main-order-model-row")];',
  'const sizes=[...root.querySelectorAll(".main-order-size")];',
  'const executions=[...root.querySelectorAll(".main-order-exec-tabs button")];',
  'const zero=document.querySelector(".qa-zero");',
  'const zeroDisclosure=zero.querySelector(".main-order-exec-zero");',
  'const suggestions=root.querySelector("#main-order-model-query");',
  'const columns=getComputedStyle(workspace).gridTemplateColumns.split(" ").filter(Boolean).length;',
  'const navHeights=nav.map(el=>Math.round(el.getBoundingClientRect().height));',
  'const sizeHeights=sizes.map(el=>Math.round(el.getBoundingClientRect().height));',
  'const ok=columns===2 && nav.length===49 && navHeights.every(h=>h>=58)',
  ' && sizes.length>0 && sizes.length<25 && sizeHeights.every(h=>h>=50)',
  ' && executions.length>=3 && suggestions && suggestions.getAttribute("role")==="combobox"',
  ' && root.querySelectorAll(".main-order-picker-model").length===0',
  ' && zeroDisclosure && zeroDisclosure.open===true',
  ' && nav[0].textContent.includes("АЙДАЙ ЖИЛЕТ");',
  'document.body.setAttribute("data-picker-visual-pass",ok?"yes":"no");',
  'document.body.setAttribute("data-picker-models",String(nav.length));',
  'document.body.setAttribute("data-picker-executions",String(executions.length));',
  'document.body.setAttribute("data-picker-size-buttons",String(sizes.length));',
 ].join('\n')
 fs.writeFileSync(htmlFile,'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>'+
  'body{margin:0;padding:25px;font-family:Arial,sans-serif;background:#eaf0f8;color:#233a55}'+
  '.mock-order-card{max-width:1380px;margin:auto;padding:25px;background:white;border-radius:18px}'+css+
  '</style></head><body><main class="mock-order-card"><h2>Товары в заказе</h2><div class="qa-default">'+main+
  '</div><div class="qa-zero" style="margin-top:50px">'+zero+'</div></main><script>'+checks+'</script></body></html>')
 const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
   '--window-size=1440,1100','--virtual-time-budget=200',
   '--screenshot='+screenshot,'--dump-dom','file://'+htmlFile]
 const r=spawnSync(chrome,args,{encoding:'utf8',timeout:45000,maxBuffer:15*1024*1024})
 assert.equal(r.status,0,'Browser exited '+r.status+' '+(r.stderr||'').slice(-1500))
 assert.match(r.stdout,/data-picker-visual-pass="yes"/,
   'Name-only sidebar, stock-like execution/color/size layout and zero variants must render visibly')
 assert(fs.statSync(screenshot).size>10000,'Browser screenshot missing')
 console.log('MAIN_PICKER_CHROME_VISUAL_PASS: name search + 49 available-first models; stock execution/color/size groups; zero disclosure; readable chips; screenshot '+screenshot)
}finally{await server.close()}

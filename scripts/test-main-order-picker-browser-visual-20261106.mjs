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
 const {MainOrderSourcePicker,PRODUCT_PAGE_SIZE,VARIANT_PAGE_SIZE,paginate,filterOrderPickerVariants}=await server.ssrLoadModule('/src/features/orders/MainOrderSourcePicker.tsx')
 const variants=[]
 let variantId=1
 for(let group=1;group<=97;group++){
   const count=group===1?22:1
   for(let i=0;i<count;i++){
     variants.push({
       variantId:variantId++,productId:group,productName:group===1?'АЙДАЙ ЖИЛЕТ':'ШАПАН КАТАЛОГ '+String(group),
       category:'adult',gender:'ЖЕН',color:['АЙВОРИ','БЕЛЫЙ','ГОЛУБОЙ','БЕЖЕВЫЙ'][i%4],
       material:['ДЖИНСА','АТЛАС'][i%2],length:'СТАНДАРТ',size:String(40+(i%6)*2),
       salePrice:45000,
       warehouse:{physical:i===0?0:30,reserved:10,cachedReserved:10,free:i===0?0:20},
       boutique:{physical:0,reserved:0,cachedReserved:0,free:0},
     })
   }
 }
 assert.equal(paginate(Array.from({length:97},(_,i)=>i),0,PRODUCT_PAGE_SIZE).length,12)
 assert.equal(paginate(variants.filter(x=>x.productId===1),0,VARIANT_PAGE_SIZE).length,6)
 assert.equal(filterOrderPickerVariants(variants.filter(x=>x.productId===1),
   {color:'АЙВОРИ',gender:'',material:'',size:'',length:''}).length,6)
 const picker=renderToStaticMarkup(React.createElement(MainOrderSourcePicker,
    {initialVariants:variants,initialSelectedId:1,allocated:new Map(),onPick:()=>{},onManual:()=>{}}))
 const css=fs.readFileSync('src/styles/main-order-source-picker.css','utf8')
 const script=[
 'const models=[...document.querySelectorAll(".main-order-picker-model")];',
 'const rows=[...document.querySelectorAll(".main-order-picker-model-row")];',
 'const cards=[...document.querySelectorAll(".main-order-picker-variants-grid .main-order-picker-variant")];',
 'const panel=document.querySelector(".main-order-picker-detail");',
 'const rowsInfo=rows.map(row=>getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length);',
 'const modelHeights=models.map(el=>Math.round(el.getBoundingClientRect().height));',
 'const variantHeights=cards.map(el=>Math.round(el.getBoundingClientRect().height));',
 'const facets=[...document.querySelectorAll(".main-order-picker-facets select")];',
 'const ok=models.length===12 && rows.length===6 && rowsInfo.every(x=>x===2)',
 ' && modelHeights.every(h=>h>=70) && panel && cards.length===6',
 ' && variantHeights.every(h=>h>=130) && facets.length>=3',
 ' && document.body.textContent.includes("АЙДАЙ ЖИЛЕТ")',
 ' && document.body.textContent.includes("Нет свободных")',
 ' && document.body.textContent.includes("Страница 1 из 9");',
 'document.body.setAttribute("data-picker-visual-pass",ok?"yes":"no");',
 'document.body.setAttribute("data-picker-models",String(models.length));',
 'document.body.setAttribute("data-picker-variants",String(cards.length));',
 'document.body.setAttribute("data-picker-facets",String(facets.length));',
 'document.body.setAttribute("data-picker-model-height",String(modelHeights[0]));',
 'document.body.setAttribute("data-picker-variant-height",String(variantHeights[0]));',
 ].join('\n')
 fs.writeFileSync(htmlFile,'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>'+
  'body{margin:0;padding:25px;font-family:Arial,sans-serif;background:#eaf0f8;color:#233a55}'+
  '.mock-order-card{max-width:1380px;margin:auto;padding:25px;background:white;border-radius:18px}'+css+
  '</style></head><body><main class="mock-order-card"><h2>Товары в заказе</h2>'+picker+
  '</main><script>'+script+'</script></body></html>')
 const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
   '--window-size=1440,1100','--virtual-time-budget=200',
   '--screenshot='+screenshot,'--dump-dom','file://'+htmlFile]
 const r=spawnSync(chrome,args,{encoding:'utf8',timeout:45000,maxBuffer:15*1024*1024})
 assert.equal(r.status,0,'Browser exited '+r.status+' '+(r.stderr||'').slice(-1500))
 assert.match(r.stdout,/data-picker-visual-pass="yes"/,
   'Catalog must render 12 two-column product cards and max 6 readable variants with filters')
 assert(fs.statSync(screenshot).size>10000,'Browser screenshot missing')
 console.log('MAIN_PICKER_CHROME_VISUAL_PASS: 97 models -> 12 cards, 22 SKUs -> 6 compact cards, facets, 2-column grid; screenshot '+screenshot)
}finally{await server.close()}

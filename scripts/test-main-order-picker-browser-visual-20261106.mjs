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
assert(fs.existsSync(chrome),'Chrome is required for actual visual acceptance')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'main-order-picker-cards-'))
const htmlFile=path.join(temp,'picker.html')
const screenshot=path.resolve('artifacts/main-order-picker-visual.png')
fs.mkdirSync(path.dirname(screenshot),{recursive:true})
const server=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true},logLevel:'error'})
try{
 const {MainOrderSourcePicker,groupOrderPickerExecutions,suggestOrderPickerModels}=await server.ssrLoadModule('/src/features/orders/MainOrderSourcePicker.tsx')
 const variants=[]
 let next=1
 for(let i=1;i<=97;i++){
  const count=i===1?48:1
  for(let j=0;j<count;j++){
   const free=i===1?j%6!==0:i%2===1
   variants.push({
    variantId:next++,productId:i,productName:i===1?'АЙДАЙ ЖИЛЕТ':'ШАПАН КАТАЛОГ '+i,
    category:'adult',gender:j%2===0?'ЖЕН':'МУЖ',
    color:['ВЕРБЛЮЖКА','БЕЛЫЙ','СИНИЙ'][j%3],
    material:['ЗАМША ВЕЛЮР','АТЛАС'][j%2],
    length:j%3===0?'ДЛИННЫЙ':'СТАНДАРТ',size:String(42+(j%8)*2),salePrice:22500,
    warehouse:{physical:free?3:0,reserved:0,cachedReserved:0,free:free?3:0},
    boutique:{physical:0,reserved:0,cachedReserved:0,free:0}
   })
  }
 }
 const first=variants.filter(x=>x.productId===1)
 const executions=groupOrderPickerExecutions(first,'warehouse',new Map())
 assert(executions.length>1,'A model with different executions must be grouped')
 assert.equal(executions.reduce((sum,x)=>sum+x.lines.length,0),48)
 assert(suggestOrderPickerModels([{id:1,name:'АЙДАЙ ЖИЛЕТ',free:9,price:22500,lines:first}], 'айда').length===1)
 const picker=renderToStaticMarkup(React.createElement(MainOrderSourcePicker,{
  initialVariants:variants,initialSelectedId:1,allocated:new Map(),onPick:()=>{},onManual:()=>{}
 }))
 const css=fs.readFileSync('src/styles/main-order-source-picker.css','utf8')
 const script=[
 'const products=[...document.querySelectorAll(".main-order-picker-model")];',
 'const rows=[...document.querySelectorAll(".main-order-picker-model-row")];',
 'const panel=document.querySelector(".main-order-picker-detail");',
 'const executionButtons=[...document.querySelectorAll(".main-order-picker-executions button")];',
 'const executionSelect=document.querySelector(".main-order-picker-execution-select");',
 'const colorGroups=[...document.querySelectorAll(".main-order-picker-color-group")];',
 'const skuCards=[...document.querySelectorAll(".main-order-picker-color-group .main-order-picker-variant")];',
 'const modelHeights=products.map(el=>el.getBoundingClientRect().height);',
 'const skuHeights=skuCards.map(el=>el.getBoundingClientRect().height);',
 'const layout=rows.map(row=>getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length);',
 'const ok=products.length===12 && rows.length===6 && layout.every(n=>n===2)',
 ' && modelHeights.every(h=>h>=70) && !!panel',
 ' && (executionButtons.length>1||!!executionSelect)',
 ' && colorGroups.length>0 && skuCards.length>0 && skuCards.length<=6',
 ' && skuHeights.every(h=>h>=100)',
 ' && !!document.querySelector(".main-order-picker-name-search input[role=combobox]")',
 ' && !!document.querySelector(".main-order-picker-show-all")',
 ' && !document.querySelector(".main-order-model-list")',
 ' && document.body.textContent.includes("АЙДАЙ ЖИЛЕТ");',
 'document.body.dataset.pickerVisualPass=ok?"yes":"no";',
 'document.body.dataset.pickerProductCount=String(products.length);',
 'document.body.dataset.pickerSkuCount=String(skuCards.length);',
 'document.body.dataset.pickerExecutionCount=String(executionButtons.length);'
 ].join('\n')
 fs.writeFileSync(htmlFile,'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>'+
  'body{margin:0;padding:25px;font-family:Arial,sans-serif;background:#eaf0f8;color:#233a55}'+
  '.mock-order-card{max-width:1350px;margin:auto;padding:25px;background:white;border-radius:18px}'+css+
  '</style></head><body><main class="mock-order-card"><h2>Товары в заказе</h2>'+picker+
  '</main><script>'+script+'</script></body></html>')
 const result=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--window-size=1440,1100','--virtual-time-budget=200','--screenshot='+screenshot,
  '--dump-dom','file://'+htmlFile],
  {encoding:'utf8',timeout:45000,maxBuffer:15*1024*1024})
 assert.equal(result.status,0,'Chrome failed: '+(result.stderr||'').slice(-1500))
 assert.match(result.stdout,/data-picker-visual-pass="yes"/,'12 model cards and compact grouped variants must render visibly')
 assert(fs.statSync(screenshot).size>10000,'Missing browser screenshot')
 console.log('MAIN_PICKER_CHROME_VISUAL_PASS: original 2-column model cards; execution + color groups; max six compact SKU cards; no stock sidebar')
}finally{await server.close()}

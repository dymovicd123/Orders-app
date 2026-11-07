import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'

const form=fs.readFileSync('src/features/sections/OrderExchangeSmartSection.tsx','utf8')
const fallback=fs.readFileSync('src/features/sections/OrderExchangeSection.tsx','utf8')
const selector=fs.readFileSync('src/features/orders/ExchangeReplacementSelector.tsx','utf8')
const sourcePicker=fs.readFileSync('src/features/orders/MainClothingSourcePicker.tsx','utf8')
assert(form.includes('<ExchangeReplacementSelector'),'Smart set exchange must use same exact picker as order creation')
assert(!form.includes('className="exchange-new-details"'),'Set exchange must not show old manual variant fields')
assert(form.includes("shipmentState: undefined"),'Changing source must require new shipment state')
assert(form.includes("const saveBlockReason = replacementPickerOpen"),'Save must be blocked during replacement choice')
assert(form.includes("item.shipmentState === 'sent'")&&form.includes("item.shipmentState === 'pending'"),'Explicit shipment options cannot be removed')
assert(form.includes("exchangePhysicalShortage")||form.includes("physicalShortage"),'Stock-check requirement must remain')
assert(form.includes("projectedTotal")&&form.includes("refundAmount")&&form.includes("remainingDebt"),'Financial reconciliation must remain')
assert(fallback.includes("itemizedExchange && exchangeDraft.workflowMode === 'set_v2'"),'Legacy exchange orders remain separate')
assert(selector.includes('MainClothingSourcePicker'),'Selector must reuse creation catalog')
assert(selector.includes('MainWorkshopOrderModal'),'Manual unknown catalog variant remains possible')
assert(sourcePicker.includes('allowManualWhileEditing'),'Edit must expose quick new size/color')
const stock=(qty,listed=true)=>({physical:qty,reserved:0,cachedReserved:0,free:qty,listed})
const make=(id,color,size,material='ЗАМША ВЕЛЮР')=>({
 variantId:id,productId:11,productName:'БАЯН СҰЛУ ШАПАН',category:'adult',
 gender:'ЖЕН',color,material,length:'СТАНДАРТ',size,salePrice:27500,
 warehouse:stock(3),boutique:stock(0,false)
})
const rows=[
 make(701,'БЕЖЕВЫЙ','44'),make(702,'БЕЖЕВЫЙ','46'),
 make(703,'БЕЖЕВЫЙ','48'),make(704,'ВЕРБЛЮЖКА','44'),
 make(705,'ЧЕРНЫЙ','46'),make(706,'СИНИЙ','48'),
 make(707,'СЕРЫЙ','50'),make(708,'БЕЛЫЙ','52')
]
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'branch2-exchange-qa-'))
const app=[
 "import React,{useState} from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {ExchangeReplacementSelector} from './src/features/orders/ExchangeReplacementSelector.tsx'",
 'const rows='+JSON.stringify(rows)+';',
 "window.__updates=[];window.__fetches=[];window.fetch=async url=>{window.__fetches.push(String(url));return {ok:true,json:async()=>({ok:true,variants:rows})}};",
 "function View(){const [item,setItem]=useState({productName:'',audienceType:'ВЗРОСЛЫЙ',sourceType:'warehouse',quantity:1});window.__item=item;",
 "return <ExchangeReplacementSelector item={item} allocated={new Map()}",
 "onApply={patch=>{window.__updates.push(patch);setItem(old=>({...old,...patch}))}}",
 "onClose={()=>{window.__closed=true}} suggestions={{products:['БАЯН СҰЛУ ШАПАН'],colors:['БЕЖЕВЫЙ','ЧЕРНЫЙ'],materials:['ЗАМША ВЕЛЮР'],lengths:['СТАНДАРТ'],sizes:['44','46','48']}}/>}",
 "createRoot(document.getElementById('root')).render(<View/>);"
].join('\n')
const bundle=await build({stdin:{contents:app,loader:'jsx',resolveDir:process.cwd(),sourcefile:'exchange-picker-qa.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',
 jsx:'automatic',jsxImportSource:'react',logLevel:'error'})
for(const file of bundle.outputFiles){
 if(file.path.endsWith('.js'))fs.writeFileSync(path.join(dir,'bundle.js'),file.contents)
 if(file.path.endsWith('.css'))fs.writeFileSync(path.join(dir,'bundle.css'),file.contents)
}
const browser=[
 "const pause=n=>new Promise(ok=>setTimeout(ok,n));",
 "const click=async el=>{if(!el)throw Error('Control not found');el.click();await pause(170)};",
 "const change=(el,value)=>{if(!el)throw Error('Field not found');const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))};",
 "(async()=>{try{await pause(650);",
 "if(!document.querySelector('.clothing-source-picker'))throw Error('Shared clothing picker missing');",
 "await click(document.querySelector('.clothing-source-model'));",
 "const first=[...document.querySelectorAll('.clothing-source-size')].find(x=>x.getAttribute('aria-label')?.includes('Размер 44'));",
 "await click(first);",
 "await click(document.querySelector('.clothing-source-inline button[type=submit]'));",
 "if(window.__updates.length!==1||window.__item.catalogVariantId!==701||window.__item.sourceType!=='warehouse'||window.__item.size!=='44'||window.__item.priceOrigin!=='catalog'||window.__item.unitPrice!==27500)throw Error('Exact SKU and source missing from exchange');",
 "if(window.__updates[0].shipmentState!==undefined||window.__updates[0].stockObservationEnabled!==false)throw Error('Shipment or old stock acknowledgment incorrectly copied');",
 "await pause(180);",
 "const quick=[...document.querySelectorAll('.clothing-source-quick-actions button')].find(x=>x.textContent.includes('Другой цвет'));",
 "if(!quick)throw Error('Changing existing exchange variant lacks quick other color');",
 "await click(quick);",
 "let modal=document.querySelector('[role=dialog]');if(!modal?.querySelector('.main-workshop-quick'))throw Error('Quick color form missing');",
 "await click([...modal.querySelectorAll('button')].find(x=>x.textContent==='Отмена'));",
 "if(window.__updates.length!==1)throw Error('Canceled color replacement changed exchange');",
 "await click([...document.querySelectorAll('.clothing-source-quick-actions button')].find(x=>x.textContent.includes('Другой цвет')));",
 "modal=document.querySelector('[role=dialog]');",
 "change(modal.querySelector('.main-workshop-quick input'),'НОВЫЙ ЦВЕТ');await pause(100);",
 "await click(modal.querySelector('button[type=submit]'));",
 "if(window.__updates.length!==2||window.__item.color!=='НОВЫЙ ЦВЕТ'||window.__item.size!=='44'||window.__item.catalogVariantId!==undefined||!window.__item.manualCatalogEntry||window.__item.unitPrice!==27500)throw Error('Manual unknown color broke original size or sale price');",
 "if(window.__updates[1].shipmentState!==undefined||window.__updates[1].stockObservationEnabled!==false)throw Error('Manual change copied old shipping confirmation');",
 "if(window.__fetches.some(x=>x.includes('/api/exchanges/set')))throw Error('Choice performed real exchange');",
 "document.body.dataset.exchangeQa='pass';",
 "}catch(err){document.body.dataset.exchangeQa='fail';document.body.dataset.exchangeError=String(err.message)}})();"
].join('\n')
fs.writeFileSync(path.join(dir,'index.html'),'<html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script><script>'+browser+'</script></html>')
const server=spawn('python3',['-m','http.server','38749','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,700))
let result
try{result=spawnSync(process.env.CHROME_BIN||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--virtual-time-budget=9000','--dump-dom','http://127.0.0.1:38749/index.html'],{encoding:'utf8',timeout:45000,maxBuffer:18*1024*1024})}
finally{server.kill()}
assert.equal(result.status,0,'Chrome failed: '+String(result.stderr).slice(-800))
const error=result.stdout.match(/data-exchange-error="([^"]+)"/)?.[1]||'unknown'
assert.match(result.stdout,/data-exchange-qa="pass"/,'Exchange exact picker Chrome acceptance failed: '+error)
console.log('BRANCH2_EXCHANGE_REPLACEMENT_PICKER_PASS: exact SKU, unchanged quantity/price/source, manual new color, cancel, explicit shipment re-selection, no exchange mutation')

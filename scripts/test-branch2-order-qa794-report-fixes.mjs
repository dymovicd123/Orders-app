import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'

const appSource=fs.readFileSync('src/App.tsx','utf8')
const relations=fs.readFileSync('worker/domains/orders-read.ts','utf8')
const viewModel=fs.readFileSync('src/app/controllers/useOperationalViewModel.ts','utf8')
const list=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const draft=fs.readFileSync('src/features/sections/CreateOrderSection.tsx','utf8')
assert(appSource.includes('completeOrder = await fetchCompleteOrderForEditing(order)'),'F1: editor must load full detail')
assert(appSource.includes('upsertOrderInState(completeOrder)'),'F1: list must receive full edit snapshot')
assert(appSource.includes('Получен неполный состав заказа'),'F1: refuse incomplete edit')
assert(relations.includes('AS item_count'),'F1: list must include server count')
assert(viewModel.indexOf('if (editorOrderOverride?.id === selectedOrderId) return editorOrderOverride') <
 viewModel.indexOf('const fromList = orders.find'),'F1: full editor snapshot must be preferred')
assert(list.includes('Math.max(0, fullItemCount - visibleItemCount)'),'F1: count must not stop at cached preview')
assert(list.includes('expandOrderItems(order, visibleItemCount)'),'F1: expand must fetch full detail')
assert(draft.includes('findExactExistingManualVariant(item,catalogChoices)'),'F5: basket must distinguish known vs unknown')

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Chrome required for QA794 report regression')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orders-qa794-'))
const stock=(physical,listed=true)=>({physical,reserved:0,cachedReserved:0,free:physical,listed})
const make=(id,color,size,length,warehouse=2)=>({
 variantId:id,productId:1,productName:'БАЯН СҰЛУ ШАПАН',
 category:'adult',gender:'ЖЕН',material:'ЗАМША ВЕЛЮР',
 color,size,length,salePrice:27500,
 warehouse:stock(warehouse,true),boutique:stock(0,false)
})
const rows=[
 make(101,'БЕЖЕВЫЙ','44','СТАНДАРТ'),
 make(102,'БЕЖЕВЫЙ','44','ДЛИННЫЙ'),
 make(103,'БЕЖЕВЫЙ','48','ДЛИННЫЙ'),
 make(104,'ЧЕРНЫЙ','44','ДЛИННЫЙ'),
 make(105,'СИНИЙ','46','ДЛИННЫЙ'),
 make(106,'ЗЕЛЕНЫЙ','50','СТАНДАРТ'),
 make(107,'КРАСНЫЙ','52','СТАНДАРТ'),
 make(108,'КОРИЧНЕВЫЙ','54','СТАНДАРТ'),
 make(109,'БЕЛЫЙ','56','ДЛИННЫЙ'),
 make(110,'ОРАНЖЕВЫЙ','58','ДЛИННЫЙ')
]
const app=[
 "import React,{useState} from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {flushSync} from 'react-dom'",
 "import {MainClothingSourcePicker} from './src/features/orders/MainClothingSourcePicker.tsx'",
 "import {MainWorkshopOrderModal} from './src/features/orders/MainWorkshopOrderModal.tsx'",
 "import {formatOrderItemDetails} from './src/app/utils.ts'",
 'const rows='+JSON.stringify(rows)+';',
 'window.__saved=[];window.__commit=[];',
 "window.__details=formatOrderItemDetails({audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'БЕЗ ЦВЕТА',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'БЕЗ РАЗМЕРА'});",
 "window.__zero=formatOrderItemDetails({audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'БЕЗ ЦВЕТА',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'0'});",
 "function View(){const [modal,setModal]=useState(null);const [catalog,setCatalog]=useState(rows);return <div>",
 "<MainClothingSourcePicker initialVariants={rows} allocated={new Map()} onCommit={(choice,source)=>window.__commit.push({choice,source})} onVariantsLoaded={setCatalog} onManual={(origin,preset)=>setModal({origin,preset})}/>",
 "{modal&&<MainWorkshopOrderModal source={modal.origin} preset={modal.preset} catalogVariants={catalog} suggestions={{products:['БАЯН СҰЛУ ШАПАН'],colors:['БЕЖЕВЫЙ','ЧЕРНЫЙ'],materials:['ЗАМША ВЕЛЮР'],lengths:['СТАНДАРТ','ДЛИННЫЙ'],sizes:['44','48']}} onSave={item=>{window.__saved.push(item);setModal(null)}} onClose={()=>setModal(null)}/>}</div>}",
 "flushSync(()=>createRoot(document.getElementById('root')).render(<View/>))",
].join('\n')
const bundle=await build({stdin:{contents:app,loader:'jsx',resolveDir:process.cwd(),sourcefile:'qa794-ui.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',
 jsx:'automatic',jsxImportSource:'react',logLevel:'error'})
fs.writeFileSync(path.join(dir,'bundle.js'),bundle.outputFiles.find(x=>x.path.endsWith('.js')).text)
const css=fs.readFileSync('src/styles/main-clothing-source-picker.css','utf8')+
 fs.readFileSync('src/styles/main-sale-picker.css','utf8')
const browser=[
 "const wait=n=>new Promise(resolve=>setTimeout(resolve,n));",
 "const click=async el=>{if(!el)throw Error('Missing button');el.click();await wait(110)};",
 "const change=(node,value)=>{if(!node)throw Error('Missing input');const p=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(node,value);node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}))};",
 "(async()=>{try{",
 "await wait(250);",
 "if(window.__details.includes('СТАНДАРТ')||!window.__details.includes('Без размера')||!window.__details.includes('Обычная длина')||window.__details.includes('Размер Без размера')||!window.__zero.includes('0'))throw Error('F6 human labels');",
 "await click(document.querySelector('.clothing-source-model'));",
 "const color=document.querySelector('select[aria-label=\"Фильтр по цвету\"]');const size=document.querySelector('select[aria-label=\"Фильтр по размеру\"]');if(!color||!size)throw Error('Fixture did not show adaptive filters');",
 "change(color,'БЕЖЕВЫЙ');await wait(90);change(size,'44');await wait(90);",
 "const compare=document.querySelector('.clothing-source-comparison');if(!compare||!compare.textContent.includes('Обычная длина')||!compare.textContent.includes('ДЛИННЫЙ'))throw Error('F4 missing length comparison for same 44');",
 "const length=document.querySelector('select[aria-label=\"Фильтр по длине\"]');change(length,'ДЛИННЫЙ');await wait(80);",
 "await click(document.querySelector('.clothing-source-size'));",
 "const before=document.querySelector('.clothing-source-inline');if(!before?.textContent.includes('ДЛИННЫЙ'))throw Error('Exact selection absent');",
 "await click([...document.querySelectorAll('.clothing-source-tabs button')].find(el=>el.textContent==='Бутик'));",
 "if(document.querySelector('select[aria-label=\"Фильтр по цвету\"]')?.value!=='БЕЖЕВЫЙ'||document.querySelector('select[aria-label=\"Фильтр по размеру\"]')?.value!=='44'||document.querySelector('select[aria-label=\"Фильтр по длине\"]')?.value!=='ДЛИННЫЙ')throw Error('F3 filters reset on source switch');",
 "if(!document.querySelector('.clothing-source-inline')||!document.querySelector('.clothing-source-alert')?.textContent.includes('товары')){ if(!document.body.textContent.includes('Товар не числится в Бутике'))throw Error('F3 exact zero source not shown') }",
 "await click([...document.querySelectorAll('.clothing-source-tabs button')].find(el=>el.textContent==='Склад'));",
 "await click(document.querySelector('.clothing-source-quick-link'));",
 "let modal=document.querySelector('[role=dialog]');if(!modal?.querySelector('.main-workshop-quick'))throw Error('F2 guided size missing');",
 "const field=()=>document.querySelector('.main-workshop-quick input');",
 "change(field(),'44');await wait(70);",
 "if(!modal.textContent.includes('Такой вариант уже есть'))throw Error('F5 known exact variant not previewed');",
 "change(field(),'62');await wait(80);",
 "if(!modal.textContent.includes('Точного варианта')&&!modal.textContent.includes('Точного варианта пока')&&!modal.textContent.includes('Такого точного варианта'))throw Error('F5 unknown variant not previewed');",
 "await click(modal.querySelector('.main-workshop-expand'));",
 "modal=document.querySelector('[role=dialog]');if(!modal||modal.querySelector('.main-workshop-quick')||![...modal.querySelectorAll('input')].some(el=>el.value==='62'))throw Error('F7 full form did not open on first click');",
 "await click(modal.querySelector('.main-workshop-close'));if(window.__saved.length)throw Error('Cancel committed a variant');",
 "await click(document.querySelector('.clothing-source-quick-link'));modal=document.querySelector('[role=dialog]');change(field(),'44');await click(modal.querySelector('button[type=submit]'));",
 "if(window.__saved.length!==1||window.__saved[0].size!=='44'||window.__saved[0].sourceType!=='warehouse')throw Error('F2 invisible base incorrectly rejected 44');",
 "if(window.__commit.length!==0)throw Error('Browsing unexpectedly committed catalog item');",
 "document.body.dataset.qa794='pass';",
 "}catch(err){document.body.dataset.qa794='fail';document.body.dataset.qa794Error=String(err.message)}",
 "})();"
].join('\n')
fs.writeFileSync(path.join(dir,'index.html'),'<html lang="ru"><meta charset="utf-8"><style>body{font:14px Arial;background:#f5f7fb;padding:8px}.clothing-source-picker{max-width:900px;background:white}'+css+'</style><div id="root"></div><script src="/bundle.js"></script><script>'+browser+'</script></html>')
const port=38936
const server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,700))
let result
try{
 result=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--virtual-time-budget=9000','--dump-dom','http://127.0.0.1:'+port+'/index.html'],{encoding:'utf8',timeout:45000,maxBuffer:18*1024*1024})
}finally{server.kill()}
assert.equal(result.status,0,'Chrome failed: '+String(result.stderr).slice(-800))
const error=result.stdout.match(/data-qa794-error="([^"]*)"/)?.[1]||'unknown'
assert.match(result.stdout,/data-qa794="pass"/,'QA794 F2-F7 browser failed: '+error)
console.log('QA794_REPORT_FIXES_PASS: full editor snapshot guards + source preservation + size/length + known/unknown + copy + one-click form')

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Chrome must be installed for actual interaction acceptance')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-picker-click-'))
const html=path.join(dir,'interactive.html')
const variants=[
 {variantId:1,productId:1,productName:'АЙДАЙ ЖИЛЕТ',category:'adult',gender:'ЖЕН',
  color:'СИНИЙ',material:'ДЖИНСА',length:'СТАНДАРТ',size:'44',salePrice:25000,
  warehouse:{physical:30,reserved:10,cachedReserved:10,free:20},
  boutique:{physical:0,reserved:0,cachedReserved:0,free:0}},
 {variantId:2,productId:1,productName:'АЙДАЙ ЖИЛЕТ',category:'adult',gender:'ЖЕН',
  color:'БЕЛЫЙ',material:'ДЖИНСА',length:'СТАНДАРТ',size:'46',salePrice:25000,
  warehouse:{physical:0,reserved:0,cachedReserved:0,free:0},
  boutique:{physical:0,reserved:0,cachedReserved:0,free:0}},
 {variantId:3,productId:2,productName:'АБАЙ ШАПАН',category:'adult',gender:'МУЖ',
  color:'ЧЁРНЫЙ',material:'АТЛАС',length:'СТАНДАРТ',size:'52',salePrice:35000,
  warehouse:{physical:0,reserved:0,cachedReserved:0,free:0},
  boutique:{physical:0,reserved:0,cachedReserved:0,free:0}},
]
const entry=[
 "import React from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {flushSync} from 'react-dom'",
 "import {MainOrderSourcePicker} from './src/features/orders/MainOrderSourcePicker.tsx'",
 "import {OrderTableDispatchModal} from './src/features/orders/OrderTableDispatchModal.tsx'",
 "import {createOrderTableDispatchActions} from './src/features/orders/orderTableDispatchActions.ts'",
 'window.__picked=[]',
 'const props={initialVariants:'+JSON.stringify(variants)+',initialSelectedId:1,allocated:new Map(),',
 'onPick:(choice,source,insufficient)=>window.__picked.push({variantId:choice.variantId,source,insufficient}),',
 'onManual:()=>window.__picked.push({manual:true})}',
 "flushSync(()=>createRoot(document.getElementById('mount')).render(React.createElement(MainOrderSourcePicker,props)))",
 "\nwindow.__shipCalls=[];\nwindow.__shipApproved=false;\nwindow.__shipStale=false;\nwindow.__shipRefreshes=0;\nwindow.__shipMessage='';\nconst lineWarehouse={orderItemId:44,productName:'КОСТЮМ',readyQuantity:2,selectedQuantity:2,selectable:true,sourceType:'warehouse',color:'ХАКИ'};\nconst lineWorkshop={orderItemId:45,productName:'ШАПАН ЦЕХ',readyQuantity:2,selectedQuantity:2,selectable:true,sourceType:'workshop',color:'БЕЛЫЙ'};\nfunction ShippingFixture(){\n  const [draft,setDraft]=React.useState(null);\n  window.__setShipDraft=setDraft;\n  if(!draft)return React.createElement('span',{id:'ship-idle'},'idle');\n  const actions=createOrderTableDispatchActions({\n    dispatchDraft:draft,setDispatchDraft:setDraft,\n    apiFetch:async (url,init={})=>{\n      window.__shipCalls.push({url,init});\n      const method=init.method||'GET';\n      if(method==='POST'&&String(url).endsWith('/shipping/dispatches')){\n        const body=JSON.parse(init.body);\n        if(window.__shipStale)return new Response(JSON.stringify({ok:false,message:'Заказ изменился'}),{status:409,headers:{'Content-Type':'application/json'}});\n        if(!body.stockConfirmations)return new Response(JSON.stringify({\n          ok:false,code:'dispatch_stock_confirmation_required',\n          items:[{productName:'КОСТЮМ',source:'warehouse',variantId:123,expectedQuantity:0,trackedPhysicalQuantity:0,operationQuantity:1}],\n        }),{status:409,headers:{'Content-Type':'application/json'}});\n        return Response.json({ok:true,shippedQuantity:body.items.reduce((sum,item)=>sum+item.quantity,0)});\n      }\n      if(method==='PATCH'&&String(url).endsWith('/shipping'))return Response.json({ok:true});\n      throw Error('Unexpected browser-test shipping request '+method+' '+url);\n    },\n    askStockResolution:async()=>window.__shipApproved,\n    askActionConfirmation:async()=>true,\n    setMessage:value=>{window.__shipMessage=value},\n    onShipmentChange:async()=>{window.__shipRefreshes++},\n  });\n  return React.createElement(OrderTableDispatchModal,{draft,setDraft,...actions});\n}\nwindow.__mountShip=()=>flushSync(()=>createRoot(document.getElementById('ship-mount')).render(React.createElement(ShippingFixture)));\nwindow.__resetShip=mode=>{\n  const plan=mode==='prior'\n    ?{ok:true,lines:[],selectedCount:0,canConfirmIssuedOnly:true}\n    :mode==='return'\n      ?{ok:true,lines:[],selectedCount:0,canConfirmIssuedOnly:false}\n      :{ok:true,lines:[lineWarehouse,lineWorkshop],selectedCount:2,canConfirmIssuedOnly:false};\n  const history=mode==='return'\n    ?[{dispatchItemId:78,orderItemId:44,productName:'КОСТЮМ',quantity:1,cancelledQuantity:0,hasReturn:true,dispatchDate:'2026-11-09'}]\n    :[];\n  window.__setShipDraft({\n    order:{id:55,external_id:'ORD-55'},plan,history,loading:false,submitting:false,\n    error:'',selected:mode==='ready'||mode==='stale'?{44:2,45:2}:{},\n    requestId:'order-dispatch:chrome-'+mode,correctionKey:'',correctionItemId:0,\n  });\n};\n",
].join('\n')
const built=await build({
 stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd(),sourcefile:'source-picker-test.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',jsx:'automatic',jsxImportSource:'react',
 logLevel:'error',
})
const js=built.outputFiles.find(x=>x.path.endsWith('.js'))
assert(js,'Bundled mount script missing')
fs.writeFileSync(path.join(dir,'picker-bundle.js'),js.text)
const css=fs.readFileSync('src/styles/main-order-source-picker.css','utf8')
const test=[
 'const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));',
 '(async()=>{try{',
 'await sleep(350);',
 'const initial=document.querySelector(".main-order-picker-color-group .main-order-picker-variant");',
 'if(!initial)throw Error("Restored card variant missing after React mount");',
 'const add=initial.querySelector(".main-order-picker-actions .primary");',
 'if(!add)throw Error("Active SKU must have a primary add button");',
 'add.click();await sleep(80);',
 'if(window.__picked.length!==1||window.__picked[0].variantId!==1||window.__picked[0].source!=="warehouse"||window.__picked[0].insufficient)throw Error("Active SKU was not added by exact variant ID");',
 'const showAll=document.querySelector(".main-order-picker-show-all");',
 'if(!showAll)throw Error("Previously unavailable variant must be reachable from chosen model");',
 'showAll.click();await sleep(100);',
 'const shownAfter=Array.from(document.querySelectorAll(".main-order-picker-color-group .main-order-picker-variant"));',
 'if(shownAfter.length!==2)throw Error("Zero variant must appear on Show all model variants");',
 'const search=document.querySelector("#main-order-model-query");',
 'const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;',
 'setter.call(search,"АБАЙ ШАПАН");',
 'search.dispatchEvent(new Event("input",{bubbles:true}));',
 'await sleep(150);',
 'const suggestions=[...document.querySelectorAll(".main-order-name-suggestions [role=option]")];',
 'if(!suggestions.length)throw Error("Typing product name did not open suggestions");',
 'suggestions[0].click();await sleep(150);',
 'const chosen=document.querySelector(".main-order-picker-detail-head strong");',
 'if(!chosen||chosen.textContent!=="АБАЙ ШАПАН")throw Error("Suggestion did not open the correct model card");',
 'const absent=document.querySelector(".main-order-picker-color-group .main-order-picker-variant");',
 'if(!absent)throw Error("Zero-stock variant missing for selected catalogue model");',
 'const buttons=[...absent.querySelectorAll(".main-order-picker-actions button")];',
 'if(buttons.length!==2||!buttons[0].textContent.includes("Из источника")||!buttons[1].textContent.includes("В цех"))throw Error("Both shortage actions must remain available");',
 'buttons[0].click();buttons[1].click();await sleep(80);',
 'if(window.__picked.length!==3||window.__picked[1].variantId!==3||window.__picked[1].source!=="warehouse"||!window.__picked[1].insufficient||window.__picked[2].source!=="workshop")throw Error("Zero-stock original-source and workshop actions changed");',
 "window.__mountShip();",
 "await sleep(100);",
 "window.__resetShip('ready');",
 "await sleep(100);",
 "const dialog=()=>document.querySelector('#ship-mount [role=\"dialog\"]');",
 "const shipSend=()=>[...dialog().querySelectorAll('button')].find(el=>el.textContent.trim()==='Подтвердить отправку');",
 "if(!dialog()||!dialog().textContent.includes('КОСТЮМ')||!dialog().textContent.includes('ШАПАН ЦЕХ'))throw Error('Shipment form not rendered from typed modal');",
 "const warehouseInput=dialog().querySelector('input[aria-label=\"Количество КОСТЮМ\"]');",
 "const workshopInput=dialog().querySelector('input[aria-label=\"Количество ШАПАН ЦЕХ\"]');",
 "if(!warehouseInput||!workshopInput||Number(warehouseInput.value)!==2||Number(workshopInput.value)!==2||!workshopInput.disabled)throw Error('Default selections or Workshop whole-quantity guard lost');",
 "setter.call(warehouseInput,'1');",
 "warehouseInput.dispatchEvent(new Event('input',{bubbles:true}));",
 "await sleep(100);",
 "if(Number(dialog().querySelector('input[aria-label=\"Количество КОСТЮМ\"]').value)!==1)throw Error('Partial ready quantity was not retained by actual React input');",
 "window.__shipApproved=false;",
 "shipSend().click();await sleep(190);",
 "if(!dialog()||!dialog().textContent.includes('Отправка не проведена')||window.__shipRefreshes!==0)throw Error('Declined shortage incorrectly completed shipment');",
 "const first=JSON.parse(window.__shipCalls.at(-1).init.body);",
 "if(first.requestId!=='order-dispatch:chrome-ready'||first.items.find(x=>x.orderItemId===44)?.quantity!==1||first.items.find(x=>x.orderItemId===45)?.quantity!==2)throw Error('Partial amount or original idempotency key changed');",
 "window.__shipApproved=true;",
 "shipSend().click();await sleep(220);",
 "const postCalls=window.__shipCalls.filter(x=>x.init.method==='POST');",
 "if(postCalls.length!==3||postCalls.some(x=>JSON.parse(x.init.body).requestId!=='order-dispatch:chrome-ready'))throw Error('Shortage retry generated duplicate request identity');",
 "const confirmed=JSON.parse(postCalls.at(-1).init.body);",
 "if(confirmed.stockConfirmations?.[0]?.variantId!==123||confirmed.stockConfirmations?.[0]?.operationQuantity!==1)throw Error('Operator confirmed anything other than exact shortage');",
 "if(dialog()||window.__shipRefreshes!==1||!window.__shipMessage.includes('отправлено 3 шт.'))throw Error('Successful selected shipment did not close dialog and refresh once');",
 "window.__resetShip('prior');await sleep(100);",
 "const priorButton=[...dialog().querySelectorAll('button')].find(el=>el.textContent.includes('Подтвердить отправку без повторного списания'));",
 "if(!priorButton||shipSend())throw Error('Legacy prior-issued flow lost status-only action');",
 "priorButton.click();await sleep(180);",
 "const patch=window.__shipCalls.find(x=>x.init.method==='PATCH');",
 "if(!patch||patch.init.headers['X-Idempotency-Key']!=='order-dispatch:chrome-prior'||JSON.parse(patch.init.body).confirmAlreadyIssued!==true||window.__shipRefreshes!==2)throw Error('Prior-issued status confirmation retried stock deduction');",
 "window.__resetShip('return');await sleep(100);",
 "if(!dialog()?.textContent.includes('Есть возврат')||[...dialog().querySelectorAll('button')].some(el=>el.textContent.includes('Исправить ошибочную отправку')))throw Error('Already-returned shipment offered destructive correction');",
 "window.__setShipDraft(null);await sleep(50);",
 'document.body.setAttribute("data-picker-interactive-pass","yes");',
 '}catch(error){document.body.setAttribute("data-picker-interactive-pass","no");document.body.setAttribute("data-picker-interactive-error",String(error.message));}',
 '})();',
].join('\n')
fs.writeFileSync(html,
 '<!doctype html><html lang="ru"><meta charset="UTF-8"><style>body{font-family:Arial;background:#f7faff;color:#20405f;padding:10px}'+css+
 '</style><body><div id="mount"></div><div id="ship-mount"></div><script>window.onerror=(m)=>document.body.setAttribute("data-picker-runtime-error",String(m))</script><script src="picker-bundle.js"></script><script>'+test+'</script></body></html>')
const httpServer=spawn('python3',['-m','http.server','38921','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,700))
let run
try{
 run=spawnSync(chrome,[
 '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
 '--window-size=1350,900','--virtual-time-budget=5000','--dump-dom','http://127.0.0.1:38921/interactive.html'
],{encoding:'utf8',timeout:45000,maxBuffer:20*1024*1024})
}finally{httpServer.kill()}
assert.equal(run.status,0,'Chrome exited unexpectedly: '+String(run.stderr).slice(-1200))
const match=run.stdout.match(/data-picker-interactive-error="([^"]*)"/)
if(!/data-picker-interactive-pass="yes"/.test(run.stdout))console.log('INTERACTION_BROWSER_DOM_TAIL',run.stdout.slice(-3500))
assert.match(run.stdout,/data-picker-interactive-pass="yes"/,
 'Browser React interactions failed: '+(match?.[1]||'Unknown UI failure'))
console.log('MAIN_PICKER_BROWSER_INTERACTION_PASS: select active SKU, autocomplete zero-stock model, choose stock shortage and workshop with no mutation')

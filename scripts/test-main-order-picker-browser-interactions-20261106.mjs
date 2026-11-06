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
 'window.__picked=[]',
 'const props={initialVariants:'+JSON.stringify(variants)+',initialSelectedId:1,allocated:new Map(),',
 'onPick:(choice,source,insufficient)=>window.__picked.push({variantId:choice.variantId,source,insufficient}),',
 'onManual:()=>window.__picked.push({manual:true})}',
 "flushSync(()=>createRoot(document.getElementById('mount')).render(React.createElement(MainOrderSourcePicker,props)))",
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
 'await sleep(400);',
 'const available=document.querySelector(".main-order-size");',
 'if(!available)throw Error("Available size was not rendered; root="+document.getElementById("mount").innerHTML.slice(0,300)+"; runtime="+document.body.dataset.pickerRuntimeError);',
 'available.click();await sleep(100);',
 'const select=document.querySelector(".main-order-pick-selection-actions .primary");',
 'if(!select)throw Error("Choosing a size did not reveal the add-to-order action");',
 'select.click();',
 'if(window.__picked.length!==1||window.__picked[0].variantId!==1||window.__picked[0].source!=="warehouse"||window.__picked[0].insufficient)throw Error("Available SKU callback incorrect");',
 'const search=document.querySelector("#main-order-model-query");',
 'const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;',
 'setter.call(search,"АБАЙ ШАПАН");',
 'search.dispatchEvent(new Event("input",{bubbles:true}));',
 'await sleep(150);',
 'const suggestions=[...document.querySelectorAll(".main-order-name-suggestions [role=option]")];',
 'if(!suggestions.length)throw Error("Typing product name did not open suggestions");',
 'suggestions[0].click();await sleep(150);',
 'const chosenModel=document.querySelector(".main-order-pick-detail-header h3");',
 'if(!chosenModel||chosenModel.textContent!=="АБАЙ ШАПАН")throw Error("Suggestion did not select model");',
 'const all=document.querySelector(".main-order-picker-tabs button[aria-pressed=true]");',
 'const zero=document.querySelector(".main-order-exec-zero");',
 'if(!zero||!zero.open)throw Error("Out-of-stock variant must be accessible through catalog");',
 'const absent=document.querySelector(".main-order-size.no-free");',
 'if(!absent)throw Error("Out-of-stock size is not selectable");',
 'absent.click();await sleep(150);',
 'const reserve=document.querySelector(".main-order-pick-selection-actions .primary");',
 'const workshop=document.querySelector(".main-order-pick-selection-actions .secondary");',
 'if(!reserve||!workshop||!reserve.textContent.includes("Оформить из источника"))throw Error("Shortage and workshop choices missing");',
 'reserve.click();workshop.click();',
 'if(window.__picked.length!==3||window.__picked[1].variantId!==3||window.__picked[1].source!=="warehouse"||!window.__picked[1].insufficient||window.__picked[2].source!=="workshop")throw Error("Zero stock actions were not preserved");',
 'document.body.setAttribute("data-picker-interactive-pass","yes");',
 '}catch(error){document.body.setAttribute("data-picker-interactive-pass","no");document.body.setAttribute("data-picker-interactive-error",String(error.message));}',
 '})();',
].join('\n')
fs.writeFileSync(html,
 '<!doctype html><html lang="ru"><meta charset="UTF-8"><style>body{font-family:Arial;background:#f7faff;color:#20405f;padding:10px}'+css+
 '</style><body><div id="mount"></div><script>window.onerror=(m)=>document.body.setAttribute("data-picker-runtime-error",String(m))</script><script src="picker-bundle.js"></script><script>'+test+'</script></body></html>')
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

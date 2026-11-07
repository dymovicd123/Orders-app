import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'

const stock=(physical,reserved=0,listed=true)=>({
 physical,reserved,listed,cachedReserved:reserved,free:Math.max(0,physical-reserved)
})
const base={
 productId:77,productName:'БЕГІМ ПОНЧО',category:'adult',gender:'ЖЕН',
 material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',color:'БЕЖЕВЫЙ',salePrice:23000,
 warehouse:stock(2),boutique:stock(0,0,false)
}
const rows=[
 {...base,variantId:7101,size:'СТАНДАРТ'},
 {...base,variantId:7102,size:'0'},
 {...base,variantId:7103,size:''},
 {...base,variantId:7104,size:'46',color:'ЧЕРНЫЙ',warehouse:stock(0),boutique:stock(2)}
]
const entry=[
 "import React from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {flushSync} from 'react-dom'",
 "import {MainClothingSourcePicker} from './src/features/orders/MainClothingSourcePicker.tsx'",
 'window.__picked=[];',
 'const rows='+JSON.stringify(rows)+';',
 "flushSync(()=>createRoot(document.getElementById('root')).render(React.createElement(MainClothingSourcePicker,{initialVariants:rows,allocated:new Map(),onCommit:(choice,source,fields,insufficient)=>window.__picked.push({id:choice.variantId,size:choice.size,source,qty:fields.quantity,insufficient}),onManual:()=>{}})))"
].join('\n')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orders-standard-size-'))
const built=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd(),sourcefile:'size-check.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',
 jsx:'automatic',jsxImportSource:'react',logLevel:'error'})
fs.writeFileSync(path.join(dir,'app.js'),built.outputFiles.find(f=>f.path.endsWith('.js')).text)
const css=fs.readFileSync('src/styles/main-clothing-source-picker.css','utf8')
const browser=[
"const wait=ms=>new Promise(r=>setTimeout(r,ms));",
"const click=async el=>{if(!el)throw Error('Control missing');el.click();await wait(110)};",
"const search=async value=>{const el=document.querySelector('input[aria-label=\"Поиск модели\"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));await wait(100)};",
"const sizeButtons=()=>[...document.querySelectorAll('button.clothing-source-size')];",
"const sizeByLabel=value=>sizeButtons().find(el=>el.querySelector('strong')?.textContent===value);",
"const add=async()=>{const form=document.querySelector('form.clothing-source-inline');if(!form)throw Error('Inline form missing');form.requestSubmit();await wait(120)};",
"(async()=>{try{",
"await wait(230);",
"await click(document.querySelector('.clothing-source-model'));",
"const sizes=sizeButtons();",
"if(sizes.length!==4)throw Error('Source group lost one of the size variants');",
"if(!sizeByLabel('Стандарт')||!sizeByLabel('0')||!sizeByLabel('Без размера')||!sizeByLabel('46'))throw Error('Mixed size variants are not shown separately');",
"if(sizeByLabel('Стандарт').disabled||sizeByLabel('0').disabled||sizeByLabel('Без размера').disabled)throw Error('Unique existing SKU blocked');",
"await click(sizeByLabel('Стандарт'));",
"if(!document.querySelector('.clothing-source-picked')?.textContent.includes('Размер Стандарт'))throw Error('Standard size mixed with standard length');",
"await add();",
"if(window.__picked.length!==1||window.__picked[0].id!==7101||window.__picked[0].size!=='СТАНДАРТ')throw Error('Standard SKU identity not retained');",
"await click(sizeByLabel('0'));await add();",
"if(window.__picked.length!==2||window.__picked[1].id!==7102||window.__picked[1].size!=='0')throw Error('Literal zero SKU identity not retained');",
"await click(sizeByLabel('Без размера'));await add();",
"if(window.__picked.length!==3||window.__picked[2].id!==7103||window.__picked[2].size!=='')throw Error('Empty-size SKU identity not retained');",
"await search('Бегім пончо размер стандарт');",
"if(!document.querySelector('.clothing-source-model')?.textContent.includes('БЕГІМ'))throw Error('Exact Standard size search did not find model');",
"await click(document.querySelector('.clothing-source-model'));",
"if(!sizeByLabel('Стандарт')||sizeByLabel('0')||sizeByLabel('Без размера'))throw Error('Explicit size STANDARD did not filter other sizes');",
"await search('Бегім пончо без размера');",
"if(!document.querySelector('.clothing-source-model'))throw Error('No-size search did not find model');",
"await click(document.querySelector('.clothing-source-model'));",
"if(!sizeByLabel('Без размера')||sizeByLabel('Стандарт'))throw Error('No-size query leaked Standard size');",
"await search('Бегім пончо 0');",
"if(!document.querySelector('.clothing-source-model'))throw Error('Literal zero query not found');",
"await click(document.querySelector('.clothing-source-model'));",
"if(!sizeByLabel('0')||sizeByLabel('Без размера')||sizeByLabel('Стандарт'))throw Error('Literal zero query aliased to another SKU');",
"await click([...document.querySelectorAll('.clothing-source-tabs>button')].find(el=>el.textContent==='Бутик'));",
"if(!document.querySelector('.clothing-source-model'))throw Error('Boutique source model missing');",
"await search('');",
"if(document.querySelectorAll('.clothing-source-model').length!==1)throw Error('Boutique source scoping changed');",
"document.body.dataset.sizePass='yes';",
"}catch(error){document.body.dataset.sizePass='no';document.body.dataset.sizeError=String(error.message)}",
"})();"
].join('\n')
fs.writeFileSync(path.join(dir,'index.html'),
 '<html lang="ru"><meta charset="utf-8"><style>body{font:14px Arial;background:#edf2fa;padding:20px}.clothing-source-picker{max-width:860px;background:white;padding:20px}'+css+'</style><div id="root"></div><script src="/app.js"></script><script>'+browser+'</script></html>')
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Chrome executable missing')
const http=spawn('python3',['-m','http.server','39024','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,650))
let result
try{result=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--virtual-time-budget=7500','--dump-dom','http://127.0.0.1:39024/index.html'],{encoding:'utf8',timeout:45000,maxBuffer:18*1024*1024})}finally{http.kill()}
assert.equal(result.status,0,'Chrome failed: '+String(result.stderr).slice(-1000))
const failed=result.stdout.match(/data-size-error="([^"]*)"/)?.[1]||'unknown'
assert.match(result.stdout,/data-size-pass="yes"/,'Size identity Chrome regression: '+failed)
console.log('MAIN_PICKER_SIZE_IDENTITIES_PASS: Standard, literal zero, empty size, exact source SKU pins, guarded search')

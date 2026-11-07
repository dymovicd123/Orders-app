import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'
import {createServer} from 'vite'

const stock={physical:2,reserved:0,cachedReserved:0,free:2,listed:true}
const base={category:'adult',gender:'ЖЕН',length:'СТАНДАРТ',salePrice:23000,warehouse:stock,boutique:stock}
const colors=['БЕЖЕВЫЙ','СЕРЫЙ','ЧЕРНЫЙ','БЕЛЫЙ','ХАКИ','СИНИЙ','ГОЛУБОЙ','КРАСНЫЙ']
const poncho=colors.map((color,index)=>({...base,variantId:8100+index,productId:80,productName:'БЕГІМ ПОНЧО',material:'СТАНДАРТ',color,size:'СТАНДАРТ'}))
poncho.push({...poncho[0],variantId:8109,size:'46'})
poncho.push({...poncho[0],variantId:8110,material:'ШЕРСТЬ',color:'БЕЖЕВЫЙ'})
poncho.push({...poncho[0],variantId:8111,material:'ШЕРСТЬ',color:'СЕРЫЙ'})
const manySizes=['42','44','46','48','50','52','54','56','58'].map((size,index)=>({...base,variantId:8200+index,productId:81,productName:'QA ШАПАН',material:'ЗАМША',color:'БЕЖЕВЫЙ',size}))
const simple=['42','44','46'].map((size,index)=>({...base,variantId:8300+index,productId:82,productName:'QA ЖИЛЕТ',material:'АТЛАС',color:index===2?'СЕРЫЙ':'БЕЖЕВЫЙ',size}))
const rows=[...poncho,...manySizes,...simple]
const vite=await createServer({configFile:'vite.config.ts',server:{middlewareMode:true},appType:'custom',logLevel:'error'})
try{
 const {clothingRefinementPlan}=await vite.ssrLoadModule('/src/features/orders/MainClothingSourcePicker.tsx')
 assert.deepEqual(clothingRefinementPlan(poncho.slice(0,9)).color,true,'8 colors in 9 SKUs must have color filter')
 assert.equal(clothingRefinementPlan(poncho.slice(0,9)).size,false,'only 2 sizes should not create a size filter')
 assert.equal(clothingRefinementPlan(poncho.slice(9)).visible,false,'two wool colors need no filter')
 assert.equal(clothingRefinementPlan(manySizes).size,true,'9 sizes in one color must have size filter')
 assert.equal(clothingRefinementPlan(manySizes).color,false,'one color should not have a color filter')
 assert.equal(clothingRefinementPlan(simple).visible,false,'tiny assortment must remain uncluttered')
}finally{await vite.close()}

const markup=[
 "import React from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {flushSync} from 'react-dom'",
 "import {MainClothingSourcePicker} from './src/features/orders/MainClothingSourcePicker.tsx'",
 'const rows='+JSON.stringify(rows)+';',
 "flushSync(()=>createRoot(document.getElementById('root')).render(React.createElement(MainClothingSourcePicker,{initialVariants:rows,allocated:new Map(),onCommit:()=>{},onManual:()=>{}})))"
].join('\n')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orders-adaptive-colors-'))
const bundle=await build({stdin:{contents:markup,loader:'jsx',resolveDir:process.cwd(),sourcefile:'adaptive-filter-check.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',jsx:'automatic',jsxImportSource:'react',logLevel:'error'})
fs.writeFileSync(path.join(dir,'app.js'),bundle.outputFiles.find(x=>x.path.endsWith('.js')).text)
const css=fs.readFileSync('src/styles/main-clothing-source-picker.css','utf8')
const browser=[
"const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));",
"const click=async el=>{if(!el)throw Error('Control absent');el.click();await wait(110)};",
"const model=name=>[...document.querySelectorAll('.clothing-source-model')].find(el=>el.textContent.includes(name));",
"const material=name=>[...document.querySelectorAll('.clothing-source-materials button')].find(el=>el.textContent.includes(name));",
"(async()=>{try{",
"await wait(220);",
"await click(model('БЕГІМ ПОНЧО'));await click(material('Стандарт'));",
"const filters=()=>document.querySelector('.clothing-source-refinements');",
"if(!filters())throw Error('Eight colors not offered a filter');",
"const color=filters().querySelector('select[aria-label=\"Фильтр по цвету\"]');",
"if(!color||filters().querySelector('select[aria-label=\"Фильтр по размеру\"]'))throw Error('Not adaptive to color-only assortment');",
"if(color.options.length!==9)throw Error('Not every color available in selector');",
"if(document.querySelectorAll('.clothing-source-color').length!==8)throw Error('Seventh/eighth colors hidden behind pointless extra click');",
"color.value='ГОЛУБОЙ';color.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);",
"if(document.querySelectorAll('.clothing-source-color').length!==1||!document.querySelector('.clothing-source-color')?.textContent.includes('ГОЛУБОЙ'))throw Error('Color selector not filtering');",
"await click(material('ШЕРСТЬ'));",
"if(filters())throw Error('Small 2-color execution should not show unused filters');",
"if(document.querySelectorAll('.clothing-source-color').length!==2)throw Error('Changed material retained old color filter');",
"await click(model('QA ШАПАН'));",
"if(!filters()?.querySelector('select[aria-label=\"Фильтр по размеру\"]'))throw Error('Nine sizes should offer size filter');",
"if(filters()?.querySelector('select[aria-label=\"Фильтр по цвету\"]'))throw Error('One color should not show color filter');",
"await click(model('QA ЖИЛЕТ'));",
"if(filters())throw Error('Small assortment shows unnecessary filters');",
"document.body.dataset.adaptivePass='yes';",
"}catch(error){document.body.dataset.adaptivePass='no';document.body.dataset.adaptiveError=String(error.message)}",
"})();"
].join('\n')
fs.writeFileSync(path.join(dir,'index.html'),'<html lang="ru"><meta charset="utf-8"><style>body{font:14px Arial;background:#eff4fb;padding:16px}.clothing-source-picker{max-width:900px;background:white;padding:22px}'+css+'</style><div id="root"></div><script src="/app.js"></script><script>'+browser+'</script></html>')
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Chrome browser required')
const http=spawn('python3',['-m','http.server','39030','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,650))
let run
try{run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--virtual-time-budget=6500','--dump-dom','http://127.0.0.1:39030/index.html'],{encoding:'utf8',timeout:45000,maxBuffer:18*1024*1024})}finally{http.kill()}
assert.equal(run.status,0,'Chrome failed '+String(run.stderr).slice(-900))
const reason=run.stdout.match(/data-adaptive-error="([^"]*)"/)?.[1]||'unknown'
assert.match(run.stdout,/data-adaptive-pass="yes"/,'Adaptive Chrome regression: '+reason)
console.log('ADAPTIVE_CLOTHING_FILTER_PASS: 8-color short material, 9-size material, tiny SKU families, selection and reset')

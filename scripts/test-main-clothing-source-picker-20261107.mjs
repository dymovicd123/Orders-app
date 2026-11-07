import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const stock=(physical,reserved=0,listed=true)=>({physical,reserved,cachedReserved:reserved,
 free:Math.max(0,physical-reserved),listed})
const rows=[
 {variantId:603,productId:1,productName:'БАЯН СҰЛУ ЖИЛЕТ',category:'adult',gender:'ЖЕН',
  material:'ДЖИНСА',color:'БЕЛЫЙ',length:'СТАНДАРТ',size:'44',salePrice:25000,
  warehouse:stock(2),boutique:stock(0,0,false)},
 {variantId:604,productId:1,productName:'БАЯН СҰЛУ ЖИЛЕТ',category:'adult',gender:'ЖЕН',
  material:'ДЖИНСА',color:'БЕЛЫЙ',length:'СТАНДАРТ',size:'46',salePrice:25000,
  warehouse:stock(0),boutique:stock(1)},
 {variantId:710,productId:1,productName:'БАЯН СҰЛУ ЖИЛЕТ',category:'adult',gender:'ЖЕН',
  material:'ЗАМША ВЕЛЮР',color:'СВЕТЛО-БЕЖЕВЫЙ',length:'ДЛИННЫЙ',size:'44',salePrice:24000,
  warehouse:stock(1),boutique:stock(0,0,false)},
 {variantId:711,productId:1,productName:'БАЯН СҰЛУ ЖИЛЕТ',category:'adult',gender:'ЖЕН',
  material:'ЗАМША ВЕЛЮР',color:'СВЕТЛО-БЕЖЕВЫЙ',length:'СТАНДАРТ',size:'44',salePrice:16000,
  warehouse:stock(1),boutique:stock(0,0,false)},
 {variantId:1003,productId:2,productName:'ҚОЗЫ КӨРПЕШ ЖИЛЕТ',category:'adult',gender:'МУЖ',
  material:'ЗАМША ВЕЛЮР',color:'БЕЖЕВЫЙ',length:'СТАНДАРТ',size:'54',salePrice:16000,
  warehouse:stock(0,0,false),boutique:stock(1)},
 {variantId:2000,productId:3,productName:'ТОВАР ТОЛЬКО В КАТАЛОГЕ',category:'adult',gender:'ЖЕН',
  material:'АТЛАС',color:'ЧЕРНЫЙ',length:'СТАНДАРТ',size:'42',salePrice:12000,
  warehouse:stock(0,0,false),boutique:stock(0,0,false)}
]
const app=fs.readFileSync('src/features/sections/CreateOrderSection.tsx','utf8')
assert(app.includes('<MainClothingSourcePicker'),'The live order form must use new picker')
assert(app.includes('onCommit={chooseVariant}'),'Exact variant must enter existing draft')
assert(app.includes('createDraft.payments.map'),'Existing payment rows must be preserved')
assert(app.includes('createOrderFromDraft'),'Server save must be reused')
const server=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {MainClothingSourcePicker,sourceModelCatalog,sourceColorGroups,sourceFree,formatClothingSize,
  parseClothingSearch,matchesClothingSize}=
  await server.ssrLoadModule('/src/features/orders/MainClothingSourcePicker.tsx')
 const standard={...rows[0],productId:51,variantId:1465,productName:'БЕГІМ ПОНЧО',
  material:'СТАНДАРТ',color:'БЕЖЕВЫЙ',length:'СТАНДАРТ',size:'СТАНДАРТ'}
 const sizeZero={...standard,variantId:1051,size:'0'}
 const noSize={...standard,variantId:1052,size:''}
 assert.equal(formatClothingSize(standard,[standard]),'Стандарт')
 assert.equal(formatClothingSize(noSize,[noSize]),'Без размера')
 assert.equal(formatClothingSize(sizeZero,[sizeZero,standard]),'0',
  'A genuine 0 must not turn into no-size when STANDARD SKU exists')
 assert.equal(formatClothingSize(sizeZero,[sizeZero]),'Без размера',
  'Isolated legacy 0 may use a human no-size label without mutating the SKU')
 const searchExactStandard=parseClothingSearch('Бегім пончо размер стандарт',['БЕЖЕВЫЙ'])
 const searchNoSize=parseClothingSearch('Бегім пончо без размера',['БЕЖЕВЫЙ'])
 const searchLooseStandard=parseClothingSearch('Бегім пончо стандарт',['БЕЖЕВЫЙ'])
 assert(searchExactStandard.modelTokens.length===2)
 assert(matchesClothingSize(standard,searchExactStandard,[standard,sizeZero,noSize]))
 assert(!matchesClothingSize(sizeZero,searchExactStandard,[standard,sizeZero,noSize]))
 assert(!matchesClothingSize(noSize,searchExactStandard,[standard,sizeZero,noSize]))
 assert(matchesClothingSize(noSize,searchNoSize,[standard,sizeZero,noSize]))
 assert(!matchesClothingSize(sizeZero,searchNoSize,[standard,sizeZero,noSize]),
  'Search no-size must not select competing literal 0')
 assert(!matchesClothingSize(standard,searchNoSize,[standard,sizeZero,noSize]))
 assert(matchesClothingSize(standard,searchLooseStandard,[standard,sizeZero,noSize]))
 assert.equal(standard.size,'СТАНДАРТ','Display/search must never mutate actual catalog size')

 // Warehouse/Boutique may hold an adult un-sized accessory using legacy literal "0".
 // This affects the label only. A genuine size zero with competing sizes stays zero.
 const collar={...rows[0],productId:54,variantId:1051,productName:'ВОРОТНИК',
  color:'ГОЛУБОЙ',material:'ДЖИНСА',length:'СТАНДАРТ',size:'0'}
 assert.equal(formatClothingSize(collar,[collar]),'Без размера')
 assert.equal(formatClothingSize(collar,[collar,{...collar,variantId:1052,size:'2'}]),'0')
 assert.equal(formatClothingSize({...collar,category:'child'},[collar]),'0')
 const warehouse=sourceModelCatalog(rows,'warehouse',false)
 assert.deepEqual(warehouse.map(x=>x.name),['БАЯН СҰЛУ ЖИЛЕТ'])
 assert.equal(warehouse[0].rows.length,4,'Zero-quantity source position stays in source catalogue')
 const boutique=sourceModelCatalog(rows,'boutique',false)
 assert.deepEqual(boutique.map(x=>x.name),['БАЯН СҰЛУ ЖИЛЕТ','ҚОЗЫ КӨРПЕШ ЖИЛЕТ'])
 assert.equal(sourceModelCatalog(rows,'warehouse',true).length,3,'Full catalogue is explicit opt-in')
 assert.equal(sourceColorGroups(rows.slice(2,4)).length,1,'Same color is grouped')
 assert.equal(sourceFree(rows[0],'warehouse',new Map([['warehouse:603',1]])),1)
 assert.equal(sourceFree(rows[0],'warehouse',new Map([['warehouse:603',2]]),{sourceType:'warehouse',catalogVariantId:603,quantity:2}),2)
 const html=renderToStaticMarkup(React.createElement(MainClothingSourcePicker,{
  initialVariants:rows,allocated:new Map(),onCommit:()=>{},onManual:()=>{}
 }))
 for(const text of ['БАЯН СҰЛУ ЖИЛЕТ','Склад','Бутик','Нужного варианта нет? Весь каталог']){
  assert(html.includes(text),'Missing source-scoped picker UX: '+text)
 }
 assert(!html.includes('ТОВАР ТОЛЬКО В КАТАЛОГЕ'),'Unlisted SKUs must be hidden by default')
}finally{await server.close()}

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Chrome required for real interaction check')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clothing-branch2-'))
const entry=[
 "import React from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {flushSync} from 'react-dom'",
 "import {MainClothingSourcePicker} from './src/features/orders/MainClothingSourcePicker.tsx'",
 'window.__sales=[]',
 'const props={initialVariants:'+JSON.stringify(rows)+',allocated:new Map(),',
 'onCommit:(choice,source,fields,insufficient)=>window.__sales.push({id:choice.variantId,source,fields,insufficient}),',
 'onManual:()=>window.__sales.push({manual:true})}',
 "flushSync(()=>createRoot(document.getElementById('root')).render(React.createElement(MainClothingSourcePicker,props)))"
].join('\n')
const built=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd(),sourcefile:'clothing-test.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',
 jsx:'automatic',jsxImportSource:'react',logLevel:'error'})
fs.writeFileSync(path.join(dir,'app.js'),built.outputFiles.find(x=>x.path.endsWith('.js')).text)
const css=fs.readFileSync('src/styles/main-clothing-source-picker.css','utf8')

const script=["const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));","const click=async el=>{if(!el)throw Error('Missing UI control');el.click();await wait(100)};","const names=()=>[...document.querySelectorAll('.clothing-source-model-body strong')].map(el=>el.textContent);","const search=async value=>{const el=document.querySelector('.clothing-source-search input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));await wait(90)};","(async()=>{try{","await wait(200);","if(names().length!==1||!names()[0].includes('БАЯН'))throw Error('Default source includes unlisted models');","await click(document.querySelector('.clothing-source-model'));","const materials=[...document.querySelectorAll('.clothing-source-materials button')];","if(materials.length!==2)throw Error('Material picker not available');","await click(materials.find(el=>el.textContent.includes('ЗАМША')));","const beige=[...document.querySelectorAll('.clothing-source-color')].find(el=>el.textContent.includes('СВЕТЛО-БЕЖЕВЫЙ'));","if(!beige)throw Error('Beige section missing');","const variations=[...beige.querySelectorAll('.clothing-source-size-row')];","if(variations.length!==2||!variations.some(el=>el.textContent.includes('ДЛИННЫЙ'))||!variations.some(el=>el.textContent.includes('Обычная длина')))throw Error('Length variants must be distinct');","await click(variations.find(el=>el.textContent.includes('ДЛИННЫЙ')).querySelector('.clothing-source-size'));","const inline=document.querySelector('form.clothing-source-inline');","if(!inline||!inline.textContent.includes('ДЛИННЫЙ'))throw Error('Full identity not shown before saving');","inline.requestSubmit();await wait(120);","if(window.__sales.length!==1||window.__sales[0].id!==710||window.__sales[0].source!=='warehouse')throw Error('Long SKU was not pinned');","await click(document.querySelector('.clothing-source-model.is-open'));","await click(document.querySelector('.clothing-source-model'));","await click([...document.querySelectorAll('.clothing-source-materials button')].find(el=>el.textContent.includes('ДЖИНСА')));","await click([...document.querySelectorAll('.clothing-source-size')].find(el=>el.textContent.trim().startsWith('46')));","const add=document.querySelector('.clothing-source-add');","if(!add||!add.textContent.includes('уточнением'))throw Error('Listed zero-stock SKU not allowed');","await click(add);","if(window.__sales.length!==2||window.__sales[1].id!==604||!window.__sales[1].insufficient)throw Error('Zero stock not safely added');","await click([...document.querySelectorAll('.clothing-source-tabs button')].find(el=>el.textContent==='Бутик'));","if(!names().some(x=>x.includes('ҚОЗЫ')))throw Error('Boutique stock missing');","await search('Козы Корпеш');","if(names().length!==1||!names()[0].includes('ҚОЗЫ'))throw Error('Kazakh model not found in Russian');","await search('');","await click(document.querySelector('.clothing-source-bottom button'));","if(!names().some(x=>x.includes('ТОВАР ТОЛЬКО В КАТАЛОГЕ')))throw Error('Explicit full catalog unavailable');","document.body.dataset.clothingPass='yes';","}catch(error){document.body.dataset.clothingPass='no';document.body.dataset.clothingError=String(error.message)}","})();"].join('\n')
fs.writeFileSync(path.join(dir,'index.html'),'<html lang="ru"><meta charset="utf-8"><style>body{font:14px Arial;background:#eef3f9;padding:15px}.clothing-source-picker{max-width:770px;background:white;padding:25px}'+css+'</style><div id="root"></div><script src="/app.js"></script><script>'+script+'</script></html>')
const http=spawn('python3',['-m','http.server','38928','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,650))
let result
try{result=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--virtual-time-budget=7500','--dump-dom','http://127.0.0.1:38928/index.html'],{encoding:'utf8',timeout:45000,maxBuffer:18*1024*1024})}finally{http.kill()}
assert.equal(result.status,0,'Chrome failed: '+String(result.stderr).slice(-1000))
const failure=result.stdout.match(/data-clothing-error="([^"]*)"/)?.[1]||''
assert.match(result.stdout,/data-clothing-pass="yes"/,'Browser acceptance failed: '+failure)
console.log('CLOTHING_SOURCE_CLIENT3_PASS: source scope, zero row, similar-length safety, exact SKU, Russian/Kazakh search')

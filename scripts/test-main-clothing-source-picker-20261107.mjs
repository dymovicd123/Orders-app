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
 const {MainClothingSourcePicker,sourceModelCatalog,sourceColorGroups,sourceFree}=
  await server.ssrLoadModule('/src/features/orders/MainClothingSourcePicker.tsx')
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
const script=String.raw
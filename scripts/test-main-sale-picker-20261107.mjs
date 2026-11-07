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

const app=fs.readFileSync('src/features/sections/CreateOrderSection.tsx','utf8')
assert(app.includes('<MainClothingSourcePicker'),'New sale UI must actually be rendered in Main order creator')
assert(app.includes('onCommit={chooseVariant}'),'Chosen variant must reach the existing order draft')
assert(app.includes('setEditingIndex(index)'),'User must be able to replace a line in place')
assert(app.includes('createOrderFromDraft'),'Existing server save flow must be preserved')
assert(app.includes('createDraft.payments.map'),'Multiple existing payments must be preserved')
assert(app.indexOf('Товары в заказе')<app.indexOf('Клиент и условия заказа'),
 'Product selection must precede customer and payment details')
assert(app.includes('onPendingChange={setPickerPending}'),
 'Incomplete variant editor must signal checkout blocking')
assert(app.includes('editingIndex!==null || pickerPending'),
 'Order cannot be saved while variant replacement is unfinished')

const server=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {MainSalePicker,parseSaleSearch,foldSaleName}=await server.ssrLoadModule('/src/features/orders/MainSalePicker.tsx')
 assert.equal(foldSaleName('ҚОЗЫ КӨРПЕШ'),'козы корпеш')
 assert.deepEqual(parseSaleSearch('Баян белый 44',['БЕЛЫЙ','ЧЕРНЫЙ']),
  {modelTokens:['баян'],size:'44',color:'БЕЛЫЙ',isChild:false})
 const mock={variantId:603,productId:1,productName:'БАЯН СҰЛУ ЖИЛЕТ',category:'adult',gender:'ЖЕН',
 color:'БЕЛЫЙ',material:'ДЖИНСА',length:'СТАНДАРТ',size:'44',salePrice:25000,
 warehouse:{physical:2,reserved:0,cachedReserved:0,free:2},
 boutique:{physical:0,reserved:0,cachedReserved:0,free:0}}
 const zero={...mock,variantId:937,size:'42',warehouse:{physical:0,reserved:0,cachedReserved:0,free:0}}
 const html=renderToStaticMarkup(React.createElement(MainSalePicker,{
  initialVariants:[mock,zero],allocated:new Map(),onCommit:()=>{},onManual:()=>{}
 }))
 for(const term of ['Модели одежды','Найти модель','БАЯН СҰЛУ ЖИЛЕТ','Индивидуальное изделие в Цех']){
  assert(html.includes(term),'Missing model-first UI: '+term)
 }
}finally{await server.close()}

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Chrome is required for interactive sale flow acceptance')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sale-picker-'))
const htmlFile=path.join(dir,'index.html')
const rows=[
 {variantId:603,productId:1,productName:'БАЯН СҰЛУ ЖИЛЕТ',category:'adult',gender:'ЖЕН',color:'БЕЛЫЙ',
  material:'ДЖИНСА',length:'СТАНДАРТ',size:'44',salePrice:25000,
  warehouse:{physical:2,reserved:0,cachedReserved:0,free:2},
  boutique:{physical:0,reserved:0,cachedReserved:0,free:0}},
 {variantId:937,productId:1,productName:'БАЯН СҰЛУ ЖИЛЕТ',category:'adult',gender:'ЖЕН',color:'БЕЛЫЙ',
  material:'ДЖИНСА',length:'СТАНДАРТ',size:'42',salePrice:25000,
  warehouse:{physical:0,reserved:0,cachedReserved:0,free:0},
  boutique:{physical:1,reserved:0,cachedReserved:0,free:1}},
 {variantId:1003,productId:2,productName:'ҚОЗЫ КӨРПЕШ ЖИЛЕТ',category:'adult',gender:'МУЖ',color:'БЕЖЕВЫЙ',
  material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',size:'46',salePrice:16000,
  warehouse:{physical:0,reserved:0,cachedReserved:0,free:0},
  boutique:{physical:0,reserved:0,cachedReserved:0,free:0}}
]
const entry=[
 "import React from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {flushSync} from 'react-dom'",
 "import {MainSalePicker} from './src/features/orders/MainSalePicker.tsx'",
 'window.__sales=[]',
 'const props={initialVariants:'+JSON.stringify(rows)+',allocated:new Map(),',
 'onCommit:(choice,source,fields,insufficient)=>window.__sales.push({id:choice.variantId,source,fields,insufficient}),',
 'onManual:()=>window.__sales.push({manual:true})}',
 "flushSync(()=>createRoot(document.getElementById('mount')).render(React.createElement(MainSalePicker,props)))"
].join('\n')
const built=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd(),sourcefile:'sale-test.jsx'},
 bundle:true,write:false,outdir:dir,format:'iife',platform:'browser',target:'chrome120',
 jsx:'automatic',jsxImportSource:'react',logLevel:'error'})
fs.writeFileSync(path.join(dir,'bundle.js'),built.outputFiles.find(x=>x.path.endsWith('.js')).text)
const css=fs.readFileSync('src/styles/main-sale-picker.css','utf8')
const test=String.raw`
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const input=(el,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
(async()=>{try{
 await pause(200);
 const model=document.querySelector('.main-sale-model');
 if(!model)throw Error('No model in list');
 model.click();await pause(100);
 const groups=document.querySelectorAll('.main-sale-combination');
 if(!groups.length)throw Error('Combinations missing');
 const size=[...document.querySelectorAll('.main-sale-size')].find(x=>x.textContent==='44');
 if(!size)throw Error('Size 44 is not visible');
 size.click();await pause(80);
 const source=document.querySelector('input[name=sale-source][value=warehouse]');
 if(!source)throw Error('Source picker missing after variant');
 source.click();
 const form=document.querySelector('.main-sale-stack form')||document.querySelector('form.main-sale-stack');
 if(!form)throw Error('Chosen SKU editor missing');
 form.requestSubmit();await pause(120);
 if(window.__sales.length!==1||window.__sales[0].id!==603||window.__sales[0].source!=='warehouse')throw Error('Exact SKU not saved');
 const search=document.querySelector('input[type=search]');
 if(!search)throw Error('Model search missing');
 input(search,'Козы Корпеш');await pause(130);
 const target=[...document.querySelectorAll('.main-sale-model')].find(x=>x.textContent.includes('ҚОЗЫ'));
 if(!target)throw Error('Kazakh name not found from Russian query');
 target.click();await pause(100);
 document.querySelector('.main-sale-size').click();await pause(80);
 document.querySelector('input[name=sale-source][value=warehouse]').click();await pause(30);
 const zeroSubmit=document.querySelector('button[type=submit]');
 if(!zeroSubmit.textContent.includes('уточнением'))throw Error('Zero stock is silently blocked or mislabeled');
 zeroSubmit.click();await pause(80);
 if(window.__sales.length!==2||window.__sales[1].id!==1003||!window.__sales[1].insufficient)throw Error('Zero-stock sale is not allowed');
 document.body.dataset.salePass='yes';
}catch(error){document.body.dataset.salePass='no';document.body.dataset.saleError=String(error.message)}
})();
`;
fs.writeFileSync(htmlFile,'<!doctype html><html lang="ru"><meta charset="utf-8"><style>body{font:14px Arial;padding:15px}'+css+
 '</style><div id="mount"></div><script src="/bundle.js"></script><script>'+test+'</script>')
const http=spawn('python3',['-m','http.server','38927','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,650))
let run
try{
 run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--virtual-time-budget=4000','--dump-dom','http://127.0.0.1:38927/index.html'],
  {encoding:'utf8',timeout:45000,maxBuffer:15*1024*1024})
}finally{http.kill()}
assert.equal(run.status,0,String(run.stderr).slice(-2000))
const failure=run.stdout.match(/data-sale-error="([^"]*)"/)?.[1]||''
assert.match(run.stdout,/data-sale-pass="yes"/,'Interactive sale flow failed: '+failure)
console.log('MAIN_SALE_PICKER_PASS: Russian/Kazakh search, exact SKU, zero-stock sale, parent draft wiring')

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {build} from 'esbuild'

const section=fs.readFileSync('src/features/sections/OrderEditorSection.tsx','utf8')
const utils=fs.readFileSync('src/app/utils.ts','utf8')
const app=fs.readFileSync('src/App.tsx','utf8')
assert(section.includes('itemizedMode&&<ItemizedOrderEditorWorkspace'),'Modern picker not mounted in order editor')
assert(section.includes('!itemizedMode&&<section className="mini-panel">'),'Old product fields not confined to legacy orders')
assert(section.includes('disabled={savingOrder||Boolean(itemizedMode&&itemPickerBlocking)}'),'Half-finished selection must block order save')
assert(utils.includes('catalogVariantId: Number(item.variantId || 0) || undefined'),'Existing SKU identity must survive hydration')
assert(app.includes('completeOrder = await fetchCompleteOrderForEditing(order)'),'Editor must fetch authoritative full order')
const stock=(qty,listed=true)=>({physical:qty,reserved:0,cachedReserved:0,free:qty,listed})
const make=(id,size)=>({
 variantId:id,productId:5,productName:'БАЯН СҰЛУ ШАПАН',category:'adult',
 gender:'ЖЕН',color:'БЕЖЕВЫЙ',material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',size,salePrice:27000,
 warehouse:stock(4),boutique:stock(0,false)
})
const variants=[make(101,'44'),make(102,'46'),make(103,'48'),make(104,'50'),make(105,'52'),make(106,'54'),make(107,'56'),make(108,'58')]
const items=[
 {orderItemId:301,catalogVariantId:101,productName:'БАЯН СҰЛУ ШАПАН',audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'БЕЖЕВЫЙ',material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',size:'44',quantity:1,unitPrice:27000,sourceType:'warehouse',catalogPriceSnapshot:27000,priceOrigin:'catalog'},
 {orderItemId:302,catalogVariantId:102,productName:'БАЯН СҰЛУ ШАПАН',audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'БЕЖЕВЫЙ',material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',size:'46',quantity:2,unitPrice:26000,sourceType:'boutique',catalogPriceSnapshot:27000,priceOrigin:'manual'}
]
const root=fs.mkdtempSync(path.join(os.tmpdir(),'branch2-editor-picker-'))
const fixture=[
 "import React,{useState} from 'react'",
 "import {createRoot} from 'react-dom/client'",
 "import {ItemizedOrderEditorWorkspace} from './src/features/orders/ItemizedOrderEditorWorkspace.tsx'",
 'const initial='+JSON.stringify({items,payments:[{id:991,amount:8000,method:'НАЛИЧКА',paymentDate:'2026-11-07',paymentKind:'primary'}]})+';',
 'const variants='+JSON.stringify(variants)+';',
 "window.__fetches=[];window.fetch=async url=>{window.__fetches.push(String(url));return {ok:true,json:async()=>({ok:true,variants})}};",
 "function View(){const [draft,setDraft]=useState(initial);const [blocked,setBlocked]=useState(false);window.__draft=draft;window.__blocked=blocked;",
 "const updateItem=(index,field,value)=>setDraft(current=>({...current,items:current.items.map((item,i)=>i===index?{...item,[field]:value}:item)}));",
 "const removeItem=(index)=>setDraft(current=>({...current,items:current.items.filter((_,i)=>i!==index)}));",
 "return <ItemizedOrderEditorWorkspace orderId={2202} draft={draft} setDraft={setDraft} updateItem={updateItem} removeItem={removeItem}",
 "saving={false} formatMoney={x=>String(x)+' ₸'} sourceLabel={x=>x==='warehouse'?'Склад':x==='boutique'?'Бутик':'Цех'}",
 "suggestions={{products:['БАЯН СҰЛУ ШАПАН'],colors:['БЕЖЕВЫЙ','НОВЫЙ ЦВЕТ'],materials:['ЗАМША ВЕЛЮР'],lengths:['СТАНДАРТ'],sizes:['44','46','48']}} onBlockedChange={setBlocked}/>}",
 "createRoot(document.getElementById('root')).render(<View/>);"
].join('\n')
const bundle=await build({stdin:{contents:fixture,sourcefile:'editor-qa.jsx',resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'browser',format:'iife',outdir:root,write:false,target:'chrome120',jsx:'automatic',logLevel:'error'})
for(const file of bundle.outputFiles){
 if(file.path.endsWith('.js'))fs.writeFileSync(path.join(root,'bundle.js'),file.contents)
 if(file.path.endsWith('.css'))fs.writeFileSync(path.join(root,'bundle.css'),file.contents)
}
const browser=[
 "const pause=n=>new Promise(resolve=>setTimeout(resolve,n));",
 "const hit=async node=>{if(!node)throw Error('Button missing');node.click();await pause(160)};",
 "const setValue=(node,value)=>{if(!node)throw Error('Input missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))};",
 "const pressText=(selector,word)=>[...document.querySelectorAll(selector)].find(x=>x.textContent.includes(word));",
 "(async()=>{try{",
 "await pause(650);",
 "if(document.querySelectorAll('.main-sale-basket-entry').length!==2)throw Error('Editor does not show existing basket');",
 "if(!document.querySelector('.clothing-source-picker'))throw Error('New order picker missing');",
 "await hit(document.querySelector('.main-sale-basket-entry .main-basket-actions button'));",
 "if(!document.querySelector('.itemized-editor-focus')||!window.__blocked)throw Error('Edit focus/block missing');",
 "const card=[...document.querySelectorAll('.clothing-source-size')].find(x=>x.getAttribute('aria-label')?.includes('Размер 48'));",
 "if(!card)throw Error('Exact size 48 not offered in existing model');",
 "await hit(card);await hit(pressText('.clothing-source-inline button[type=submit]','Сохранить изменение'));",
 "if(window.__draft.items[0].orderItemId!==301||window.__draft.items[0].catalogVariantId!==103||window.__draft.items[0].size!=='48'||window.__draft.items[0].unitPrice!==27000)throw Error('Replacement changed ID, SKU, size or sale price');",
 "if(window.__draft.items[1].orderItemId!==302||window.__draft.items[1].size!=='46'||window.__draft.items[1].sourceType!=='boutique'||window.__draft.payments[0].id!==991)throw Error('Other line or payment changed');",
 "await hit(document.querySelector('.main-sale-basket-entry .main-basket-editor summary'));",
 "const qty=document.querySelector('.main-sale-basket-entry .main-picked-order-fields input[type=number]');",
 "setValue(qty,'3');await pause(160);if(Number(window.__draft.items[0].quantity)!==3)throw Error('Quantity edit failed');",
 "await hit(pressText('.main-sale-basket-entry .main-basket-actions button','Указать вручную'));",
 "const modal=document.querySelector('[role=dialog]');if(!modal||!modal.textContent.includes('БАЯН СҰЛУ ШАПАН'))throw Error('Manual edit missing existing model');",
 "await hit(pressText('[role=dialog] button','Отмена'));",
 "if(window.__draft.items[0].catalogVariantId!==103||window.__draft.items.length!==2)throw Error('Cancel changed draft');",
 "if(window.__fetches.some(x=>x.includes('/api/orders/2202')))throw Error('Editor invoked an order mutation during draft editing');",
 "document.body.dataset.editorQa='pass';",
 "}catch(err){document.body.dataset.editorQa='fail';document.body.dataset.editorError=String(err.message)}})();"
].join('\n')
fs.writeFileSync(path.join(root,'index.html'),'<html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script><script>'+browser+'</script></html>')
const server=spawn('python3',['-m','http.server','38746','--bind','127.0.0.1','--directory',root],{stdio:'ignore'})
await new Promise(resolve=>setTimeout(resolve,700))
let result
try{result=spawnSync(process.env.CHROME_BIN||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--virtual-time-budget=9000','--dump-dom','http://127.0.0.1:38746/index.html'],{encoding:'utf8',timeout:45000,maxBuffer:18*1024*1024})}
finally{server.kill()}
assert.equal(result.status,0,'Chrome failed: '+String(result.stderr).slice(-700))
const error=result.stdout.match(/data-editor-error="([^"]+)"/)?.[1]||'unknown'
assert.match(result.stdout,/data-editor-qa="pass"/,'Editor browser acceptance failed: '+error)
console.log('BRANCH2_ITEMIZED_EDITOR_PICKER_PASS: exact SKU and original order-item ID preserved, no other line/payment mutation, quantity, manual cancel')

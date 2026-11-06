import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome'
assert(fs.existsSync(chrome),'Google Chrome is required for real CSS rendering acceptance')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-picker-visual-'))
const htmlFile=path.join(dir,'picker.html')
const screenshot=path.resolve('artifacts/main-order-picker-visual.png')
fs.mkdirSync(path.dirname(screenshot),{recursive:true})
const server=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true},logLevel:'error'})
try{
 const {MainOrderSourcePicker}=await server.ssrLoadModule('/src/features/orders/MainOrderSourcePicker.tsx')
 const variants=Array.from({length:97},(_,i)=>({
   variantId:i+1,productId:i+1,productName:'ШАПАН КАТАЛОГ '+String(i+1),
   category:'adult',gender:'ЖЕН',color:'СИНИЙ',material:'АТЛАС',length:'КОРОТКИЙ',size:'44',
   salePrice:45000,
   warehouse:{physical:30,reserved:10,cachedReserved:10,free:20},
   boutique:{physical:0,reserved:0,cachedReserved:0,free:0},
 }))
 const picker=renderToStaticMarkup(React.createElement(MainOrderSourcePicker,
    {initialVariants:variants,allocated:new Map(),onPick:()=>{},onManual:()=>{}}))
 const css=fs.readFileSync('src/styles/main-order-source-picker.css','utf8')
 const script=`const cards=[...document.querySelectorAll('.main-order-picker-product')];
  const heads=[...document.querySelectorAll('.main-order-picker-product-head')];
  const group=document.querySelector('.main-order-picker-groups');
  const first=heads[0];
  const firstStyle=getComputedStyle(first);
  const heights=heads.map(el=>Math.round(el.getBoundingClientRect().height));
  const names=heads.map(el=>(el.textContent||'').trim());
  const ok=cards.length===97 && heads.length===97
    && heights.every(h=>h>=60)
    && firstStyle.visibility==='visible'
    && firstStyle.display!=='none'
    && names.every(x=>x.includes('ШАПАН КАТАЛОГ'))
    && group.scrollHeight>group.clientHeight
    && group.clientHeight<=552;
  document.body.setAttribute('data-picker-visual-pass',ok?'yes':'no');
  document.body.setAttribute('data-picker-first-height',String(heights[0]));
  document.body.setAttribute('data-picker-last-height',String(heights[96]));
  document.body.setAttribute('data-picker-viewport',String(group.clientHeight));
  document.body.setAttribute('data-picker-scroll',String(group.scrollHeight));`
 fs.writeFileSync(htmlFile,`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
 body{margin:0;padding:25px;font-family:Arial,sans-serif;background:#eaf0f8;color:#233a55}
 .mock-order-card{max-width:1380px;margin:auto;padding:25px;background:white;border-radius:18px}
 ${css}
 </style></head><body><main class="mock-order-card"><h2>Товары в заказе</h2>${picker}</main><script>${script}</script></body></html>`)
 const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
   '--hide-scrollbars','--window-size=1440,900','--virtual-time-budget=200',
   '--screenshot='+screenshot,'--dump-dom','file://'+htmlFile]
 const r=spawnSync(chrome,args,{encoding:'utf8',timeout:45000,maxBuffer:15*1024*1024})
 assert.equal(r.status,0,'Browser exited '+r.status+' '+(r.stderr||'').slice(-1500))
 assert.match(r.stdout,/data-picker-visual-pass="yes"/,
   '97 product cards must retain readable content height in capped scroll container')
 assert(fs.statSync(screenshot).size>10000,'Browser screenshot missing')
 console.log('MAIN_PICKER_CHROME_VISUAL_PASS: 97 visible full-height cards; screenshot '+screenshot)
}finally{await server.close()}

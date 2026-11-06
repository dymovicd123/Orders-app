import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {watchRewriteChangesCanonicalSku} from '../../worker/domains/client3-watch-edit-attach.ts'

const read=path=>fs.readFileSync(path,'utf8')
const composition=read('src/features/client3/WatchAdminCompositionEditor.tsx')
const editor=read('src/features/client3/WatchOrderCorrections.tsx')
const pickerStyle=read('src/styles/client3-watch-source-picker.css')
const editorStyle=read('src/styles/client3-watch-unified-editor.css')
const server=read('worker/domains/client3-watch-admin-composition.ts')
const orderRead=read('worker/domains/client3-watch-orders-read.ts')
const orderWrite=read('worker/domains/orders-write.ts')

const prior=[{id:14,variantId:111,productId:20}]
const line={orderItemId:14,catalogVariantId:111,catalogProductId:20,
 watchVariantId:81,quantity:1,source:'office',unitPrice:1000,engravingText:''}
assert.equal(watchRewriteChangesCanonicalSku(prior,[line]),false)
assert.equal(watchRewriteChangesCanonicalSku(prior,[{...line,catalogVariantId:112}]),true,
 'Another color/bracelet variant of the SAME named model must rewrite its reservation')
assert.equal(watchRewriteChangesCanonicalSku(prior,[{...line,catalogProductId:21}]),true,
 'SKU changes to another model and brand must not be mistaken for price-only')
assert.equal(watchRewriteChangesCanonicalSku(prior,[{...line,orderItemId:null}]),true)
assert.equal(watchRewriteChangesCanonicalSku(prior,[line,line]),true)
assert(orderWrite.includes('watchRewriteChangesCanonicalSku'))

assert(composition.includes('className="main-watch-create watch-editor-composition"'))
assert(composition.includes('watch-pick-layout watch-editor-picker-layout'))
assert(composition.includes('watch-pick-cart-shell watch-editor-cart'))
assert(composition.includes('models.brand!==brand'))
assert(composition.includes('brand={brand}')&&composition.includes('catalog={catalog}'))
assert(pickerStyle.includes('.main-watch-create .watch-pick-models'))
assert(editorStyle.includes('.watch-editor-picker-layout'))
assert(editorStyle.includes('.watch-editor-step-grid'))
assert(editor.includes('Клиент и условия заказа'))
assert(editor.includes('Товары заказа')&&editor.includes('Менеджер и оплаты'))
assert(editor.includes('view="manager"')&&editor.includes('view="payment"')&&editor.includes('view="delete"'))
assert(editor.includes('Бренд')&&editor.includes('readOnly value={brand}'))
assert(server.includes('wp.brand_id=?')&&server.includes('watchBrandId'))
assert(orderRead.includes("'watchVariantId',wi2.watch_variant_id"))

const vite=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {WatchOrderCorrections}=await vite.ssrLoadModule('/src/features/client3/WatchOrderCorrections.tsx')
 const order={
  orderId:71,externalId:'TEST-71',orderDate:'2026-11-06',managerId:2,managerName:'QATEST',
  recipientName:'Test',recipientPhone:'777',city:'Алматы',deliveryMethod:'Курьер',
  canonicalCustomerName:'Test',canonicalCustomerPhone:'777',canonicalCity:'Алматы',
  canonicalDeliveryType:'Курьер',orderComment:'',shippingStatus:'not_sent',orderStatus:'active',
  deliveryAddress:'Адрес',postalCode:'050000',urgent:0,shippingDeadlineAt:'2026-11-07T12:00:00Z',
  totalAmount:1000,receivedAmount:500,debtAmount:500,returnAmount:0,
  committedReturnCount:0,paymentLines:'[]',
  itemLines:JSON.stringify([{id:1,productName:'ARYSTAN',quantity:1,unitPrice:1000,
    lineTotal:1000,source:'warehouse',engravingText:'',catalogPriceSnapshot:1000}]),
 }
 const admin=renderToStaticMarkup(React.createElement(WatchOrderCorrections,{
  brand:'TAUWACH',order,isAdmin:true,onDone:()=>{},onCancel:()=>{},
 }))
 assert(admin.includes('Клиент и условия заказа'))
 assert(admin.includes('Товары заказа')&&admin.includes('Менеджер и оплаты'))
 assert(admin.includes('Бренд заказа')&&admin.includes('TAUWACH'))
 assert(admin.includes('Сохранить изменения')&&admin.includes('Изменить состав'))
 assert(admin.includes('Проведённые оплаты'))
 const manager=renderToStaticMarkup(React.createElement(WatchOrderCorrections,{
  brand:'TAUWACH',order,isAdmin:false,onDone:()=>{},onCancel:()=>{},
 }))
 assert(!manager.includes('Изменить состав'))
 assert(!manager.includes('Сменить менеджера'))
 assert(!manager.includes('Гравировка / комментарий логисту'))
 assert(!manager.includes('Удалить заказ'))
 console.log('CLIENT3_EDITOR_CREATE_PARITY_BRAND_SKU_PASS')
}finally{await vite.close()}

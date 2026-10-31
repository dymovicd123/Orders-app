// Authenticated real-browser acceptance against temporary local workerd+D1 ONLY.
// No network calls to a live Branch2 or Main database; no production credentials.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {chromium} from 'playwright-core'

const origin='http://127.0.0.1:8798'
const browserPath=process.env.CHROME_PATH || ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync)
assert(browserPath,'Chrome executable unavailable in isolated runner')
const rootPassword='synthetic-bootstrap-ui-2026'
const login='b2uiadmin'
const password='synthetic-b2-ui-login-2026'
async function anonymousSetup(){
 const response=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({login,password,bootstrapLogin:'admin',bootstrapPassword:rootPassword,displayName:'Synthetic UI Admin'})})
 const data=await response.json()
 assert.equal(response.status,201,JSON.stringify(data))
}
await anonymousSetup()
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage']})
const context=await browser.newContext({viewport:{width:1500,height:950},locale:'ru-RU'})
const page=await context.newPage()
page.setDefaultTimeout(18000)
const failedResponses=[]
page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=500)failedResponses.push({url:r.url().split('?')[0],status:r.status()})})
async function api(route,method='GET',payload,expected=200){
 const r=await context.request.fetch(origin+route,{method,...(payload!==undefined?{data:payload}:{})})
 const d=await r.json().catch(()=>({}))
 assert.equal(r.status(),expected,method+' '+route+' '+JSON.stringify(d))
 return d
}
async function loginUi(){
 await page.goto(origin+'/#orders',{waitUntil:'domcontentloaded'})
 await page.locator('#auth-username').fill(login)
 await page.locator('#auth-password').fill(password)
 await page.locator('form.auth-card button[type="submit"]').click()
 await page.locator('main.erp-shell').waitFor({timeout:30000})
 assert(await page.locator('nav.erp-primary-nav a[href="#orders"]').count()>0)
 console.log('B2_UI_BROWSER_LOGIN_AUTH_OK')
}
async function openCreate(){
 await page.locator('nav.erp-primary-nav a[href="#orders"]').click()
 await page.locator('#orders-tabs').getByRole('button',{name:'Создать заказ'}).click()
 await page.locator('#create .order-line-card').first().waitFor()
}
async function fillOrder(name,phone){
 await openCreate()
 const create=page.locator('#create'), line=create.locator('.order-line-card').first()
 await create.locator('.manager-picker-trigger').click()
 await create.locator('.manager-picker-option:not(.is-clear)').first().click()
 await create.locator('input[placeholder*="+7"]').fill(phone)
 await line.locator('input[placeholder="Начните вводить товар"]').fill(name)
 const candidate=line.locator('.smart-picker-option').filter({hasText:name})
 await candidate.first().waitFor()
 await candidate.first().click()
 // Product picker should fill catalog-backed attributes without a manual
 // re-entry of known canonical color/material/size.
 const color=await line.locator('input[placeholder="Цвет"]').inputValue()
 const size=await line.locator('select').first().inputValue()
 assert.equal(color,'ЧЕРНЫЙ','Product picker must keep existing canonical color')
 assert.equal(size,'46','Product picker must keep existing canonical size')
 await line.locator('input[placeholder="Введите итоговую цену"]').fill('10000')
 const save=create.getByRole('button',{name:'Сохранить заказ'})
 assert.equal(await save.isDisabled(),false,'UI must allow submit with available manager')
 const responseWait=page.waitForResponse(r=>r.url().split('?')[0]===origin+'/api/orders'&&r.request().method()==='POST',{timeout:30000})
 await save.click()
 const response=await responseWait
 const responseData=await response.json().catch(()=>({}))
 assert.equal(response.status(),201,'UI save '+JSON.stringify(responseData))
 assert(responseData.orderId>0,JSON.stringify(responseData))
 const payload=JSON.parse(response.request().postData()||'{}')
 const requestKey=response.request().headers()['x-idempotency-key']||payload.requestId
 assert(requestKey,'UI POST must carry stable idempotency key')
 console.log('B2_UI_BROWSER_SAVED',JSON.stringify({id:responseData.orderId,key:requestKey,phone,color,size}))
 return {id:responseData.orderId,key:requestKey,payload}
}
async function validateRetry(created){
 const replay=await context.request.post(origin+'/api/orders',{data:created.payload,headers:{'X-Idempotency-Key':created.key}})
 const parsed=await replay.json().catch(()=>({}))
 assert([200,201].includes(replay.status()),'Retry HTTP '+replay.status()+': '+JSON.stringify(parsed))
 assert.equal(parsed.orderId,created.id,'Same UI request key must resolve same order ID')
}
try{
 await loginUi()
 const name='CI B2 AUTHENTICATED UI ITEM'
 const product=await api('/api/catalog/products','POST',{name,category:'adult',genderScope:'female'},201)
 const productId=Number(product.id)
 const variant=await api('/api/catalog/variants','POST',{
  productId,category:'adult',gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:'46'
 },201)
 const variantId=Number(variant.id)
 assert(variantId>0)
 await page.reload({waitUntil:'domcontentloaded'})
 await page.locator('main.erp-shell').waitFor({timeout:30000})
 const pending=await fillOrder(name,'77019999101')
 await validateRetry(pending)
 await api('/api/inventory/movements?returnInventory=0','POST',{
  requestId:'b2-ui-native-one-arrival-20261031',inventorySource:'warehouse',movementType:'arrival',
  items:[{productId,variantId,productName:name,gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'СТАНДАРТ',
   length:'СТАНДАРТ',size:'46',quantity:1}]
 },201)
 const active=await fillOrder(name,'77019999102')
 await validateRetry(active)
 const pendingAgain=await fillOrder(name,'77019999103')
 await validateRetry(pendingAgain)
 assert.equal(new Set([pending.id,active.id,pendingAgain.id]).size,3)
 assert.equal(failedResponses.length,0,JSON.stringify(failedResponses))
 console.log('BRANCH2_AUTHENTICATED_BROWSER_CREATE_3_ORDERS_PASS',JSON.stringify({
  pending:pending.id,active:active.id,pendingAgain:pendingAgain.id,variantId
 }))
}catch(error){
 console.error('BRANCH2_AUTHENTICATED_BROWSER_UI_FAIL',String(error?.stack||error))
 console.error('CURRENT_UI',JSON.stringify({url:page.url(),title:await page.title().catch(()=>''),alert:(await page.locator('.app-alert').allTextContents().catch(()=>[])).slice(0,8),buttons:(await page.locator('button').allTextContents().catch(()=>[])).slice(0,35)}))
 await page.screenshot({path:'/tmp/branch2-ui-failure.png',fullPage:true}).catch(()=>{})
 throw error
}finally{await browser.close()}

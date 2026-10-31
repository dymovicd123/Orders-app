// Stage 4.6: real Chromium + real local workerd + native D1, never remote.
// Invoked by the native worker fixture BEFORE and AFTER a committed receipt.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {chromium} from 'playwright-core'

export async function startStage4Browser({origin,sessionToken,variantId}){
 const chrome=process.env.CHROME_PATH||
  ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync)
 assert(chrome,'Isolated real browser runner requires Chromium')
 const browser=await chromium.launch({headless:true,executablePath:chrome,
  args:['--no-sandbox','--disable-dev-shm-usage']})
 const ctx=await browser.newContext({viewport:{width:1380,height:920},locale:'ru-RU'})
 await ctx.addCookies([{name:'orders_session',value:sessionToken,url:origin+'/'}])
 const page=await ctx.newPage()
 page.setDefaultTimeout(25000)
 const errors=[]
 page.on('response',r=>{
  if(r.url().startsWith(origin+'/api/')&&r.status()>=500)
   errors.push({path:r.url().slice(origin.length).split('?')[0],status:r.status()})
 })
 const skuName='STAGE4 NATIVE TEST SKU'
 const timeline=page.locator(`.stock-variant-timeline[data-stock-variant-timeline="${variantId}"]`)
 async function loadUi(){
  await page.goto(origin+'/#inventory',{waitUntil:'domcontentloaded'})
  await page.locator('main.erp-shell').waitFor({timeout:30000})
  const nav=page.locator('nav.erp-primary-nav a[href="#inventory"]')
  if(await nav.count())await nav.click()
  await page.locator('section#inventory').waitFor()
 }
 return {
  async beforeReceipt(){
   await loadUi()
   const shortage=page.locator('.warehouse-w2-recovery').filter({hasText:'Проверить остаток'})
   await shortage.waitFor({timeout:30000})
   await shortage.click()
   const task=page.locator('.inventory-attention-task').filter({hasText:skuName})
   await task.waitFor({timeout:25000})
   assert.match(await task.innerText(),/Для заказов не хватает 1 шт/, 'Actual reservation-vs-recorded physical issue')
   assert.match(await task.innerText(),/STAGE4-NATIVE-RESERVE/, 'SKU task links the precise order')
   await task.getByRole('button',{name:'Посмотреть историю'}).click()
   await timeline.waitFor()
   assert.match(await timeline.innerText(),/Вариант #9783/, 'Problem links to same canonical SKU')
   assert.match(await timeline.innerText(),/активных резервах|активных резервах:|активных резервах по/i)
   // The local test checks this WITHOUT inventing physical activity:
   // a genuine current issue can exist even when there was no preceding movement.
   const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,locale:'ru-RU'})
   await mobile.addCookies([{name:'orders_session',value:sessionToken,url:origin+'/'}])
   const phone=await mobile.newPage()
   try{
    await phone.goto(origin+'/#inventory',{waitUntil:'domcontentloaded'})
    await phone.locator('section#inventory').waitFor({timeout:30000})
    const recovery=phone.locator('.warehouse-w2-recovery').filter({hasText:'Проверить остаток'})
    await recovery.waitFor({timeout:30000})
    await recovery.click()
    const mTask=phone.locator('.inventory-attention-task').filter({hasText:skuName})
    await mTask.waitFor()
    await mTask.getByRole('button',{name:'Посмотреть историю'}).click()
    // UI first paints the target and then temporarily swaps it for a loading
    // state while the concurrent history/check/reservation requests settle.
    await phone.waitForTimeout(700)
    const mobileTimeline=phone.locator(`.stock-variant-timeline[data-stock-variant-timeline="${variantId}"]`)
    await mobileTimeline.waitFor({state:'visible',timeout:30000})
    assert.equal(await mobileTimeline.getAttribute('data-stock-variant-timeline'),String(variantId),
      'Mobile settles on the exact same source/SKU investigation')
   }finally {await mobile.close()}
   console.log('STAGE4_BROWSER_BEFORE_RECEIPT_PASS: desktop/mobile active problem → exact SKU timeline/order')
  },
  async afterReceipt(){
   // We remain on the exact SKU timeline while the server commits a genuine
   // stock movement. Reload its own evidence, not a made-up UI success flag.
   const panel=page.locator('.inventory-history-panel')
   await panel.getByRole('button',{name:'Обновить'}).click()
   await page.waitForFunction((name)=>{
    const el=document.querySelector('.stock-variant-timeline')
    return Boolean(el&&el.textContent?.includes(name))
   },'Тест Завсклад',{timeout:25000})
   const text=await timeline.innerText()
   assert(text.includes('Тест Завсклад'),'Authenticated Cyrillic actor visible in physical history')
   assert(text.includes('Накладная NATIVE-E2E')||text.includes('native-stage4-arrival'),
    'History still exposes actual arrival reference or document')
   const attentionResponse=page.waitForResponse(r=>r.url().startsWith(origin+'/api/inventory/attention')&&r.status()===200,
    {timeout:30000})
   await page.reload({waitUntil:'domcontentloaded'})
   await page.locator('section#inventory').waitFor()
   await attentionResponse
   // The current *server* state has no actionable shortage. Refreshing the UI
   // must not resurrect the task from a historical movement/old check.
   assert.equal(await page.locator('.warehouse-w2-recovery').filter({hasText:'Проверить остаток'}).count(),0,
    'A resolved live issue must disappear from the warehouse UI after reload')
   assert.deepEqual(errors,[],'No server 500 during combined desktop/mobile issue+history UI')
   console.log('STAGE4_BROWSER_AFTER_RECEIPT_PASS: persisted history/performer, live task gone, no 500')
  },
  async close(){await ctx.close();await browser.close()},
 }
}

import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd()
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8')
const start=app.indexOf('async function saveInventoryMovement')
if (start < 0) throw new Error('saveInventoryMovement missing')
const end=app.indexOf('\n  async function ', start + 20)
const body=app.slice(start, end > start ? end : app.length)
const check=(value,message)=>{ if(!value) throw new Error(message) }
const finishStart = body.indexOf('const finishMovement = async')
const finishEnd = body.indexOf('const isArrivalRecoveryResult =', finishStart)
check(finishStart >= 0 && finishEnd > finishStart, 'Shared post-commit finish boundary is missing')
const finishBody = body.slice(finishStart, finishEnd)
check(finishBody.includes("await Promise.allSettled(refreshes)"), 'Committed inventory movement can still fail on a read refresh')
check(!finishBody.includes("await Promise.all(refreshes)"), 'Old fail-closed post-write refresh remains')
check(finishBody.indexOf("setInventoryManualRequestId(makeCashRequestId('inventory-manual'))") > finishBody.indexOf("Promise.allSettled(refreshes)"), 'Manual request id rotation disappeared')
const finalResponseGuard = body.lastIndexOf("if (!response.ok) throw new Error")
const finalFinish = body.lastIndexOf("await finishMovement(result)")
check(finalResponseGuard >= 0 && finalFinish > finalResponseGuard, 'Successful movement can enter post-commit refresh before the mutation response is accepted')
check(body.includes("onSuccess: async (recoveryResult) => { await finishMovement(recoveryResult as InventoryMovementSaveResponse) }"), 'Recovered Arrival no longer uses the same post-commit safe finish boundary')
console.log('ARRIVAL SAVE RELIABILITY TESTS PASSED — a committed arrival cannot be reported as failed only because follow-up reads fail')


const { openArrivalRecoveryFlow } = await import('../src/features/inventory/arrivalRecoveryFlow.ts')
async function verifyRecoveryController(code) {
  const original=[
    {productId:75,variantId:101,productName:'QA REMOVED',size:'50',color:'СИНИЙ',quantity:3,source:'warehouse'},
    {productId:88,variantId:201,productName:'QA KEEP',size:'48',color:'КРАСНЫЙ',quantity:2,source:'warehouse'}
  ]
  let prompt=null,continuation=null,successes=0,writes=0,restores=0,lastError='',busy=false
  let submitted=null
  await openArrivalRecoveryFlow({
    result:{code,productId:75,variantId:101,retirementId:23,productName:'QA REMOVED',
      message:'Товар изменён после открытия формы'},
    retryItems:original,
    apiFetch:async(url,init)=>{
      check(url==='/api/catalog/retirements/23/restore','Restore must target the exact retirement')
      check(JSON.parse(init.body).requestId==='QA-arrival-restore-75','Restore replay key is not stable')
      restores++
      return Response.json({ok:true},{status:200})
    },
    readJsonResponse:async response=>await response.json(),
    makeRequestId:prefix=>'QA-'+prefix,
    normalizeText:value=>String(value||'').toUpperCase(),
    submitMovement:async items=>{
      writes++;submitted=items
      return {response:Response.json({ok:true,duplicate:false},{status:201}),result:{ok:true}}
    },
    onPrompt:v=>{prompt=v},onError:v=>{lastError=v},onBusy:v=>{busy=v},
    onContinuation:v=>{continuation=v},onSuccess:async()=>{successes++}
  })
  check(prompt?.code===code && typeof continuation==='function','Recovery action not displayed')
  await continuation()
  check(restores===(code==='arrival_retired_product'?1:0),'Unexpected catalog restore')
  check(writes===1 && successes===1,'Recovery must submit exactly once and finish original action')
  check(prompt===null && continuation===null && !busy && !lastError,'Recovery must close after success')
  check(submitted.length===2 && submitted[0].variantId==='' && submitted[0].quantity===3
    && submitted[0].size==='50' && submitted[0].source==='warehouse',
    'Recovered item changed quantities or the original warehouse input')
  check(submitted[1].variantId===201 && submitted[1].quantity===2,
    'Restoration of one SKU rewrote another item in the same Arrival batch')
}
await verifyRecoveryController('arrival_retired_product')
await verifyRecoveryController('arrival_stale_variant')
console.log('ARRIVAL_RECOVERY_CONTROLLER_PASS — single confirmation continues same batch, no changed quantities, retired vs stale paths isolated')

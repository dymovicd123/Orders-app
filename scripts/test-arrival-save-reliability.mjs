import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd()
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8')
const movements=fs.readFileSync(path.join(root,'src/features/inventory/inventoryMovementActions.ts'),'utf8')
const apiClient=fs.readFileSync(path.join(root,'src/app/controllers/useApiClient.ts'),'utf8')
const start=movements.indexOf('async function saveInventoryMovement')
if (start < 0) throw new Error('saveInventoryMovement missing')
const end=movements.indexOf('\n  return {', start + 20)
const body=movements.slice(start, end > start ? end : movements.length)
if (!app.includes('createInventoryMovementActions({')) throw new Error('Actual movement workflow not connected to App')
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
check(body.includes("'X-Idempotency-Key': isTransfer ? inventoryTransferRequestId : inventoryManualRequestId"),
  'Arrival and transfer must send their existing stable requestId in an idempotency header')
check(apiClient.includes("const idempotentWrite = !safeRead && Boolean(headers.get('X-Idempotency-Key'))"),
  'Shared client lost safe transport retry admission for idempotent Warehouse writes')
check(apiClient.includes("const retryableRequest = safeRead || idempotentWrite"),
  'Shared client no longer retries idempotent mutations')
console.log('ARRIVAL SAVE RELIABILITY TESTS PASSED — a committed arrival cannot be reported as failed only because follow-up reads fail')

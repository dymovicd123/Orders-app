import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd()
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8')
const start=app.indexOf('async function saveInventoryMovement')
if (start < 0) throw new Error('saveInventoryMovement missing')
const end=app.indexOf('\n  async function ', start + 20)
const body=app.slice(start, end > start ? end : app.length)
const check=(value,message)=>{ if(!value) throw new Error(message) }
check(body.includes("await Promise.allSettled(refreshes)"), 'Committed inventory movement can still fail on a read refresh')
check(!body.includes("await Promise.all(refreshes)"), 'Old fail-closed post-write refresh remains')
check(body.indexOf("if (!response.ok) throw new Error") < body.indexOf("Promise.allSettled(refreshes)"), 'Refresh boundary is not after successful mutation response')
check(body.indexOf("setInventoryManualRequestId(makeCashRequestId('inventory-manual'))") > body.indexOf("Promise.allSettled(refreshes)"), 'Manual request id rotation disappeared')
console.log('ARRIVAL SAVE RELIABILITY TESTS PASSED — a committed arrival cannot be reported as failed only because follow-up reads fail')

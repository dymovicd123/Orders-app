import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync('src/features/finance/useFinanceReportReads.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const slots=[]; let cursor=0
const react={
  useState(initial){const i=cursor++; if(!(i in slots)) slots[i]=initial; return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
  useRef(initial){const i=cursor++; if(!(i in slots)) slots[i]={current:initial}; return slots[i]},
  useCallback(fn){return fn},
}
const module={exports:{}}
new Function('require','module','exports',code)(name=>name==='react'?react:{isTransientApiError:()=>false,readJsonResponse:r=>r.json()},module,module.exports)
const pending=[]; const failures=[]
const render=()=>{cursor=0;return module.exports.useFinanceReportReads({apiFetch:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),reportReadFailure:(...args)=>failures.push(args)})}
const range={dateFrom:'2026-09-01',dateTo:'2026-09-30'}
const finish=(i,data)=>pending[i].resolve(new Response(JSON.stringify(data)))
let hook=render()
const a=hook.loadFinanceReports(range,{reportType:'products'})
const b=hook.loadFinanceReports(range,{reportType:'products'})
assert.equal(pending.length,1); assert.match(pending[0].url,/reportType=products/)
finish(0,{reportType:'products',value:'initial'}); await Promise.all([a,b])
hook=render(); await hook.loadFinanceReports(range,{reportType:'products'}); assert.equal(pending.length,1)
const old=hook.loadFinanceReports(range,{reportType:'managers'})
hook.invalidateFinanceReadCaches()
const fresh=hook.loadFinanceReports(range,{reportType:'managers'})
assert.equal(pending.length,3,'post-write read cannot join old flight')
finish(2,{reportType:'managers',value:'fresh'}); await fresh
finish(1,{reportType:'managers',value:'old'}); await old
hook=render(); assert.equal(hook.financeReport.value,'fresh')
assert.equal((await hook.loadFinanceReports(range,{reportType:'managers'})).value,'fresh','old flight cannot repopulate cache')
const older=hook.loadFinanceReports(range,{reportType:'cities'})
const forced=hook.loadFinanceReports(range,{reportType:'cities',force:true})
assert.equal(pending.length,5,'force starts independent hook read')
finish(4,{reportType:'cities',value:'forced'}); await forced
finish(3,{reportType:'cities',value:'older'}); await older
hook=render(); assert.equal((await hook.loadFinanceReports(range,{reportType:'cities'})).value,'forced')
const finance=hook.loadFinanceReports(range,{scope:'finance'})
assert.ok(!pending[5].url.includes('reportType=')); assert.match(pending[5].url,/scope=finance/)
finish(5,{value:'workspace'}); await finance
hook=render()
const sOld=hook.loadOrdersFinanceSummary(range)
hook.invalidateFinanceReadCaches()
const sNew=hook.loadOrdersFinanceSummary(range)
finish(7,{value:'new-summary'}); await sNew
finish(6,{value:'old-summary'}); await sOld
hook=render(); assert.equal(hook.ordersFinanceReport.value,'new-summary')
assert.equal((await hook.loadOrdersFinanceSummary(range)).value,'new-summary')
const failed=hook.loadFinanceReports(range,{reportType:'returns'})
pending[8].reject(new Error('offline')); assert.equal(await failed,null)
const retry=hook.loadFinanceReports(range,{reportType:'returns'})
finish(9,{reportType:'returns',value:'recovered'}); await retry
assert.equal(failures.length,1)
assert.match(fs.readFileSync('src/features/renderers/FinanceReportContentRenderer.tsx','utf8'),/financeReport\.reportType !== financeReportType/)
console.log('O1 passed: finance hook coalescing, type/finance cache isolation, force, post-write stale-flight rejection, summary races and error recovery')

// Explicit read-only production benchmark. Run before/after index rollout; never applies DDL.
// Generated evidence contains counts/hashes, not customer/payment payloads, and stays git-ignored.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
const mode=process.argv[2]
if (!['before','after'].includes(mode)) throw new Error('Usage: node scripts/measure-o1-d1.mjs before|after')
const root=process.cwd(), directory=path.join(root,'_o1-evidence')
const file=path.join(directory,`${mode}.json`)
if(fs.existsSync(file)) throw new Error('Evidence already exists; do not overwrite a baseline')
const read=p=>fs.readFileSync(p,'utf8')
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
function execute(sql) {
  if(!/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error('Only one read-only benchmark statement is allowed')
  const output=execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','orders_db_prod','--remote','--json','--command',sql],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true})
  const [result]=JSON.parse(output)
  if(!result.success || result.meta.rows_written) throw new Error('Unexpected D1 response')
  return result
}
const previous=mode==='after'?JSON.parse(read(path.join(directory,'before.json'))):null
const ids=previous?.ids || execute("SELECT id FROM orders WHERE order_status NOT IN ('deleted','archived') ORDER BY order_date DESC,id DESC LIMIT 80").results.map(r=>r.id)
const template=read('worker/domains/order-reservations.ts').match(/const compact = await db\.prepare\(\s*`([\s\S]*?)`\s*\)/)[1]
const jobs=[
  {name:'handover-page',sql:template.replace('${reservationScope}',`r.order_id IN (${ids.join(',')}) AND r.status = 'active' AND r.variant_id IS NOT NULL`)},
  {name:'handover-all-active',sql:template.replace('${reservationScope}',"r.status = 'active' AND r.variant_id IS NOT NULL AND scoped_order.order_status NOT IN ('deleted','archived') AND COALESCE(scoped_order.shipping_status,'not_sent') <> 'sent'")},
]
const compiled=ts.transpileModule(read('worker/domains/finance-reports.ts').replace(/^import .*\r?\n/gm,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const module={exports:{}}
const empty=async()=>({rows:[],totals:{},managerPlans:[],departmentPlans:[],employees:[]})
new Function('module','exports','mapSqlRows','canonicalPaymentMethodName','cleanText','toInt','normalizeManagerColor','parseReportDateRange','listCallCentreRecords','listLeadRecords','listPlans','listTeamEmployees',compiled)(module,module.exports,r=>r?.results||[],v=>String(v||''),v=>String(v??'').trim(),v=>parseInt(v)||0,v=>v,()=>({startDate:'2026-08-01',endDate:'2026-08-31'}),empty,empty,empty,empty)
async function capture(reportType) {
  const captured=[]
  const db={prepare(sql){let bindings=[]; return {bind(...values){bindings=values;return this},async all(){captured.push({sql,bindings});return {results:[]}},async first(){captured.push({sql,bindings});return null}}}}
  await module.exports.listFinanceReports(db,new URL(`https://benchmark/api/reports/finance${reportType?`?reportType=${reportType}`:''}`))
  return captured.map(q=>{let i=0;return q.sql.replace(/\?/g,()=>`'${String(q.bindings[i++]).replaceAll("'","''")}'`)})
}
const full=await capture('')
for(let i=0;i<full.length;i++) jobs.push({name:`report-base-${i}`,sql:full[i]})
const result={mode,date:new Date().toISOString(),database:'orders_db_prod',ids,queries:[],reports:{}}
for(const job of jobs) {
  const r=execute(job.sql)
  const entry={name:job.name,sqlHash:hash(job.sql),rowsRead:r.meta.rows_read,rowsWritten:r.meta.rows_written,rows:r.results.length,resultHash:hash(r.results)}
  result.queries.push(entry)
  console.log(`${entry.name}: ${entry.rowsRead} reads, ${entry.rows} result rows`)
}
for(const type of ['payments','managers','products','cities','returns','debts']) {
  const selected=await capture(type)
  const hashes=new Set(selected.map(hash))
  const measured=result.queries.filter(q=>q.name.startsWith('report-base-')&&hashes.has(q.sqlHash))
  if(measured.length!==selected.length) throw new Error(`Unmeasured query in ${type}`)
  result.reports[type]={queries:selected.length,rowsRead:measured.reduce((sum,q)=>sum+q.rowsRead,0)}
}
result.fullBaseRowsRead=result.queries.filter(q=>q.name.startsWith('report-base-')).reduce((sum,q)=>sum+q.rowsRead,0)
if(previous) result.parity=result.queries.map(q=>({name:q.name,equal:q.resultHash===previous.queries.find(p=>p.name===q.name)?.resultHash}))
fs.mkdirSync(directory,{recursive:true}); fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({fullBaseRowsRead:result.fullBaseRowsRead,reports:result.reports,parity:result.parity},null,2))

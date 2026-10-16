// Read-only production D1 schema/constraints for adding two missing color references.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
const cfg=process.env.PROD_READONLY_CONFIG
assert(cfg&&fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
function read(sql){
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'))
 const r=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+sql,'--json'],{encoding:'utf8',maxBuffer:12*1024*1024,timeout:90000}))
 assert(r.length===1&&r[0].success===true&&Array.isArray(r[0].results))
 return r[0].results
}
const table=read("SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('reference_values','catalog_variants') ORDER BY name")
const constraints=read("SELECT type,tbl_name,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name IN ('reference_values','catalog_variants') AND sql IS NOT NULL ORDER BY tbl_name,type,name")
const sample=read("SELECT * FROM reference_values WHERE kind='color' ORDER BY id DESC LIMIT 9")
const allColor=read("SELECT id,kind,value,is_active FROM reference_values WHERE kind='color' ORDER BY id")
const variants=read("SELECT id,color,updated_at,product_id,stock_position_id,size_label,is_active FROM catalog_variants WHERE is_active=1 AND color IN ('ТЕМНО СЕРЫЙ','ТЕМНО БОРДОВЫЙ') ORDER BY id")
assert.equal(variants.length,23,'Expected 23 active source variants')
const result={table,constraints,sample,related:allColor.filter(x=>/СЕР|БОРД|АСФАЛЬТ|ТЕМН/i.test(x.value)),referenceCount:allColor.length,sourceVariants:variants.map(v=>({id:v.id,color:v.color,hasTimestamp:Boolean(v.updated_at)})),sourceCount:variants.length}
console.log('MISSING_REF_SCHEMA_PREFLIGHT='+JSON.stringify(result))
console.log('MISSING_REF_SCHEMA_READONLY_SUCCESS')

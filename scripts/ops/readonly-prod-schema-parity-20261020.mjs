// Production schema parity audit. Strict SELECT only, no user-data rows.
// Compares live production table structures with local fresh-install assumptions.
// Never runs a mutation or prints any order/payment/customer values.
import {execFileSync} from 'node:child_process'
const select=q=>{
  if(!/^SELECT\s/i.test(q)||/\b(UPDATE|DELETE|INSERT|ALTER|DROP|CREATE|REPLACE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i.test(q)||q.includes(';'))throw Error('SELECT-only schema audit refused command')
  const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod',
    '--remote','--config','wrangler.jsonc','--command',q,'--json'],
    {encoding:'utf8',timeout:120000,maxBuffer:10*1024*1024})
  const result=JSON.parse(raw)
  if(result.some(x=>x.success!==true))throw Error('Production schema read failed')
  return result.flatMap(x=>x.results||[])
}
for(const name of ['orders','managers','order_manager_audit']){
 const cols=select("SELECT name,type,\"notnull\",dflt_value,pk FROM pragma_table_info('"+name+"') ORDER BY cid")
 const schema=select("SELECT sql FROM sqlite_master WHERE type='table' AND name='"+name+"'")
 console.log('SCHEMA_ONLY_'+name.toUpperCase()+' '+JSON.stringify({sql:schema[0]?.sql||null,columns:cols}))
}
for(const table of ['app_users','attendance_days','exchanges','lead_records','order_manager_audit']){
 const fks=select("SELECT id,seq,\"table\",\"from\",\"to\",on_update,on_delete FROM pragma_foreign_key_list('"+table+"') ORDER BY id,seq")
 console.log('SCHEMA_ONLY_FK_'+table.toUpperCase()+' '+JSON.stringify(fks))
}
const managerIndexes=select("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='managers' AND sql IS NOT NULL ORDER BY name")
const auditIndexes=select("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='order_manager_audit' AND sql IS NOT NULL ORDER BY name")
console.log('SCHEMA_ONLY_INDEXES '+JSON.stringify({managers:managerIndexes,order_manager_audit:auditIndexes}))
console.log('PRODUCTION_SCHEMA_PARITY_SELECT_ONLY_DONE')

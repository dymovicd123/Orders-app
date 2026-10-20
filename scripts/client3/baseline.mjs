import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// For a brand-new tenant, old D1 migrations must NOT be replayed against a live
// Cloudflare database: some historical ALTER/PRAGMA/BEGIN statements are forbidden
// by D1 (SQLITE_AUTH). Materialize the final *empty* schema in offline SQLite,
// then emit one D1-compatible clean baseline with generic reference settings only.
const quote=x=>"'"+String(x??'').replaceAll("'","''")+"'"
const formatSql=s=>String(s).trim().replace(/;+\s*$/,'')+';\n'
function ownObjects(db){
 const types=db.prepare('PRAGMA table_list').all()
 const shadows=new Set(types.filter(x=>x.type==='shadow').map(x=>x.name))
 const objects=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
 const shouldInclude=x=>!shadows.has(x.name)&&!shadows.has(x.tbl_name)&&x.name!=='d1_migrations'
 const tables=objects.filter(x=>x.type==='table'&&shouldInclude(x))
 const ordinary=tables.filter(x=>!/^CREATE\s+VIRTUAL\s+TABLE/i.test(x.sql))
 const virtual=tables.filter(x=>/^CREATE\s+VIRTUAL\s+TABLE/i.test(x.sql))
 const other=(type)=>objects.filter(x=>x.type===type&&shouldInclude(x))
 return {ordinary,virtual,indexes:other('index'),views:other('view'),triggers:other('trigger')}
}
function schemaNames(o) {
 return Object.values(o).flatMap(a=>a.map(x=>x.type+':'+x.name)).sort()
}
export function consolidateMigrations(directory,filenames){
 const source=new DatabaseSync(':memory:')
 let rebuilt
 try{
  for(const filename of filenames){
   const body=fs.readFileSync(path.join(directory,filename),'utf8')
   try{source.exec(body)}catch(e){throw Error('Offline baseline source '+filename+' failed: '+e)}
  }
  const bad=source.prepare('PRAGMA foreign_key_check').all()
  if(bad.length)throw Error('Historical schema itself has '+bad.length+' FK errors')
  const o=ownObjects(source)
  const ref=source.prepare('SELECT kind,value,is_active,sort_order FROM reference_values ORDER BY kind,sort_order,id').all()
  const settings=source.prepare('SELECT key,value FROM app_settings ORDER BY key').all()
  const seeded=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  const permitted=new Set(['reference_values','app_settings'])
  const metaSeeds=[]
  let workshopCaptureSeed=null
  // Historic spellings learned for the old customer's product characteristics
  // are not identities of the new tenant. Deliberately do not seed these aliases.
  const oldTenantAliases=new Set(['catalog_value_aliases','catalog_input_aliases'])
  const shadow=new Set(source.prepare('PRAGMA table_list').all().filter(x=>x.type==='shadow').map(x=>x.name))
  for(const {name} of seeded){
   if(permitted.has(name)||shadow.has(name)||name.startsWith('_')||oldTenantAliases.has(name))continue
   const row=source.prepare('SELECT COUNT(*) AS n FROM "'+name.replaceAll('"','""')+'"').get()
   if(!row.n)continue
   if(name==='workshop_settlement_capture_control'){
     const control=source.prepare('SELECT id, enabled FROM workshop_settlement_capture_control').all()
     if(control.length!==1 || Number(control[0].id)!==1 || Number(control[0].enabled)!==0)
       throw Error('Fresh Client3 must not activate Workshop payment accrual.')
     workshopCaptureSeed=control
     continue
   }
   if(/^[a-z0-9_]+_meta$/.test(name)){
     const fields=source.prepare('PRAGMA table_info("'+name+'")').all().map(x=>x.name)
     if(JSON.stringify(fields.slice(0,3))!==JSON.stringify(['key','value','updated_at']) || row.n>50)
       throw Error('Unexpected populated feature metadata layout: '+name)
     metaSeeds.push({name,rows:source.prepare('SELECT key,value,updated_at FROM "'+name+'" ORDER BY key').all()})
     continue
   }
   throw Error('Unexpected customer/business seed in fresh migration '+name+': '+row.n)
  }
  if(!ref.length)throw Error('Reference dropdowns are missing')
  const ddl=[
   '-- Isolated third tenant, clean immutable schema. Generated offline from reviewed migrations.',
   '-- No old-client users, managers, products, orders, stock, reserves or payments.',
   '-- NEVER apply to main or branch2. Apply only to a brand-new Client3 D1.',
   'PRAGMA foreign_keys=ON;',
   ...o.ordinary.map(x=>formatSql(x.sql)),
   ...o.virtual.map(x=>formatSql(x.sql)),
   ...o.indexes.map(x=>formatSql(x.sql)),
   ...o.views.map(x=>formatSql(x.sql)),
   ...o.triggers.map(x=>formatSql(x.sql)),
   'INSERT INTO reference_values(kind,value,is_active,sort_order) VALUES',
   ref.map(x=>'  ('+[quote(x.kind),quote(x.value),Number(x.is_active),Number(x.sort_order)].join(',')+')').join(',\n')+';',
   'INSERT INTO app_settings(key,value) VALUES',
   settings.map(x=>'  ('+[quote(x.key),quote(x.value)].join(',')+')').join(',\n')+';',
   ...(workshopCaptureSeed?['INSERT INTO workshop_settlement_capture_control(id,enabled) VALUES (1,0);']:[]),
   ...metaSeeds.flatMap(({name,rows})=>[
     'INSERT INTO "'+name+'"(key,value,updated_at) VALUES',
     rows.map(x=>'  ('+[quote(x.key),quote(x.value),quote(x.updated_at)].join(',')+')').join(',\n')+';'
   ]),
   ''
  ].join('\n')
  if(/\b(?:BEGIN|COMMIT|ROLLBACK)\s+(?:TRANSACTION|WORK)\b|\bPRAGMA\s+(?:foreign_keys\s*=\s*OFF|legacy_alter_table)/i.test(ddl))
   throw Error('Consolidated baseline contains forbidden D1 migration directives')
  rebuilt=new DatabaseSync(':memory:')
  try{rebuilt.exec(ddl)}catch(e){throw Error('Generated Client3 clean schema not replayable: '+e)}
  const actualNames=schemaNames(ownObjects(rebuilt))
  const expectedNames=schemaNames(o)
  if(JSON.stringify(actualNames)!==JSON.stringify(expectedNames))
   throw Error('Consolidated Client3 schema object list changed: expected '+expectedNames.length+', got '+actualNames.length)
  if(rebuilt.prepare('PRAGMA foreign_key_check').all().length)
   throw Error('Consolidated Client3 baseline violates FK')
  if(rebuilt.prepare('SELECT COUNT(*) AS n FROM reference_values').get().n!==ref.length)
   throw Error('Consolidated Client3 dropdown references changed')
  if(rebuilt.prepare('SELECT COUNT(*) AS n FROM app_settings').get().n!==settings.length)
   throw Error('Consolidated Client3 generic settings changed')
  if(workshopCaptureSeed && (rebuilt.prepare('SELECT enabled FROM workshop_settlement_capture_control WHERE id=1').get()?.enabled)!==0)
    throw Error('Client3 Workshop capture control baseline changed.')
  for(const {name,rows} of metaSeeds){
    const count=rebuilt.prepare('SELECT COUNT(*) AS n FROM "'+name+'"').get().n
    if(count!==rows.length)throw Error('Consolidated feature flag metadata changed for '+name)
  }
  const baseline='0001_client3_clean_baseline.sql'
  for(const name of filenames)fs.rmSync(path.join(directory,name))
  fs.writeFileSync(path.join(directory,baseline),ddl,{flag:'wx'})
  console.log('Client3 consolidated offline '+filenames.length+' historic migrations -> '+baseline+'; user tables '+o.ordinary.length+'; indexes '+o.indexes.length+'; generic references '+ref.length+'; settings '+settings.length)
  return [baseline]
 }finally{
  rebuilt?.close()
  source.close()
 }
}

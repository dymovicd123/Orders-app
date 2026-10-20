import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
export const PROTECTED_DATABASE_IDS=new Set([
 '17e68a41-1d58-4a36-8a63-47c3e32443c4', // main / live customer
 '40065052-854e-44b8-bcd5-251bdd488301', // branch2 / separate test customer
])
const MIGRATION_PATTERN=/^\d{4}.*\.sql$/
const KNOWN_OLD_MANAGERS=['СЫМБАТ','АСЕЛЬ','ГАЗИЗА','ГУЛНУР','ЖАНЕРКЕ','МАКПАЛ','САИДА']
const PRODUCTS_SEED=/INSERT\s+INTO\s+catalog_products\s*\(name,\s*category,\s*is_active,\s*created_at,\s*updated_at\)\s*VALUES[\s\S]*?ON\s+CONFLICT\s*\(name\)\s*DO\s+UPDATE\s+SET[\s\S]*?updated_at\s*=\s*excluded\.updated_at\s*;/gi
const SEED=/INSERT\s+INTO\s+managers\s*\(name,\s*is_active,\s*created_at,\s*updated_at\)\s*VALUES[\s\S]*?ON\s+CONFLICT\s*\(name\)\s*DO\s+UPDATE\s+SET[\s\S]*?updated_at\s*=\s*excluded\.updated_at\s*;/gi

export function prepareMigrations(directory,root=ROOT){
 const source=path.join(root,'migrations')
 if(fs.existsSync(directory))throw Error('Client3 output folder already exists. Do not overwrite existing migration plans.')
 fs.mkdirSync(directory,{recursive:true})
 let patched=0
 const files=fs.readdirSync(source).filter(f=>MIGRATION_PATTERN.test(f)).sort()
 if(files.length<110)throw Error('Unexpectedly incomplete migration collection: '+files.length)
 for(const filename of files){
   const body=fs.readFileSync(path.join(source,filename),'utf8')
   let copy=body
   if(filename==='0002_reference_values.sql'){
     const matches=[...body.matchAll(SEED)]
     if(matches.length!==1)throw Error('Initial manager seed changed: manual review required.')
     if(KNOWN_OLD_MANAGERS.some(name=>!matches[0][0].includes("'"+name+"'")))throw Error('Old manager seed identity unexpectedly changed.')
     const productMatches=[...body.matchAll(PRODUCTS_SEED)]
     if(productMatches.length!==1 || !productMatches[0][0].includes("'БАЯН СҰЛУ ШАПАН'"))
       throw Error('Default old-customer catalog seed has changed: manual review required.')
     copy=body.replace(SEED,'-- Client3: old-customer manager roster omitted; staff are added by admin.')
       .replace(PRODUCTS_SEED,'-- Client3: old-customer product catalog omitted; products are added by admin.')
     patched+=2
   }else if(/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+managers\s*\([^)]*\)\s*VALUES\b/i.test(body)){
     throw Error('Another migration now seeds managers: '+filename)
   }
   fs.writeFileSync(path.join(directory,filename),copy)
 }
 if(patched!==2)throw Error('Legacy manager and product seeds must each be removed once.')
 const after=fs.readFileSync(path.join(directory,'0002_reference_values.sql'),'utf8')
 if(KNOWN_OLD_MANAGERS.some(name=>after.includes("'"+name+"'"))||after.includes("'БАЯН СҰЛУ ШАПАН'"))throw Error('Old-customer business data leaked to clean migrations.')
 return files
}

export function validateConfigInput(worker,database,id) {
 if(!/^orders-app-client3-[a-z0-9][a-z0-9-]{2,36}$/.test(worker))throw Error('Third Worker must have its own orders-app-client3-... name.')
 if(!/^orders_db_client3_[a-z0-9][a-z0-9_]{2,36}$/.test(database))throw Error('Third DB must have its own orders_db_client3_... name.')
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('A REAL, newly created D1 UUID is required.')
 if(PROTECTED_DATABASE_IDS.has(id.toLowerCase()))throw Error('REFUSED: the supplied D1 is main or branch2.')
 if(worker.includes('branch2')||database.includes('branch2')||worker==='orders-app')throw Error('REFUSED: protected existing Worker.')
 const main=fs.readFileSync(path.join(ROOT,'wrangler.jsonc'),'utf8')
 if(main.includes('"name": "'+worker+'"')||main.includes('"database_name": "'+database+'"'))throw Error('REFUSED: attempted to reuse main resource name.')
}

export function renderConfig(worker,database,id) {
 validateConfigInput(worker,database,id)
 return JSON.stringify({
   $schema:'node_modules/wrangler/config-schema.json',
   name:worker,
   main:'worker/index.ts',
   compatibility_date:'2026-07-06',
   compatibility_flags:['nodejs_compat'],
   vars:{CLIENT3_INSTALLATION:'1'},
   d1_databases:[{binding:'DB',database_name:database,database_id:id,migrations_dir:'.client3-migrations'}],
   assets:{directory:'./dist/client',not_found_handling:'single-page-application',run_worker_first:['/api/*']},
   observability:{enabled:true},
   upload_source_maps:true
 },null,2)+'\n'
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,worker,database,id]=process.argv.slice(2)
 if(mode==='--prepare-migrations'){
   const output=path.join(ROOT,'.client3-migrations')
   const files=prepareMigrations(output)
   console.log('Prepared '+files.length+' client3 schema migrations, excluding old staff seeds. No D1 access.')
 }else if(mode==='--configure'){
   if(!worker||!database||!id)throw Error('Usage: node scripts/client3/prepare.mjs --configure <worker-name> <db-name> <new-d1-uuid>')
   const config=renderConfig(worker,database,id)
   const file=path.join(ROOT,'wrangler.client3.json')
   if(fs.existsSync(file))throw Error('Client3 config already exists: refuse overwrite.')
   fs.writeFileSync(file,config,{flag:'wx',mode:0o600})
   console.log('Created isolated client3 config: '+worker+' -> '+database+'; no deployment, no D1 writes.')
 }else if(mode==='--validate'){
   const file=path.join(ROOT,'wrangler.client3.json')
   const data=JSON.parse(fs.readFileSync(file,'utf8'))
   renderConfig(data.name,data.d1_databases?.[0]?.database_name,data.d1_databases?.[0]?.database_id)
   if(data.d1_databases?.length!==1||data.d1_databases[0].binding!=='DB'||data.d1_databases[0].migrations_dir!=='.client3-migrations')throw Error('Invalid third DB binding.')
   console.log('Isolated client3 config validated. No D1 access.')
 }else throw Error('Modes: --prepare-migrations, --configure, --validate')
}

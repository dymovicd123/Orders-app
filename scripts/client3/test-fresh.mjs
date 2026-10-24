import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { prepareMigrations, renderConfig, validateConfigInput } from './prepare.mjs'

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orders-client3-fresh-'))
let db
try {
 const migrations=prepareMigrations(path.join(temp,'migrations'))
 db=new DatabaseSync(':memory:')
 for (const filename of migrations) {
   try { db.exec(fs.readFileSync(path.join(temp,'migrations',filename),'utf8')) }
   catch (error) { throw Error('Fresh Client3 schema failed at '+filename+': '+String(error)) }
 }
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
 const fk=db.prepare('PRAGMA foreign_key_check').all()
 assert.equal(fk.length,0,'Fresh schema foreign keys must be consistent')
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name))
 const mustExist=['orders','order_items','payments','returns','return_items','catalog_products','catalog_variants',
   'inventory_stock','inventory_movements','inventory_reservations','workshop_tasks','app_users','app_sessions',
   'reference_values','managers','financial_events','critical_operations','auth_audit_log']
 for(const table of mustExist)assert(tables.has(table),'Missing core table in fresh schema: '+table)
 const businessTables=[
   'managers','customers','orders','order_items','payments','returns','return_items',
   'exchanges','exchange_items','catalog_products','catalog_variants','inventory_stock',
   'inventory_movements','inventory_reservations','workshop_tasks','app_users','app_sessions',
   'financial_events','auth_audit_log','critical_operations','inventory_operations',
   'inventory_stock_checks','inventory_operation_evidence',
 ]
 for(const table of businessTables){
   if(!tables.has(table))continue
   const count=db.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').get().n
   assert.equal(count,0,'A supposedly empty Client3 DB contains migrated customer/business data in '+table)
 }
 const refCount=db.prepare('SELECT COUNT(*) AS n FROM reference_values').get().n
 assert(refCount>0,'New deployment needs generic dropdown references')
 const newId='c9d59670-3a4c-4bc4-8bd3-302a969cc64f'
 const config=JSON.parse(renderConfig('orders-app-client3-old-client','orders_db_client3_old_client',newId))
 assert.equal(config.d1_databases.length,1)
 assert.equal(config.d1_databases[0].database_name,'orders_db_client3_old_client')
 assert.equal(config.d1_databases[0].migrations_dir,'.client3-migrations')
 assert(!JSON.stringify(config).includes('orders_db_prod'))
 for(const [worker,database,id] of [
 ['orders-app','orders_db_client3_old_client',newId],
 ['orders-app-branch2','orders_db_client3_old_client',newId],
 ['orders-app-client3-old-client','orders_db_prod',newId],
 ['orders-app-client3-old-client','orders_db_client3_old_client','17e68a41-1d58-4a36-8a63-47c3e32443c4'],
 ['orders-app-client3-old-client','orders_db_client3_old_client','40065052-854e-44b8-bcd5-251bdd488301'],
 ['orders-app-client3-old-client','orders_db_client3_old_client','not-a-real-db-id'],
 ]) assert.throws(()=>validateConfigInput(worker,database,id))
 const router=fs.readFileSync('worker/index.ts','utf8')
 assert(router.includes('getCurrentAuthUser(env.DB, request)'),'New client should not expose orders without login')
 assert(router.includes("if (!authUser) return json({ ok: false, message: 'Войдите в систему.' }, { status: 401 });"))
 assert(router.includes("url.pathname === '/api/auth/setup'"),'New empty instance must allow secure initial admin setup')
 console.log('CLIENT3_EMPTY_FRESH_SCHEMA_PASSED: '+migrations.length+' consolidated clean migrations; core tables empty; '+refCount+' generic reference values; FK ok; main/branch2 isolation and authentication confirmed')
}finally {
 db?.close()
 fs.rmSync(temp,{recursive:true,force:true})
}

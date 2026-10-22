// One-off immutable SELECT-only diagnostic of Ethno Cardigan price rows.
// Never prints credential values or customer/order records. NEVER modifies D1.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const branch = 'audit/read-only-ethno-cost-20261022'
if (process.env.GITHUB_REF_NAME !== branch) throw new Error('Wrong ref: diagnostic must be on isolated audit branch')
if (process.env.GITHUB_REPOSITORY !== 'dymovicd123/Orders-app') throw new Error('Wrong repository')
const config = readFileSync('wrangler.jsonc','utf8')
if (!config.includes('"name": "orders-app"')
  || !config.includes('"database_name": "orders_db_prod"')
  || !config.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"')
  || config.includes('orders_db_branch2')) throw new Error('Production D1 identity mismatch')

const temp=mkdtempSync(join(tmpdir(),'ethno-cost-readonly-'))
const branch2Cfg=join(temp,'branch2-readonly.jsonc')
const cfg2=config
  .replace('"name": "orders-app"', '"name": "orders-app-branch2"')
  .replace('"database_name": "orders_db_prod"', '"database_name": "orders_db_branch2"')
  .replace('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"', '"database_id": "40065052-854e-44b8-bcd5-251bdd488301"')
if (!cfg2.includes('"database_name": "orders_db_branch2"')
  || !cfg2.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"')
  || cfg2.includes('orders_db_prod')) throw new Error('Branch2 read-only D1 identity mismatch')
writeFileSync(branch2Cfg,cfg2)

function readOnly(db,cfg,query) {
  // The only database operations in this file are strictly fixed SELECT statements.
  if (!/^\s*SELECT\s/i.test(query)) throw new Error('Only SELECT is permitted')
  if (/;|\b(UPDATE|INSERT|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|TRIGGER)\b/i.test(query))
    throw new Error('Unsafe SQL rejected')
  const raw=execFileSync('npx',['wrangler','d1','execute',db,'--remote','--config',cfg,'--command='+query,'--json'],
    {encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024})
  const pages=JSON.parse(raw)
  if (!Array.isArray(pages)||pages[0]?.success!==true||!Array.isArray(pages[0].results))
    throw new Error('Unexpected D1 response')
  return pages[0].results
}
const productWhere="(p.name LIKE '%ЭТНО%' OR p.name LIKE '%Этно%' OR p.name LIKE '%этно%') AND (p.name LIKE '%КАРДИГАН%' OR p.name LIKE '%кардиган%')"
const priceQuery=`SELECT p.id AS product_id,p.name AS product,sp.id AS execution_id,sp.material,sp.length,
 sp.is_active AS execution_active,ep.category,ep.cost_price,ep.sale_price,ep.created_at,ep.updated_at
 FROM catalog_products p JOIN catalog_stock_positions sp ON sp.product_id=p.id
 LEFT JOIN catalog_execution_prices ep ON ep.stock_position_id=sp.id
 WHERE ${productWhere} ORDER BY p.id,sp.id,ep.category LIMIT 60`
const variantQuery=`SELECT p.name AS product,v.material,v.length,v.category,COUNT(*) AS variants,
 SUM(CASE WHEN v.is_active=1 THEN 1 ELSE 0 END) AS active_variants
 FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id
 WHERE ${productWhere}
 GROUP BY p.name,v.material,v.length,v.category ORDER BY p.name,v.material,v.length,v.category LIMIT 60`
const tableQuery="SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%price%' OR name LIKE '%cost%' OR name LIKE '%audit%') ORDER BY name LIMIT 70"
const coverageQuery="SELECT COUNT(*) AS all_price_rows,COALESCE(SUM(CASE WHEN cost_price IS NOT NULL THEN 1 ELSE 0 END),0) AS priced_cost_rows,COALESCE(SUM(CASE WHEN sale_price IS NOT NULL THEN 1 ELSE 0 END),0) AS priced_sale_rows,COALESCE(SUM(CASE WHEN cost_price IS NULL AND sale_price IS NULL THEN 1 ELSE 0 END),0) AS empty_both_rows FROM catalog_execution_prices"
const woolCoverageQuery="SELECT COUNT(*) AS wool_price_rows,COALESCE(SUM(CASE WHEN ep.cost_price IS NOT NULL THEN 1 ELSE 0 END),0) AS wool_cost_rows FROM catalog_execution_prices ep JOIN catalog_stock_positions sp ON sp.id=ep.stock_position_id WHERE sp.material='ШЕРСТЬ'"
const productPriceCoverageQuery="SELECT COUNT(DISTINCT p.id) AS products_with_any_price,COUNT(DISTINCT ep.stock_position_id) AS executions_with_price FROM catalog_execution_prices ep JOIN catalog_stock_positions sp ON sp.id=ep.stock_position_id JOIN catalog_products p ON p.id=sp.product_id"
const oldPriceBackupCheck="SELECT name FROM sqlite_master WHERE type='table' AND name='_branch2_catalog_price_backup_20260926'"
const backupQuery="SELECT product_name,material,length,category,cost_price,sale_price,created_at,updated_at FROM _branch2_catalog_price_backup_20260926 WHERE product_name LIKE '%ЭТНО%' AND product_name LIKE '%КАРДИГАН%' ORDER BY material,length,category LIMIT 60"

for (const [label,db,cfg] of [
  ['PRODUCTION','orders_db_prod','wrangler.jsonc'],
  ['BRANCH2 (independent historical comparison)','orders_db_branch2',branch2Cfg],
]) {
  console.log('ENV='+label)
  console.log('PRICE_ROWS='+JSON.stringify(readOnly(db,cfg,priceQuery)))
  console.log('VARIANT_SUMMARY='+JSON.stringify(readOnly(db,cfg,variantQuery)))
  console.log('PRICE_OR_AUDIT_TABLE_NAMES='+JSON.stringify(readOnly(db,cfg,tableQuery)))
  console.log('CATALOG_PRICE_COVERAGE='+JSON.stringify(readOnly(db,cfg,coverageQuery)))
  console.log('WOOL_PRICE_COVERAGE='+JSON.stringify(readOnly(db,cfg,woolCoverageQuery)))
  console.log('PRICED_CATALOG_SCOPE='+JSON.stringify(readOnly(db,cfg,productPriceCoverageQuery)))
  const hasBackup=readOnly(db,cfg,oldPriceBackupCheck).length>0
  console.log('SEPTEMBER_26_PRICE_BACKUP_EXISTS='+hasBackup)
  if (hasBackup) console.log('SEPTEMBER_26_PRICE_BACKUP_ROWS='+JSON.stringify(readOnly(db,cfg,backupQuery)))
}
console.log('ETHNO_COST_READONLY_COMPLETE: no D1 mutations')

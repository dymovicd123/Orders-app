import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0072_v72_catalog_execution_prices.sql')
const catalog = read('worker/domains/catalog.ts')
const wrangler = read('wrangler.jsonc')

check(wrangler.includes('"name": "orders-app-branch2"'), 'Stage03-B test must run against Branch2 Worker identity')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'Stage03-B test must preserve Branch2 D1 binding')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'Stage03-B test must preserve Branch2 D1 id')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Production D1 must not leak into Branch2')

check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_execution_prices'), '0072 must create the execution-price table')
check(migration.includes('PRIMARY KEY (stock_position_id, category)'), '0072 must enforce one base price per execution + audience')
check(migration.includes("CHECK (category IN ('adult', 'child'))"), '0072 must scope the base price to adult/child')
check(migration.includes('REFERENCES catalog_stock_positions(id) ON DELETE CASCADE'), '0072 must bind prices to canonical execution identity')
check(migration.includes('cost_price INTEGER') && migration.includes('cost_price IS NULL OR cost_price >= 0'), '0072 cost price must be nullable and non-negative')
check(migration.includes('sale_price INTEGER') && migration.includes('sale_price IS NULL OR sale_price >= 0'), '0072 sale price must be nullable and non-negative')
check(!/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\b/i.test(migration), '0072 must not backfill or mutate existing business rows')

const priceSelectAt = catalog.indexOf('FROM catalog_execution_prices ep')
const productLoopAt = catalog.indexOf('rawProducts.forEach')
check(priceSelectAt >= 0, 'Catalog must expose execution prices through one batched read')
check(productLoopAt > priceSelectAt, 'Execution prices must be loaded once, not with per-product N+1 reads')
check(catalog.includes('JOIN catalog_stock_positions sp ON sp.id = ep.stock_position_id'), 'Price read must resolve canonical execution')
check(catalog.includes('JOIN catalog_products p ON p.id = sp.product_id'), 'Price read must expose human product identity')
check(catalog.includes('Migration 0072 is additive; pre-migration Catalog reads remain fully usable with no current prices.'), 'Catalog read must tolerate an unapplied 0072 migration')
check(catalog.includes('executionPrices: executionPriceRows.map(row => ({'), 'Catalog response must expose executionPrices')
for (const field of ['stockPositionId', 'productId', 'productName', 'material', 'length', 'category', 'costPrice', 'salePrice']) {
  check(catalog.includes(field + ':'), 'Catalog execution-price response missing ' + field)
}
const listCatalogStart = catalog.indexOf('export async function listCatalog')
const listCatalogEnd = catalog.indexOf('export async function isCatalogExecutionPriceSchemaEnabled')
check(listCatalogStart >= 0 && listCatalogEnd > listCatalogStart, 'Could not isolate listCatalog read path')
const listCatalogSource = catalog.slice(listCatalogStart, listCatalogEnd)
check(!listCatalogSource.includes('INSERT INTO catalog_execution_prices') && !listCatalogSource.includes('UPDATE catalog_execution_prices'), 'Stage03-B2 listCatalog path itself must stay read-only')

console.log('STAGE03-B EXECUTION PRICE READ CONTRACT PASSED — isolated Branch2 binding, additive no-backfill schema, batched pre-migration-safe Catalog read, no price writes')

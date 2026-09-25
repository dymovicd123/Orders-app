import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const envTest = read('scripts/test-branch2-environment.mjs')
const deployMonitor = read('.github/workflows/cloudflare-deploy-monitor.yml')
const h6i = read('scripts/test-stage03-h6i-pre-client-readiness-matrix.mjs')
const h6j = read('scripts/test-stage03-h6j-adjacent-surfaces-isolation.mjs')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const app = read('src/App.tsx')

const BRANCH2_WORKER = 'orders-app-branch2'
const BRANCH2_DB = 'orders_db_branch2'
const BRANCH2_DB_ID = '40065052-854e-44b8-bcd5-251bdd488301'
const PROD_DB = 'orders_db_prod'
const PROD_DB_ID = '17e68a41-1d58-4a36-8a63-47c3e32443c4'

check(wrangler.includes(`"name": "${BRANCH2_WORKER}"`), 'H7A: Branch2 Worker identity drifted')
check(wrangler.includes(`"database_name": "${BRANCH2_DB}"`), 'H7A: Branch2 D1 logical binding drifted')
check(wrangler.includes(`"database_id": "${BRANCH2_DB_ID}"`), 'H7A: Branch2 D1 physical binding drifted')
check(!wrangler.includes(PROD_DB) && !wrangler.includes(PROD_DB_ID), 'H7A: Production D1 identity leaked into Branch2 config')

check(envTest.includes(BRANCH2_WORKER), 'H7A: canonical Branch2 environment test lost Worker guard')
check(envTest.includes(BRANCH2_DB) && envTest.includes(BRANCH2_DB_ID), 'H7A: canonical Branch2 environment test lost D1 guard')
check(envTest.includes(PROD_DB) && envTest.includes(PROD_DB_ID), 'H7A: canonical Branch2 environment test no longer rejects Production D1')

check(deployMonitor.includes('branches:') && deployMonitor.includes('- branch2'), 'H7A: deploy monitor no longer watches branch2')
check(deployMonitor.includes(`WORKER_NAME="${BRANCH2_WORKER}"`), 'H7A: deploy monitor Branch2 Worker target drifted')
check(deployMonitor.includes(BRANCH2_DB) && deployMonitor.includes(BRANCH2_DB_ID), 'H7A: deploy monitor Branch2 D1 guard drifted')
check(deployMonitor.includes(PROD_DB) && deployMonitor.includes(PROD_DB_ID), 'H7A: deploy monitor no longer rejects Production D1 on branch2')

check(h6i.includes('Branch2 Worker identity drifted'), 'H7A: H6I environment identity gate missing')
check(h6i.includes('Production D1 identity leaked into Branch2'), 'H7A: H6I Production leak guard missing')
check(h6j.includes('ADJACENT SURFACES ISOLATION PASSED'), 'H7A: H6J adjacent-surface isolation gate missing')

const createStart = app.indexOf('async function createOrderFromDraft')
const createEnd = app.indexOf('\n  function ', createStart + 40)
check(createStart >= 0 && createEnd > createStart, 'H7A: Create flow source boundary missing')
const createFlow = app.slice(createStart, createEnd)
check(!createFlow.includes('pricingMode:'), 'H7A: itemized Create was activated before H7 activation commit')
check(createFlow.includes('unitPrice: 0,'), 'H7A: legacy Create request baseline drifted before H7 activation commit')
check(createUi.includes('Цена заказа'), 'H7A: legacy visible order-total field disappeared before H7 activation commit')
check(!createUi.includes('Цена продажи'), 'H7A: visible line-price UI appeared before H7 activation commit')

console.log('STAGE03-H7A BRANCH2 SAFETY BASELINE PASSED — branch2 Worker/D1 identity is hard-locked, Production D1 is rejected, H6 isolation gates remain present, and itemized Create is still unactivated')

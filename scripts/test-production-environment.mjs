import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const index = read('index.html')
const auth = read('worker/domains/auth.ts')

check(wrangler.includes('"name": "orders-app"'), 'Production Worker name drifted')
check(wrangler.includes('"database_name": "orders_db_prod"'), 'Production D1 logical binding drifted')
check(wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'Production D1 ID drifted')
check(!wrangler.includes('orders-app-branch2'), 'Branch2 Worker binding leaked into Production release')
check(!wrangler.includes('orders_db_branch2'), 'Branch2 D1 binding leaked into Production release')
check(!wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'Branch2 D1 ID leaked into Production release')
check(index.includes('<title>orders-app</title>'), 'Production title marker was not restored')
check(!index.includes('Система заказов 2'), 'Branch2 visual title leaked into Production release')
check(auth.includes("getAppSetting(db, 'require_stored_admin_password', '0')"), 'Stored-password safety gate missing')
check(auth.includes('if (storedPasswordRequired) return false;'), 'Admin fallback guard missing')

console.log('PRODUCTION ENVIRONMENT SAFETY PASSED — Production Worker/D1 binding restored and Branch2 markers excluded')

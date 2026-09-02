import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const wrangler = read('wrangler.jsonc')
const index = read('index.html')
const auth = read('worker/domains/auth.ts')
check(wrangler.includes('"name": "orders-app-branch2"'), 'Branch2 Worker name drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'Branch2 D1 logical binding drifted')
check(!wrangler.includes('orders_db_prod'), 'Primary D1 binding leaked into Branch2')
check(index.includes('<title>Система заказов 2</title>'), 'Branch2 visual title marker missing')
check(auth.includes("getAppSetting(db, 'require_stored_admin_password', '0')"), 'Branch2 stored-password safety gate missing')
check(auth.includes('if (storedPasswordRequired) return false;'), 'Branch2 admin fallback guard missing')
console.log('BRANCH2 ENVIRONMENT SAFETY PASSED — separate Worker/D1 identity, title marker and stored-password fallback guard preserved')

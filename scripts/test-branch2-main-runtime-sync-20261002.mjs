import fs from 'node:fs'
import crypto from 'node:crypto'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const gitBlob = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

const exactMainRuntime = {
  'src/App.tsx': 'bac4ea2d1080bc702574717a7728fbbc8fef329c',
  'src/app/controllers/useApiClient.ts': '655421a5bb5d5b39d065fcc8bcdb3df9fbf82467',
  'src/features/sections/TeamSection.tsx': 'c8d330aff9cd45468a448eb8c70e24d55cf1d198',
  'worker/domains/auth.ts': 'd7bbf4e7dc5d5c86ac1b0b4abaa410e9e7caa9a2',
  'src/features/sections/InventorySection.tsx': '88bfb869f8d0a14c5cbf9fcca7858ad3b3fd5a69',
  'src/features/inventory/views/renderInventoryStocktakePanel.tsx': '2355f680c088d35bb9a598602ca4dedb99a55f3e',
  'worker/domains/inventory-stocktake.ts': 'c40f2c4bbd5075aab4412a08e77df8ad76dae0e9',
  'src/styles/10-workshop-reports-team.css': '49e1a062eff80c5e9edc5466ed649a3083279a5d',
  'src/styles/188e4-stocktake-usability.css': '844fa0396f9f619af3283e78680c46d443055054',
  'src/features/renderers/FinanceReportContentRenderer.tsx': '3d7ff45fd4418eefaf5ea9bd94745964ef8fd47a',
}
for (const [path, expected] of Object.entries(exactMainRuntime)) {
  check(gitBlob(read(path)) === expected, 'Branch2 runtime drifted from approved main file: ' + path)
}

const wrangler = read('wrangler.jsonc')
check(wrangler.includes('"name": "orders-app-branch2"'), 'Branch2 Worker identity was not preserved')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'Branch2 D1 logical name was not preserved')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'Branch2 D1 id was not preserved')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Production D1 identity leaked into Branch2')

const index = read('index.html')
check(index.includes('<title>Система заказов 2</title>'), 'Branch2 visual marker was lost')

const app = read('src/App.tsx')
const api = read('src/app/controllers/useApiClient.ts')
const team = read('src/features/sections/TeamSection.tsx')
const auth = read('worker/domains/auth.ts')
const inventory = read('src/features/sections/InventorySection.tsx')
const stocktakeUi = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
const stocktakeWorker = read('worker/domains/inventory-stocktake.ts')

check(app.includes("handleAuthInvalid") && app.includes("AUTH_SETUP_ALREADY_COMPLETED"), 'Current main auth recovery did not reach Branch2')
check(api.includes("PASSWORD_CHANGE_REQUIRED") && api.includes("onAuthInvalid"), 'Current main API auth invalidation did not reach Branch2')
check(team.includes('Системные администраторы') && team.includes('saveSystemAdminAccess'), 'Current main system-admin Team UX did not reach Branch2')
check(auth.includes("code: 'AUTH_SETUP_ALREADY_COMPLETED'") && auth.includes('forcePasswordChange'), 'Current main auth backend did not reach Branch2')
check(inventory.includes('stocktakeProductKeyRef') && inventory.includes('stocktakeProgress.filled > 0'), 'Current main stocktake navigation/default semantics did not reach Branch2')
check(stocktakeUi.includes('По системе:') && stocktakeUi.includes('пустым'), 'Current main stocktake system-quantity UX did not reach Branch2')
check(stocktakeWorker.includes('catalogColorIdentity') && stocktakeWorker.includes("code: 'no_counts'") && stocktakeWorker.includes('counted_quantity IS NULL'), 'Current main stocktake legacy-variant/default persistence did not reach Branch2')

console.log('BRANCH2 MAIN RUNTIME SYNC PASSED — selected current-main runtime is exact while Branch2 Worker/D1 identity and test-environment marker remain isolated')

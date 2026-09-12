import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'worker/domains/finance-reports.ts'), 'utf8')

const requireText = (needle, message) => { if (!source.includes(needle)) throw new Error(message) }

if (source.includes('managerRows') || source.includes('managerCashRows')) throw new Error('R6.3: dedicated manager summary result sets must remain removed.')
requireText('COUNT(CASE WHEN o.total_amount <> 0 THEN 1 END) AS nonzero_order_count', 'R6.3: manager day rows must preserve the non-zero-order denominator.')
requireText('const managerIdentityKey = (managerId: number, managerName: unknown)', 'R6.3: collision-safe manager identity missing.')
requireText('return managerId > 0 ?', 'R6.3: live manager identity missing.')
requireText('legacy:', 'R6.3: historical manager identity must use snapshot name instead of id 0.')
requireText('const managerSummaryMap = new Map<string, any>()', 'R6.3: manager summary must use collision-safe string identities.')
requireText('summary.order_count += managerRow.order_count', 'R6.3: manager order facts must accumulate instead of overwrite.')
requireText('summary.total_returns += managerRow.total_returns', 'R6.3: manager return facts must accumulate instead of overwrite.')
requireText('summary.nonzero_order_count += nonzeroOrderCount', 'R6.3: manager avg-check denominator must accumulate instead of overwrite.')
requireText('for (const operation of paymentOperations)', 'R6.3: manager received summary must reuse already-loaded payment operations.')
requireText('const summaryKey = managerIdentityKey(managerId, manager)', 'R6.3: payment summary must use the same collision-safe identity.')
requireText('summary.total_received += Number(operation.amount || 0)', 'R6.3: payment operations must accumulate into manager received total.')
requireText('avg_check: summary.nonzero_order_count > 0 ? summary.total_sales / summary.nonzero_order_count : 0', 'R6.3: avg_check semantics changed unexpectedly.')

console.log('D1 read budget R6.3 checks passed.')

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'worker/domains/finance-reports.ts'), 'utf8')

const requireMatch = (pattern, message) => {
  if (!pattern.test(source)) throw new Error(message)
}

if (/\bmanagerRows\b|\bmanagerCashRows\b/.test(source)) {
  throw new Error('R6.3: dedicated manager summary result sets must be removed instead of executing redundant D1 reads.')
}
requireMatch(
  /COUNT\(CASE WHEN o\.total_amount <> 0 THEN 1 END\) AS nonzero_order_count/,
  'R6.3: manager day rows must preserve the exact non-zero-order denominator for avg_check.'
)
requireMatch(
  /const managerSummaryMap = new Map<number, any>\(\)[\s\S]*summary\.order_count \+= managerRow\.order_count[\s\S]*summary\.total_received \+= managerRow\.total_received[\s\S]*summary\.total_returns \+= managerRow\.total_returns[\s\S]*summary\.nonzero_order_count \+= nonzeroOrderCount/,
  'R6.3: manager summary must be rebuilt from already-loaded day facts.'
)
requireMatch(
  /avg_check: summary\.nonzero_order_count > 0 \? Math\.round\(summary\.total_sales \/ summary\.nonzero_order_count\) : 0/,
  'R6.3: rebuilt manager avg_check must match AVG(NULLIF(total_amount, 0)) semantics.'
)

console.log('D1 read budget R6.3 checks passed.')

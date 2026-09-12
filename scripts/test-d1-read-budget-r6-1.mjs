import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src/features/finance/useFinanceReportReads.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const requireMatch = (pattern, message) => {
  if (!pattern.test(source)) throw new Error(message)
}

requireMatch(
  /const FULL_REPORT_TTL_MS = 60 \* 1000/,
  'R6.1: general finance reports must keep the existing 60-second cache window.'
)
requireMatch(
  /const FINANCE_WORKSPACE_TTL_MS = 3 \* 60 \* 1000/,
  'R6.1: Finance workspace should reuse its report for three minutes.'
)
requireMatch(
  /const cacheTtlMs = scope === 'finance' \? FINANCE_WORKSPACE_TTL_MS : FULL_REPORT_TTL_MS/,
  'R6.1: Finance workspace must use the longer TTL without changing other report scopes.'
)
requireMatch(
  /Date\.now\(\) - cached\.savedAt <= cacheTtlMs/,
  'R6.1: the selected scope TTL must guard the cached Finance read.'
)
requireMatch(
  /financeInFlight\.current\.get\(key\)[\s\S]*financeInFlight\.current\.set\(key, request\)/,
  'R6.1: concurrent identical Finance reads must remain deduplicated.'
)
requireMatch(
  /financeCache\.current\.clear\(\)[\s\S]*financeInFlight\.current\.clear\(\)/,
  'R6.1: explicit invalidation must still clear cached and in-flight Finance reads after mutations.'
)

console.log('D1 read budget R6.1 checks passed.')

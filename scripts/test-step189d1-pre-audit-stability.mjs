import fs from 'node:fs'

import { readWorkerSource } from './lib/worker-source.mjs'
import { readAppControllerSource } from './lib/frontend-source.mjs'
const read = (file) => fs.readFileSync(file, 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sliceFunction = (source, start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  if (a < 0 || b < 0) fail(`cannot slice ${start}`)
  return source.slice(a, b)
}

try {
  const worker = readWorkerSource()
  const app = readAppControllerSource()
  const team = read('src/features/sections/TeamSection.tsx')

  const teamFn = sliceFunction(worker, 'async function listTeamActivity', 'async function listTeamSalaryPreview')
  check(teamFn.includes('const rowStatements: D1PreparedStatement[] = []') && teamFn.includes('const summaryStatements: D1PreparedStatement[] = []'), 'team report must use independent domain SELECT collections')
  check(teamFn.includes('await db.batch(statements)'), 'team report must batch the independent read-only SELECTs')
  check(!/\bUNION(?:\s+ALL)?\b/i.test(teamFn), 'team report must not contain a compound SELECT after the live D1 failure')
  check(!teamFn.includes('Promise.all(['), 'team report must not launch duplicate compound reads concurrently')
  check(!teamFn.includes('activitySql'), 'legacy compound activitySql must be removed')
  check(!teamFn.includes('totalsRow'), 'third duplicate totals query must remain removed')
  check(teamFn.includes("manager: cleanText(row.manager) || 'Не указан'"), 'missing legacy manager must be labeled plainly')
  check(!teamFn.includes("COALESCE(manager, '') <> ''"), 'manager-less legacy business facts must not be silently filtered out')
  check(teamFn.includes('INSTR(UPPER(') && !teamFn.includes(' LIKE ?'), 'team search must avoid user-derived LIKE patterns')
  check(worker.includes("teamActivityCleanup: '189d1'"), '189D.1 health marker missing')
  check(worker.includes("preAuditStability: '189d1'"), 'pre-audit stability marker missing')
  check(worker.includes("teamActivityQueryPlan: 'split-selects-r2'"), 'split-query health marker missing')

  check(app.includes("attempt === retryDelays.length - 1 && !responseLooksLikeHtml(response, bodyText)"), 'apiFetch must return the final structured Worker error instead of masking it')
  check(app.includes('teamActivityLoadFailed'), 'team report needs an explicit failed-load state')
  check(team.includes("teamActivityReport ? teamActivityReport.totals.orders : '—'"), 'failed first load must not render a convincing zero')
  check(team.includes('предыдущая успешная загрузка'), 'failed refresh must clearly label stale team data')
  check(team.includes('<span>Оплаты</span>'), 'team top summary must include payments if payments are part of activity')
  check(team.includes('colSpan={6}'), 'team manager summary empty row must match six meaningful columns')

  // Step 189D.1 also removes the same D1 LIKE-pattern failure from the main user-facing searches.
  const searchableFunctions = [
    ['activity log', 'async function listActivityLog', 'async function listReturnHistory'],
    ['returns history', 'async function listReturnHistory', 'function moneyHistoryOperationLabel'],
    ['money history', 'async function listFinancialHistory', 'async function listFinanceReports'],
    ['inventory history', 'async function listInventoryHistory', 'async function listInventoryCheckHistory'],
    ['exchanges history', 'async function listExchanges', 'async function cancelReturn'],
    ['clients', 'function buildClientWhere', 'function clientOrderBy'],
    ['inventory list', 'async function listInventory', 'async function findInventoryMovementMatch'],
    ['orders list', 'async function listOrders(db:', 'async function reserveOrderItemV2'],
  ]
  for (const [label, start, end] of searchableFunctions) {
    const fn = sliceFunction(worker, start, end)
    check(!fn.includes(' LIKE ?'), `${label}: user search still contains LIKE ?`)
  }

  console.log('Step 189D.1 pre-audit stability/static tests: OK')
} catch (error) {
  console.error(`Step 189D.1 pre-audit stability/static tests FAILED: ${error?.message || error}`)
  process.exit(1)
}

import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/returns-exchanges.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function correctExchangeFinancials(')
const end = source.indexOf('export async function listExchanges(', start)
check(start >= 0 && end > start, 'Exchange financial correction function missing')
const fn = source.slice(start, end)

const unchangedStart = fn.indexOf('if (alreadyDesired) {')
const mutationStart = fn.indexOf('await db.batch(statements);')
check(unchangedStart >= 0 && mutationStart > unchangedStart, 'Exchange financial correction branches missing')

const unchanged = fn.slice(unchangedStart, mutationStart)
const unchangedComplete = unchanged.indexOf('await completeCriticalOperation(db, criticalOperation, completedResponse)')
const unchangedReadback = unchanged.indexOf('order = await getOrder(db, orderId)')
check(unchangedComplete >= 0 && unchangedReadback > unchangedComplete, 'Unchanged exchange correction still waits for order readback before completing the critical operation')
check(unchanged.includes("console.warn('Order readback after unchanged exchange financial correction failed'"), 'Unchanged exchange correction readback is not best-effort')
check(unchanged.includes('refreshRequired: true'), 'Unchanged exchange correction lacks refresh fallback')

const committed = fn.slice(mutationStart)
const ledgerSync = committed.indexOf('await syncOrderFinancialLedger(db, orderId)')
const complete = committed.indexOf('await completeCriticalOperation(db, criticalOperation, completedResponse)')
const readback = committed.indexOf('order = await getOrder(db, orderId)')
const activity = committed.indexOf('await writeActivityLog(db, {')
check(ledgerSync >= 0 && complete > ledgerSync, 'Exchange correction completes before the committed ledger is synchronized')
check(readback > complete, 'Committed exchange correction can still false-fail on secondary order readback')
check(activity > complete, 'Committed exchange correction can still false-fail on secondary activity logging')
check(committed.includes("console.warn('Order readback after committed exchange financial correction failed'"), 'Committed exchange correction lacks readback failure isolation')
check(committed.includes("console.warn('Exchange financial correction activity log failed after committed correction'"), 'Committed exchange correction lacks activity-log failure isolation')
check(committed.includes('refreshRequired: true'), 'Committed exchange correction lacks explicit refresh fallback')
check(committed.includes('return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse'), 'Successful readback no longer enriches the first response without changing the cached critical result')

console.log('STAGE01 FINANCE CORRECTION RELIABILITY R4 PASSED — committed exchange money corrections complete before secondary readback/logging and degrade to refreshRequired instead of false failure')

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const cash = read('worker/domains/cash.ts')
  const app = read('src/App.tsx')
  const renderer = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  const types = read('src/app/types.ts')
  const css = read('src/styles/finance-f4-money-journal.css')

  check(cash.includes("const includeLegacy = cleanText(url.searchParams.get('includeLegacy')) === '1'") && cash.includes("dateFrom < currentMonthStart"), 'Server legacy history is not gated by an explicitly older date range')
  check(cash.includes("if (!includeLegacy) where.push(`NOT ${legacySql}`)"), 'Server can expose baseline history by default')
  check(cash.includes("url.searchParams.get('flow')") && cash.includes("url.searchParams.get('operation')") && cash.includes("url.searchParams.get('trace')"), 'Money journal filters are incomplete')
  check(cash.includes("trace === 'review'") && cash.includes("trace === 'legacy'") && cash.includes('backdatedCreateInfoSql'), 'Server trace filtering is incomplete')
  for (const marker of ['order_created_at', 'event_recorded_at', 'source_ref', 'traceSeverity', 'traceExplanation']) check(cash.includes(marker), `Money history trace field missing: ${marker}`)

  check(app.includes("includeLegacy: includeLegacy ? '1' : '0'"), 'Frontend does not explicitly request historical baseline only for an older period')
  check(app.includes("moneyHistoryType.flow") && app.includes("moneyHistoryType.operation") && app.includes("moneyHistoryType.trace"), 'Frontend money history filters are not independent')
  check(app.includes("import './styles/finance-f4-money-journal.css'"), 'F4 money journal CSS is not loaded')
  check(renderer.includes('Движение') && renderer.includes('Вид операции') && renderer.includes('Проверка'), 'F4 journal filters are not visible')
  check(renderer.includes('disabled={!historicalPeriodSelected}') && renderer.includes('Исторический baseline'), 'Legacy filter is not locked behind an explicitly historical range')
  check(renderer.includes('Операция записана:') && renderer.includes('Заказ введён:'), 'Journal does not expose operation/order recorded timestamps')
  check(renderer.includes('traceExplanation') && renderer.includes('Нужно проверить'), 'Journal does not explain trace state')
  check(renderer.includes('openMoneyHistoryForOrder') && renderer.includes('Денежная история'), 'Summary trace rows cannot drill down to money history')
  check(renderer.includes("openOrderFromFinance({ orderId: row.orderId"), 'Money journal has no direct order action')
  check(types.includes('eventRecordedAt?: string | null') && types.includes("traceSeverity?: 'normal' | 'info' | 'review'"), 'FinancialHistoryEntry contract was not enriched')
  check(css.includes('.finance-money-history-row-f4') && css.includes('@media (max-width: 760px)'), 'F4 journal responsive CSS missing')

  console.log('FINANCE F4 MONEY JOURNAL TESTS PASSED — legacy is opt-in through an older period, journal filters are independent, trace timestamps/explanations and direct drilldowns are visible.')
} catch (error) {
  console.error(`FINANCE F4 MONEY JOURNAL TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

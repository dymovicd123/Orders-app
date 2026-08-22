import fs from 'node:fs'

import { readWorkerSource } from './lib/worker-source.mjs'
const read = (file) => fs.readFileSync(file, 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const worker = readWorkerSource()
  const team = read('src/features/sections/TeamSection.tsx')
  const returns = read('src/features/sections/OrderReturnsSection.tsx')
  const exchanges = read('src/features/sections/OrderExchangeSection.tsx')
  const activity = read('src/features/sections/OrderActivitySection.tsx')
  const finance = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  const types = read('src/app/types.ts')

  const teamFunction = worker.slice(worker.indexOf('async function listTeamActivity'), worker.indexOf('async function listTeamSalaryPreview'))
  check(teamFunction.includes("'return_created' AS action_type"), 'return creation must remain a separate team event')
  check(teamFunction.includes("'return_cancelled' AS action_type"), 'return cancellation must be a separate team event')
  check(teamFunction.includes("'exchange_created' AS action_type"), 'exchange creation must remain a separate team event')
  check(teamFunction.includes("'exchange_cancelled' AS action_type"), 'exchange cancellation must be a separate team event')
  check(teamFunction.includes('FROM financial_events fe'), 'team payment activity must use reliable 189C money facts')
  check(!teamFunction.includes('LIMIT 400'), 'team activity must not calculate the period from a 400-row slice')
  check(teamFunction.includes('const summaryStatements: D1PreparedStatement[] = []') && teamFunction.includes('GROUP BY COALESCE(m.id, 0)'), 'manager summaries must be calculated by independent SQL aggregates over the full filtered period')
  check(teamFunction.includes('fetchLimit = offset + limit') && teamFunction.includes('rawRows.slice(offset, offset + limit)'), 'team event feed must page after merging the independent domain rows')
  check(teamFunction.includes('hasMore:'), 'team event feed must expose hasMore')
  check(teamFunction.includes('await db.batch(statements)'), 'team activity must execute its independent read-only domain queries as one D1 batch')
  check(!/\bUNION(?:\s+ALL)?\b/i.test(teamFunction), 'team activity must not use a compound SELECT after the live D1 failure')
  check(!teamFunction.includes('Promise.all(['), 'team activity must not launch duplicate report reads concurrently')
  check(!teamFunction.includes("COALESCE(manager, '') <> ''"), 'legacy events without manager must not disappear')
  check(teamFunction.includes('INSTR(UPPER('), 'team activity search must avoid D1 LIKE pattern limit')
  check(teamFunction.includes("'Заказ создан' AS title"), 'team titles must be neutral facts, not claims about who clicked')
  check(!teamFunction.includes("'Добавил заказ' AS title"), 'team activity must not claim the order manager personally clicked create')

  check(team.includes('>Работа с заказами</button>'), 'team tab must be named Работа с заказами')
  check(!team.includes('Это не контроль того, кто нажимал кнопки.'), 'team UI must not expose internal architecture commentary')
  check(team.includes('Итого по менеджерам заказов'), 'team manager summary heading missing')
  check(team.includes('Менеджер заказа'), 'team tables must label manager as order manager')
  check(team.includes('Показать ещё'), 'team activity must have load-more pagination')
  check(team.includes('formatDateShort(entry.actionDate || entry.actionAt)'), 'team history must display the business date used by the selected report period')
  check(!team.includes('Обновить активность'), 'old ambiguous activity button must be removed')

  check(returns.includes('· Менеджер: {entry.manager'), 'return cards must show the order manager without opening details')
  check(exchanges.includes('· Менеджер: {entry.manager'), 'exchange cards must show the order manager without opening details')
  check(exchanges.includes('entry.managerColor'), 'exchange history must preserve manager color context')
  check(finance.includes('row.manager ? <ManagerBadge'), 'money history must show the order manager when the order still exists')
  check(types.includes('managerName?: string | null'), 'activity history response must expose order manager name')

  check(activity.includes('Журнал действий по заказам'), 'old global journal must be explicitly scoped to orders')
  check(activity.includes('Вспомогательная история действий по заказам.'), 'order journal must be described as supplementary')
  check(activity.includes('Менеджер не указан'), 'order journal must handle missing manager plainly')
  check(!activity.includes('ID заказа в базе'), 'internal numeric order-id filter must not be exposed')
  check(!activity.includes('{entry.eventType}'), 'technical event names must not be shown to users')
  check(!activity.includes('Склад/бутик</option>'), 'order journal must not pretend to replace warehouse history')

  for (const forbidden of ['Передан менеджеру', 'передан менеджеру', 'Передача заказа менеджеру']) {
    check(!worker.includes(forbidden) && !team.includes(forbidden) && !activity.includes(forbidden), `189D must not invent manager-transfer workflow: ${forbidden}`)
  }

  console.log('Step 189D team activity/static tests: OK')
} catch (error) {
  console.error(`Step 189D team activity/static tests FAILED: ${error?.message || error}`)
  process.exit(1)
}

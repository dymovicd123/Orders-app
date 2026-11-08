import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

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


  // Execute the actual extracted read owners to verify period, pagination and row truth.
  const compiled = await build({
    entryPoints: ['src/features/team/teamReportActions.ts'],
    bundle: true, platform: 'node', format: 'esm', target: 'es2022',
    write: false, logLevel: 'silent',
  })
  const { createTeamReportActions } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
  )
  const calls = []
  let salaryState = null
  let activityState = null
  let failed = false
  let readError = null
  let badHttp = false
  let busy = false
  const salaryFilters = { dateFrom: '2026-11-01', dateTo: '2026-11-30' }
  const activityFilters = { ...salaryFilters, q: 'ЗАКАЗ', actionType: 'orders' }
  const args = {
    teamSalaryFilters: salaryFilters, teamSalaryReport: null,
    teamActivityFilters: activityFilters, teamActivityReport: null,
    setTeamBusy: () => {},
    setTeamSalaryReport: (next) => { salaryState = next },
    setTeamActivityBusy: (next) => { busy = next },
    setTeamActivityLoadFailed: (next) => { failed = next },
    setTeamActivityReport: (next) => { activityState = typeof next === 'function' ? next(activityState) : next },
    apiFetch: async (url, init) => {
      calls.push({ url, init })
      if (badHttp) return new Response(JSON.stringify({ ok:false, message:'Параметры устарели' }), { status:409 })
      if (url.startsWith('/api/team/salary?')) {
        return new Response(JSON.stringify({ ok:true, startDate:salaryFilters.dateFrom, endDate:salaryFilters.dateTo, rows:[{manager:'М'}], totals:{ employees:1 } }), {status:200})
      }
      const offset = Number(new URL('https://fixture' + url).searchParams.get('offset'))
      return new Response(JSON.stringify({
        ok:true,startDate:activityFilters.dateFrom,endDate:activityFilters.dateTo,
        actionType:'orders',count:3,offset,limit:50,hasMore:offset===0,
        rows: offset===0 ? [{id:'a'},{id:'b'}] : [{id:'c'}],
        summary:[{manager:'М',orders:3}],totals:{actions:3},
      }), {status:200})
    },
    reportReadFailure: (err) => { readError = err },
  }
  const owner = createTeamReportActions(args)
  await owner.loadTeamSalaryReport()
  assert.equal(calls[0].url, '/api/team/salary?startDate=2026-11-01&endDate=2026-11-30')
  assert.equal(salaryState.rows.length,1)
  await owner.loadTeamActivityReport()
  const first = new URL('https://fixture' + calls.at(-1).url)
  assert.equal(first.searchParams.get('limit'),'50')
  assert.equal(first.searchParams.get('offset'),'0')
  assert.equal(first.searchParams.get('q'),'ЗАКАЗ')
  assert.equal(first.searchParams.get('actionType'),'orders')
  assert.equal(activityState.rows.length,2)
  assert.equal(failed,false)
  assert.equal(busy,false)
  // React re-render provides fresh row length for append, preserving stable summary.
  const next = createTeamReportActions({ ...args, teamActivityReport: activityState })
  await next.loadTeamActivityReport(activityFilters,{ append:true })
  const second = new URL('https://fixture' + calls.at(-1).url)
  assert.equal(second.searchParams.get('offset'),'2')
  assert.deepEqual(activityState.rows.map(row=>row.id),['a','b','c'])
  assert.equal(activityState.summary[0].orders,3)
  badHttp = true
  const prior = activityState
  await createTeamReportActions({ ...args, teamActivityReport: activityState }).loadTeamActivityReport(activityFilters,{ append:true })
  assert.equal(activityState, prior, 'failed append must retain last successful report')
  assert.equal(failed,true)
  assert.equal(busy,false)
  assert(readError instanceof Error, 'failed report must show a real read failure')

  console.log('Step 189D team activity/static tests: OK')
} catch (error) {
  console.error(`Step 189D team activity/static tests FAILED: ${error?.message || error}`)
  process.exit(1)
}

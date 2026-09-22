import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const reportSources = {
  finance: read('worker/domains/finance-reports.ts'),
  financeDay: read('worker/domains/finance-day.ts'),
  cash: read('worker/domains/cash.ts'),
  activity: read('worker/domains/activity.ts'),
  team: read('worker/domains/team.ts'),
  ordersRead: read('worker/domains/orders-read.ts'),
  financeDashboard: read('src/features/renderers/FinanceDashboardRenderer.tsx'),
  financeReportUi: read('src/features/renderers/FinanceReportContentRenderer.tsx'),
  reportsSection: read('src/features/sections/ReportsSection.tsx'),
  dashboardSection: read('src/features/sections/DashboardSection.tsx'),
  debtSection: read('src/features/sections/OrderDebtSection.tsx'),
}

for (const [name, source] of Object.entries(reportSources)) {
  check(!source.includes('catalog_execution_prices'), `${name}: report/dashboard path must not use mutable current Catalog prices`)
}

check(reportSources.finance.includes('COALESCE(SUM(total_amount), 0) AS total_sales'), 'Finance overview must remain on persisted order totals')
check(reportSources.finance.includes('FROM payments p') && reportSources.finance.includes('GROUP BY p.method'), 'Payment-method report must remain on payment facts')
check(reportSources.finance.includes('FROM returns r') && reportSources.finance.includes('r.amount'), 'Return report must remain on return facts')
check(reportSources.finance.includes('COALESCE(SUM(debt_amount), 0) AS total_debt') || reportSources.finance.includes('COALESCE(SUM(debt_amount), 0) AS period_debt'), 'Debt report must remain on persisted debt')
check(reportSources.finance.includes('COALESCE(SUM(o.total_amount), 0) AS total_sales'), 'Manager/city sales must remain on persisted order total snapshots')

check(reportSources.finance.includes('COALESCE(SUM(o.total_amount), 0) AS order_sales'), 'Known legacy product-sales field unexpectedly changed; audit assumption must be reviewed')
check(!reportSources.financeReportUi.includes('order_sales'), 'Unsafe legacy product order_sales must not be displayed as exact product revenue')

check(reportSources.financeDay.includes('FROM payments p JOIN orders o ON o.id = p.order_id'), 'Finance day payment facts source changed')
check(reportSources.financeDay.includes('FROM financial_events'), 'Finance day journal must remain on financial events')
check(reportSources.financeDay.includes('FROM cash_register_entries'), 'Finance day cash reconciliation must remain on cash register entries')

check(reportSources.cash.includes('cash_register_entries'), 'Cash report must remain on cash register ledger')
check(!reportSources.cash.includes('catalog_price_snapshot'), 'Cash must not be derived from item Catalog price snapshots')

check(reportSources.activity.includes('COALESCE(SUM(total_amount), 0) AS total_sales'), 'Orders finance summary must remain on persisted order total')
check(reportSources.activity.includes('COALESCE(SUM(p.amount), 0) AS gross_received'), 'Orders finance summary received must remain on payments')
check(reportSources.activity.includes('COALESCE(SUM(r.amount), 0) AS total_returned'), 'Orders finance summary returns must remain on returns')
check(reportSources.activity.includes('COALESCE(SUM(debt_amount), 0) AS current_debt'), 'Orders finance summary debt must remain on persisted debt')

check(reportSources.team.includes('p.paid - p.returned AS fact_amount'), 'Manager plan fact must remain payments minus returns')
check(reportSources.team.includes('dp.paid - dp.returned AS fact_amount'), 'Department plan fact must remain payments minus returns')
check(reportSources.team.includes('COALESCE(SUM(o.total_amount), 0) AS total_amount'), 'Team order activity must remain on persisted order totals')
check(reportSources.team.includes('COALESCE(SUM(fe.amount_delta), 0) AS total_amount'), 'Team money activity must remain on financial-event amounts')
check(reportSources.team.includes('COALESCE(SUM(r.amount), 0) AS total_amount'), 'Team return activity must remain on return amounts')
check(reportSources.team.includes('COALESCE(SUM(e.financial_amount), 0) AS total_amount'), 'Team exchange activity must remain on exchange financial facts')

check(!reportSources.financeDashboard.includes('catalogPriceSnapshot') && !reportSources.financeReportUi.includes('catalogPriceSnapshot'), 'Finance report UI must not reinterpret history from Catalog snapshots')
check(!reportSources.reportsSection.includes('catalogPriceSnapshot') && !reportSources.dashboardSection.includes('catalogPriceSnapshot'), 'General report/dashboard UI must stay isolated from item price snapshots')
check(!reportSources.debtSection.includes('catalogPriceSnapshot'), 'Debt UI must stay isolated from item price snapshots')

console.log('STAGE03-G1 REPORT PRICE ISOLATION PASSED — Finance, payment methods, debts, returns, cash, team plans/activity and dashboards remain on persisted historical money facts; mutable Catalog price is absent; unsafe legacy product order_sales stays hidden')

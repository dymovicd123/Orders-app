from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly 1 regex match, got {count}')
    return next_text


# --- Frontend: overview must not pull orders/catalog just to render dashboard ---
app_path = 'src/App.tsx'
app = read(app_path)
app = replace_once(
    app,
    "  useEffect(() => {\n    if (!authReady || activeSector !== 'overview') return\n    void loadDashboard(false)\n  }, [activeSector, authReady])",
    "  useEffect(() => {\n    if (!authReady || activeSector !== 'overview') return\n    void loadOverviewDashboard()\n  }, [activeSector, authReady])",
    'overview effect',
)
app = replace_once(
    app,
    "  async function loadDashboard(forceReferences = false, overrideFilters: typeof filters = filters, overrideOffset = orderPageOffset) {",
    "  async function loadOverviewDashboard() {\n    setBusy(true)\n    setError(null)\n    try {\n      const response = await apiFetch('/api/dashboard')\n      const data = await readJsonResponse<DashboardInsightsResponse>(response, 'Инфопанель')\n      if (!response.ok) throw new Error(`Dashboard load failed: ${response.status}`)\n      setDashboardInsights(data)\n      return data\n    } catch (err) {\n      reportReadFailure(err, 'Инфопанель', Boolean(dashboardInsights))\n      return null\n    } finally {\n      setBusy(false)\n    }\n  }\n\n  async function loadDashboard(forceReferences = false, overrideFilters: typeof filters = filters, overrideOffset = orderPageOffset) {",
    'overview loader insertion',
)
app = replace_once(
    app,
    "  function loadFinanceReports(nextFilters = financeReportFilters, options: { force?: boolean } = {}) {\n    return loadFinanceReportsForRange(nextFilters, options)\n  }",
    "  function loadFinanceReports(nextFilters = financeReportFilters, options: { force?: boolean; scope?: 'full' | 'finance' } = {}) {\n    const scope = options.scope || (activeSector === 'finance' ? 'finance' : 'full')\n    return loadFinanceReportsForRange(nextFilters, { ...options, scope })\n  }",
    'finance scoped wrapper',
)
app = replace_once(
    app,
    "    if (activeSector === 'finance') {\n      if (financeMode === 'cash') void loadCashRegister()\n      else {\n        if (financeMode === 'payments') void loadMoneyHistory()\n        if (financeMode === 'methods') void loadFinancePaymentMethods()\n        void loadFinanceReports(financeReportFilters, { force: true })\n      }\n    }",
    "    if (activeSector === 'finance') {\n      if (financeMode === 'cash') void loadCashRegister()\n      else {\n        if (financeMode === 'payments') void loadMoneyHistory()\n        if (financeMode === 'methods') void loadFinancePaymentMethods()\n      }\n    }",
    'remove forced finance read on navigation',
)
app = replace_once(
    app,
    "      return loadFinanceReportsForRange(financeReportFilters, { force: true })",
    "      return loadFinanceReportsForRange(financeReportFilters, { force: true, scope: activeSector === 'finance' ? 'finance' : 'full' })",
    'visible finance refresh scope',
)
app = replace_once(
    app,
    "  function reloadFinanceReports() {\n    return loadFinanceReportsForRange(financeReportFilters, { force: true })\n  }",
    "  function reloadFinanceReports() {\n    return loadFinanceReportsForRange(financeReportFilters, { force: true, scope: activeSector === 'finance' ? 'finance' : 'full' })\n  }",
    'manual finance refresh scope',
)
app = replace_once(
    app,
    "<DashboardSection ctx={{ busy, dashboardInsights, dashboardLowStock, dashboardSummary, dashboardWorkshopWarnings, formatMoney, formatPercent, isAdmin, loadDashboard, openDashboardStockItem, openDashboardWorkshopItem, openInventoryPanel, sectorStyle, setInventoryDraft, setOrderPanel, summary, workshopData }} />",
    "<DashboardSection ctx={{ busy, dashboardInsights, dashboardLowStock, dashboardSummary, dashboardWorkshopWarnings, formatMoney, formatPercent, isAdmin, loadOverviewDashboard, openDashboardStockItem, openDashboardWorkshopItem, openInventoryPanel, sectorStyle, setInventoryDraft, setOrderPanel, summary, workshopData }} />",
    'dashboard context',
)
write(app_path, app)

# Dashboard view: explicit lightweight refresh action.
dashboard_path = 'src/features/sections/DashboardSection.tsx'
dashboard = read(dashboard_path)
dashboard = replace_once(dashboard, '    loadDashboard,', '    loadOverviewDashboard,', 'dashboard destructure')
dashboard = replace_once(dashboard, 'onClick={() => void loadDashboard()}', 'onClick={() => void loadOverviewDashboard()}', 'dashboard refresh action')
write(dashboard_path, dashboard)

# Finance read hook: cache full reports and finance-workspace reports independently.
hook_path = 'src/features/finance/useFinanceReportReads.ts'
hook = read(hook_path)
hook = replace_once(
    hook,
    "  const loadFinanceReports = useCallback(async (range: DateRange, options: { force?: boolean } = {}) => {\n    if (!range.dateFrom || !range.dateTo) return null\n    const key = `${range.dateFrom}::${range.dateTo}`",
    "  const loadFinanceReports = useCallback(async (range: DateRange, options: { force?: boolean; scope?: 'full' | 'finance' } = {}) => {\n    if (!range.dateFrom || !range.dateTo) return null\n    const scope = options.scope || 'full'\n    const key = `${scope}::${range.dateFrom}::${range.dateTo}`",
    'finance cache scope',
)
hook = replace_once(
    hook,
    "        const params = new URLSearchParams({ startDate: range.dateFrom, endDate: range.dateTo })\n        const response = await apiFetch(`/api/reports/finance?${params.toString()}`)",
    "        const params = new URLSearchParams({ startDate: range.dateFrom, endDate: range.dateTo })\n        if (scope !== 'full') params.set('scope', scope)\n        const response = await apiFetch(`/api/reports/finance?${params.toString()}`)",
    'finance scope query param',
)
write(hook_path, hook)

# Worker finance endpoint: Finance UI does not consume report-only manager/product/city/team datasets.
finance_path = 'worker/domains/finance-reports.ts'
finance = read(finance_path)
finance = replace_once(
    finance,
    "  const { startDate, endDate } = parseReportDateRange(url);",
    "  const financeWorkspaceOnly = cleanText(url.searchParams.get('scope')).toLowerCase() === 'finance';\n  const emptyRowsResult = () => Promise.resolve({ results: [] } as any);\n\n  const { startDate, endDate } = parseReportDateRange(url);",
    'finance worker scope',
)
report_only_markers = [
    "SELECT o.manager_id,\n              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,",
    "SELECT x.manager_id,\n              COALESCE(m.name, 'Не указан') AS manager,",
    "SELECT oi.product_name_snapshot AS product,\n              COALESCE(SUM(oi.quantity), 0) AS quantity,",
    "SELECT COALESCE(NULLIF(o.city, ''), 'Не указан') AS city,\n              COUNT(*) AS order_count,",
    "SELECT x.city AS city,\n              COALESCE(SUM(x.total_received), 0) AS total_received,",
    "SELECT movement_type, inventory_source,\n              COUNT(*) AS count,",
    "SELECT COALESCE(c.phone_normalized, '') AS client_key,\n              COALESCE(c.display_name, c.phone_normalized, 'Не указан') AS client,",
    "SELECT event_type, COUNT(*) AS count\n       FROM activity_log",
    "SELECT o.order_date AS date,\n              o.manager_id,",
    "SELECT p.payment_date AS date,\n              o.manager_id,",
    "SELECT r.return_date AS date,\n              COALESCE(r.manager_id, o.manager_id) AS manager_id,",
    "SELECT o.order_date AS date,\n              TRIM(oi.product_name_snapshot || ' ' || COALESCE(oi.material_snapshot, '') || ' ' || COALESCE(oi.gender_snapshot, '')) AS product,",
    "SELECT o.order_date AS date,\n              COALESCE(NULLIF(o.city, ''), 'Не указан') AS city,\n              COUNT(o.id) AS order_count,",
    "SELECT x.date AS date, x.city AS city,\n              COALESCE(SUM(x.total_received), 0) AS total_received,",
    "SELECT r.id,\n              r.order_id,\n              o.external_id,\n              o.order_date,\n              r.return_date AS date,",
    "SELECT p.id,\n              p.order_id,\n              o.external_id,\n              o.order_date,\n              p.payment_date AS date,",
]
for index, marker in enumerate(report_only_markers, 1):
    old = "    () => db.prepare(\n      `" + marker
    new = "    () => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\n      `" + marker
    finance = replace_once(finance, old, new, f'finance report-only query {index}')
finance = replace_once(
    finance,
    "  const [leadReport, callCentreReport, planReport, teamReport] = await Promise.all([\n    listLeadRecords(db, url),\n    listCallCentreRecords(db, url),\n    listPlans(db, url),\n    listTeamEmployees(db),\n  ]);",
    "  const [leadReport, callCentreReport, planReport, teamReport] = financeWorkspaceOnly\n    ? [\n        { rows: [], totals: {} },\n        { rows: [], totals: {} },\n        { managerPlans: [], departmentPlans: [] },\n        { employees: [] },\n      ] as any\n    : await Promise.all([\n        listLeadRecords(db, url),\n        listCallCentreRecords(db, url),\n        listPlans(db, url),\n        listTeamEmployees(db),\n      ]);",
    'finance report-only auxiliary reads',
)
write(finance_path, finance)

# Warehouse Attention details: avoid re-scanning unresolved catalog once for count and again for rows.
attention_path = 'worker/domains/warehouse-attention.ts'
attention = read(attention_path)
attention = replace_once(
    attention,
    "  const [summary, handoverRows] = await Promise.all([\n    db.prepare(",
    "  const [summary, handoverRows] = await Promise.all([\n    details ? Promise.resolve(null) : db.prepare(",
    'attention skip full summary in details',
)
attention = regex_once(
    attention,
    r"  const rawShortageCount = Math\.max\(0, toInt\(summary\?\.shortage_count, 0\)\)[\s\S]*?  if \(!details\) return response\n\n  const shortageFetchLimit = Math\.min\(100, limit \+ fullyExplainedShortageKeys\.size \+ handoverReservations\.size\)\n",
    """  if (!details) {\n    const rawShortageCount = Math.max(0, toInt(summary?.shortage_count, 0))\n    const intakeCount = Math.max(0, toInt(summary?.intake_count, 0))\n    const lifecycleTotalCount = Math.max(0, toInt(summary?.lifecycle_total_count, 0))\n    const counts = {\n      shortage: Math.max(0, rawShortageCount - fullyExplainedShortageKeys.size),\n      intake: intakeCount,\n      lifecycle: Math.max(0, lifecycleTotalCount - intakeCount),\n      catalog: Math.max(0, toInt(summary?.catalog_count, 0)),\n      handover: handoverReviewRows.length,\n      stocktake: Math.max(0, toInt(summary?.stocktake_count, 0)),\n    }\n    return {\n      ok: true,\n      total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake,\n      counts,\n    }\n  }\n\n  const shortageFetchLimit = Math.min(100, limit + fullyExplainedShortageKeys.size + handoverReservations.size)\n""",
    'attention defer detail counts',
)
attention = replace_once(
    attention,
    "  const [shortageResult, lifecycleResult, catalogResult, stocktakeResult] = await Promise.all([",
    "  const [shortageResult, lifecycleResult, catalogResult, stocktakeResult, coreSummary] = await Promise.all([",
    'attention detail promise results',
)
attention = replace_once(
    attention,
    "              MIN(o.order_date) AS order_date, COUNT(*) AS affected_count,\n              oi.product_name_snapshot,",
    "              MIN(o.order_date) AS order_date, COUNT(*) AS affected_count, COUNT(*) OVER() AS catalog_count,\n              oi.product_name_snapshot,",
    'attention catalog window count',
)
attention = replace_once(
    attention,
    "       ORDER BY started_at ASC\n       LIMIT 4`\n    ).all<Record<string, unknown>>(),\n  ])",
    """       ORDER BY started_at ASC\n       LIMIT 4`\n    ).all<Record<string, unknown>>(),\n    db.prepare(\n      `SELECT\n         (SELECT COUNT(*) FROM (\n            SELECT s.inventory_source, s.variant_id\n            FROM inventory_stock s\n            WHERE s.quantity < 0\n            UNION\n            SELECT r.inventory_source, r.variant_id\n            FROM inventory_reservations r\n            LEFT JOIN inventory_stock s ON s.inventory_source = r.inventory_source AND s.variant_id = r.variant_id\n            WHERE r.status = 'active' AND r.variant_id IS NOT NULL\n            GROUP BY r.inventory_source, r.variant_id\n            HAVING SUM(r.quantity) > COALESCE(MAX(s.quantity), 0)\n          )) AS shortage_count,\n         (SELECT COUNT(*) FROM inventory_lifecycle_events WHERE status = 'pending') AS lifecycle_total_count,\n         (SELECT COUNT(*) FROM inventory_lifecycle_events e\n          WHERE e.status = 'pending' AND e.direction = 'in' AND ${exactLifecycleVariantSql} IS NOT NULL) AS intake_count,\n         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`\n    ).first<Record<string, unknown>>(),\n  ])""",
    'attention lightweight core summary',
)
attention = replace_once(
    attention,
    "  ])\n\n  const shortageItems = (shortageResult.results || []).map((row) => {",
    """  ])\n\n  const rawShortageCount = Math.max(0, toInt(coreSummary?.shortage_count, 0))\n  const intakeCount = Math.max(0, toInt(coreSummary?.intake_count, 0))\n  const lifecycleTotalCount = Math.max(0, toInt(coreSummary?.lifecycle_total_count, 0))\n  const catalogCount = Math.max(0, toInt((catalogResult.results || [])[0]?.catalog_count, 0))\n  const counts = {\n    shortage: Math.max(0, rawShortageCount - fullyExplainedShortageKeys.size),\n    intake: intakeCount,\n    lifecycle: Math.max(0, lifecycleTotalCount - intakeCount),\n    catalog: catalogCount,\n    handover: handoverReviewRows.length,\n    stocktake: Math.max(0, toInt(coreSummary?.stocktake_count, 0)),\n  }\n  const response: Record<string, unknown> = {\n    ok: true,\n    total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake,\n    counts,\n  }\n\n  const shortageItems = (shortageResult.results || []).map((row) => {""",
    'attention detail response counts',
)
write(attention_path, attention)

# Permanent R3 regression.
test_path = ROOT / 'scripts/test-d1-read-budget-r3.mjs'
test_path.write_text("""import fs from 'node:fs'\n\nconst read = (p) => fs.readFileSync(p, 'utf8')\nconst check = (condition, message) => { if (!condition) throw new Error(message) }\nconst app = read('src/App.tsx')\nconst dashboard = read('src/features/sections/DashboardSection.tsx')\nconst financeHook = read('src/features/finance/useFinanceReportReads.ts')\nconst financeWorker = read('worker/domains/finance-reports.ts')\nconst attention = read('worker/domains/warehouse-attention.ts')\n\ncheck(app.includes("void loadOverviewDashboard()"), 'Overview still routes through the full orders dashboard loader')\ncheck(app.includes("const response = await apiFetch('/api/dashboard')"), 'Overview lightweight dashboard read is missing')\ncheck(dashboard.includes('loadOverviewDashboard') && !dashboard.includes('onClick={() => void loadDashboard()}'), 'Dashboard refresh still triggers orders/catalog overfetch')\ncheck(financeHook.includes("options: { force?: boolean; scope?: 'full' | 'finance' }"), 'Finance scoped read option missing')\ncheck(financeHook.includes("const key = `${scope}::${range.dateFrom}::${range.dateTo}`"), 'Finance full/workspace caches are not isolated')\ncheck(financeHook.includes("if (scope !== 'full') params.set('scope', scope)"), 'Finance scope is not sent to Worker')\ncheck(financeWorker.includes("const financeWorkspaceOnly = cleanText(url.searchParams.get('scope')).toLowerCase() === 'finance'"), 'Finance Worker scope gate missing')\ncheck(financeWorker.includes("() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\\n      `SELECT oi.product_name_snapshot AS product"), 'Finance workspace still computes product report')\ncheck(financeWorker.includes("() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\\n      `SELECT o.order_date AS date,\\n              TRIM(oi.product_name_snapshot"), 'Finance workspace still computes daily product report')\ncheck(financeWorker.includes('const [leadReport, callCentreReport, planReport, teamReport] = financeWorkspaceOnly'), 'Finance workspace still loads leads/call-centre/plans/team')\ncheck(attention.includes('details ? Promise.resolve(null) : db.prepare('), 'Attention details still executes the full summary query first')\ncheck(attention.includes('COUNT(*) OVER() AS catalog_count'), 'Attention detail query does not carry exact grouped catalog total')\ncheck(attention.includes('const [shortageResult, lifecycleResult, catalogResult, stocktakeResult, coreSummary]'), 'Attention lightweight detail summary missing')\ncheck(attention.includes('(SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = \'active\') AS stocktake_count'), 'Attention core summary lost stocktake semantics')\nconsole.log('D1 READ BUDGET R3 PASSED — overview overfetch removed, Finance skips report-only datasets, and Attention details no longer scans unresolved catalog twice')\n""", encoding='utf-8')

pkg_path = ROOT / 'package.json'
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
release = pkg['scripts']['release:check']
needle = 'node scripts/test-d1-read-budget-r2.mjs'
addition = f'{needle} && node scripts/test-d1-read-budget-r3.mjs'
if 'test-d1-read-budget-r3.mjs' not in release:
    if needle not in release:
        raise RuntimeError('package release:check R2 anchor missing')
    pkg['scripts']['release:check'] = release.replace(needle, addition, 1)
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('Applied D1 Read Budget R3 candidate')

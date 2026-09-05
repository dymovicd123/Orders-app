import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const workerRoot = path.join(root, 'worker')
const manifestPath = path.join(root, 'scripts/step1906a-worker-declaration-manifest.json')
const cleanupPath = path.join(root, 'scripts/step1906c-dead-code-manifest.json')
const boundaryPath = path.join(root, 'scripts/step1906e-type-boundary-manifest.json')
const transferRuntimePath = path.join(root, 'scripts/step191d-transfer-runtime-manifest.json')
const runtimeHardeningPath = path.join(root, 'scripts/step191e-runtime-hardening-manifest.json')
const adminSessionIntegrityPath = path.join(root, 'scripts/step191f-admin-session-integrity-manifest.json')
const warehouseTruthFreshnessPath = path.join(root, 'scripts/step192a1-warehouse-truth-freshness-manifest.json')
const catalogTruthFinalizerPath = path.join(root, 'scripts/step192a2-catalog-truth-finalizer-manifest.json')
const warehouseAttentionTruthPath = path.join(root, 'scripts/step192b1-warehouse-truth-attention-manifest.json')
const dailyWarehousePath = path.join(root, 'scripts/step192b2a-daily-warehouse-manifest.json')
const attentionContextPath = path.join(root, 'scripts/step192b2a2-attention-context-manifest.json')
const handoverSqlAliasSafetyPath = path.join(root, 'scripts/step192b2a3-handover-sql-alias-safety-manifest.json')
const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')
const returnExchangeCancelAutonomyPath = path.join(root, 'scripts/return-exchange-cancel-autonomy-worker-manifest.json')
const orderEditAutonomyPath = path.join(root, 'scripts/order-edit-autonomy-worker-manifest.json')
const d1CapacityAutonomyPath = path.join(root, 'scripts/d1-capacity-autonomy-worker-manifest.json')
const d1ReadBudgetPath = path.join(root, 'scripts/d1-read-budget-r1-worker-manifest.json')
const d1ReadBudgetR2Path = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')
const d1ReadBudgetR3Path = path.join(root, 'scripts/d1-read-budget-r3-worker-manifest.json')
const orderEditScopeR1Path = path.join(root, 'scripts/order-edit-scope-r1-worker-manifest.json')
const d1ReadBudgetR4Path = path.join(root, 'scripts/d1-read-budget-r4-worker-manifest.json')
const d1ReadBudgetR53Path = path.join(root, 'scripts/d1-read-budget-r5-3-worker-manifest.json')
const d1ReadBudgetR54Path = path.join(root, 'scripts/d1-read-budget-r5-4-worker-manifest.json')
const d1ReadBudgetR56Path = path.join(root, 'scripts/d1-read-budget-r5-6-worker-manifest.json')
const d1ReadBudgetR57Path = path.join(root, 'scripts/d1-read-budget-r5-7-worker-manifest.json')
const d1ReadBudgetR58Path = path.join(root, 'scripts/d1-read-budget-r5-8-worker-manifest.json')
const d1ReadBudgetR59Path = path.join(root, 'scripts/d1-read-budget-r5-9-worker-manifest.json')
const d1ReadBudgetR510Path = path.join(root, 'scripts/d1-read-budget-r5-10-worker-manifest.json')
const runtimeSqlSyntaxR1Path = path.join(root, 'scripts/runtime-sql-syntax-r1-worker-manifest.json')
const operationalAutonomyR2WorkerPath = path.join(root, 'scripts/operational-autonomy-r2-worker-manifest.json')
const phase1bWorkshopReturnDispositionPath = path.join(root, 'scripts/phase1b-workshop-return-disposition-worker-manifest.json')
const arrivalSaveReliabilityPath = path.join(root, 'scripts/arrival-save-reliability-worker-manifest.json')
const shippingShortageHotfixPath = path.join(root, 'scripts/shipping-shortage-hotfix-worker-manifest.json')
const exchangeStaleHandoverPath = path.join(root, 'scripts/exchange-stale-handover-worker-manifest.json')
const orderEditPaymentMethodPath = path.join(root, 'scripts/order-edit-payment-method-worker-manifest.json')
const orderDeleteMobilityPath = path.join(root, 'scripts/order-delete-mobility-worker-manifest.json')
const stocktakeLostResponsePath = path.join(root, 'scripts/stocktake-lost-response-worker-manifest.json')
const financeOrderDateSyncPath = path.join(root, 'scripts/finance-order-date-sync-worker-manifest.json')
const financeF2TracePath = path.join(root, 'scripts/finance-f2-trace-worker-manifest.json')
const financeF4MoneyJournalPath = path.join(root, 'scripts/finance-f4-money-journal-worker-manifest.json')
const financeF5BusinessSemanticsPath = path.join(root, 'scripts/finance-f5-business-semantics-worker-manifest.json')
const financeF6DeleteMoneyHistoryPath = path.join(root, 'scripts/finance-f6-delete-money-history-worker-manifest.json')
const financeF6ReportSemanticsPath = path.join(root, 'scripts/finance-f6-report-semantics-worker-manifest.json')
const financeF6DeadMetricsPath = path.join(root, 'scripts/finance-f6-dead-metrics-worker-manifest.json')
const financeF9SummaryPath = path.join(root, 'scripts/finance-f9-summary-worker-manifest.json')
const financeF9DatePriorityPath = path.join(root, 'scripts/finance-f9-date-priority-worker-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function walk(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(full)
  }
  return result.sort()
}

function declarationNames(statement) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')
function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const target = path.resolve(path.dirname(fromFile), specifier)
  return target.endsWith('.ts') ? target : `${target}.ts`
}

try {
  check(fs.existsSync(manifestPath), '1906A declaration manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  check(manifest?.version === 1 && manifest?.declarationCount === 577, '1906A declaration manifest invalid')
  check(fs.existsSync(financeOrderDateSyncPath), 'Finance order-date sync Worker manifest missing')
  check(fs.existsSync(financeF2TracePath), 'Finance F2 trace Worker manifest missing')
  check(fs.existsSync(financeF4MoneyJournalPath), 'Finance F4 money journal Worker manifest missing')
  check(fs.existsSync(financeF5BusinessSemanticsPath), 'Finance F5 business semantics Worker manifest missing')
  check(fs.existsSync(financeF6DeleteMoneyHistoryPath), 'Finance F6 delete-money-history Worker manifest missing')
  check(fs.existsSync(financeF6ReportSemanticsPath), 'Finance F6 report semantics Worker manifest missing')
  check(fs.existsSync(financeF6DeadMetricsPath), 'Finance F6 dead metrics Worker manifest missing')
  check(fs.existsSync(financeF9SummaryPath), 'Finance F9 summary Worker manifest missing')
  check(fs.existsSync(financeF9DatePriorityPath), 'Finance F9 date-priority Worker manifest missing')
  const cleanup = fs.existsSync(cleanupPath) ? JSON.parse(fs.readFileSync(cleanupPath, 'utf8')) : null
  const removed = cleanup?.version === 1 ? (cleanup.removedWorkerDeclarations || {}) : {}
  const boundary = fs.existsSync(boundaryPath) ? JSON.parse(fs.readFileSync(boundaryPath, 'utf8')) : null
  const boundaryChanges = boundary?.version === 1 ? (boundary.changes || {}) : {}
  const transferRuntime = fs.existsSync(transferRuntimePath) ? JSON.parse(fs.readFileSync(transferRuntimePath, 'utf8')) : null
  const transferRuntimeChanges = transferRuntime?.version === 1 ? (transferRuntime.changes || {}) : {}
  const runtimeHardening = fs.existsSync(runtimeHardeningPath) ? JSON.parse(fs.readFileSync(runtimeHardeningPath, 'utf8')) : null
  const runtimeHardeningChanges = runtimeHardening?.version === 1 ? (runtimeHardening.changes || {}) : {}
  const adminSessionIntegrity = fs.existsSync(adminSessionIntegrityPath) ? JSON.parse(fs.readFileSync(adminSessionIntegrityPath, 'utf8')) : null
  const adminSessionIntegrityChanges = adminSessionIntegrity?.version === 1 ? (adminSessionIntegrity.changes || {}) : {}
  const warehouseTruthFreshness = fs.existsSync(warehouseTruthFreshnessPath) ? JSON.parse(fs.readFileSync(warehouseTruthFreshnessPath, 'utf8')) : null
  const warehouseTruthFreshnessChanges = warehouseTruthFreshness?.version === 1 ? (warehouseTruthFreshness.changes || {}) : {}
  const warehouseTruthFreshnessAdded = warehouseTruthFreshness?.version === 1 ? (warehouseTruthFreshness.added || {}) : {}
  const catalogTruthFinalizer = fs.existsSync(catalogTruthFinalizerPath) ? JSON.parse(fs.readFileSync(catalogTruthFinalizerPath, 'utf8')) : null
  const catalogTruthFinalizerChanges = catalogTruthFinalizer?.version === 1 ? (catalogTruthFinalizer.changes || {}) : {}
  const warehouseAttentionTruth = fs.existsSync(warehouseAttentionTruthPath) ? JSON.parse(fs.readFileSync(warehouseAttentionTruthPath, 'utf8')) : null
  const warehouseAttentionTruthChanges = warehouseAttentionTruth?.version === 1 ? (warehouseAttentionTruth.changes || {}) : {}
  const warehouseAttentionTruthAdded = warehouseAttentionTruth?.version === 1 ? (warehouseAttentionTruth.added || {}) : {}
  const dailyWarehouse = fs.existsSync(dailyWarehousePath) ? JSON.parse(fs.readFileSync(dailyWarehousePath, 'utf8')) : null
  const dailyWarehouseChanges = dailyWarehouse?.version === 1 ? (dailyWarehouse.changes || {}) : {}
  const dailyWarehouseAdded = dailyWarehouse?.version === 1 ? (dailyWarehouse.added || {}) : {}
  const attentionContext = fs.existsSync(attentionContextPath) ? JSON.parse(fs.readFileSync(attentionContextPath, 'utf8')) : null
  const attentionContextChanges = attentionContext?.version === 1 ? (attentionContext.changes || {}) : {}
  const attentionContextAdded = attentionContext?.version === 1 ? (attentionContext.added || {}) : {}
  const handoverSqlAliasSafety = fs.existsSync(handoverSqlAliasSafetyPath) ? JSON.parse(fs.readFileSync(handoverSqlAliasSafetyPath, 'utf8')) : null
  const handoverSqlAliasSafetyChanges = handoverSqlAliasSafety?.version === 1 ? (handoverSqlAliasSafety.changes || {}) : {}
  const orderCreateSaveIntegrity = fs.existsSync(orderCreateSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderCreateSaveIntegrityPath, 'utf8')) : null
  const orderCreateSaveIntegrityChanges = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.changes || {}) : {}
  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}
  check(fs.existsSync(returnExchangeCancelAutonomyPath), 'Return/exchange cancel autonomy Worker manifest missing')
  const returnExchangeCancelAutonomy = JSON.parse(fs.readFileSync(returnExchangeCancelAutonomyPath, 'utf8'))
  check(returnExchangeCancelAutonomy?.version === 1 && returnExchangeCancelAutonomy?.revision === 'return-exchange-cancel-autonomy-r1', 'Return/exchange cancel autonomy Worker manifest invalid')
  const returnExchangeCancelAutonomyChanges = returnExchangeCancelAutonomy.changes || {}
  const returnExchangeCancelAutonomyAdded = returnExchangeCancelAutonomy.added || {}
  check(fs.existsSync(orderEditAutonomyPath), 'Order edit autonomy Worker manifest missing')
  const orderEditAutonomy = JSON.parse(fs.readFileSync(orderEditAutonomyPath, 'utf8'))
  check(orderEditAutonomy?.version === 1 && orderEditAutonomy?.revision === 'order-edit-autonomy-r1', 'Order edit autonomy Worker manifest invalid')
  const orderEditAutonomyChanges = orderEditAutonomy.changes || {}
  check(fs.existsSync(d1CapacityAutonomyPath), 'D1 capacity autonomy Worker manifest missing')
  const d1CapacityAutonomy = JSON.parse(fs.readFileSync(d1CapacityAutonomyPath, 'utf8'))
  check(d1CapacityAutonomy?.version === 1 && d1CapacityAutonomy?.revision === 'd1-capacity-autonomy-r1', 'D1 capacity autonomy Worker manifest invalid')
  const d1CapacityAutonomyChanges = d1CapacityAutonomy.changes || {}
  check(fs.existsSync(d1ReadBudgetPath), 'D1 read-budget R1 Worker manifest missing')
  const d1ReadBudget = JSON.parse(fs.readFileSync(d1ReadBudgetPath, 'utf8'))
  check(d1ReadBudget?.version === 1 && d1ReadBudget?.revision === 'd1-read-budget-r1', 'D1 read-budget R1 Worker manifest invalid')
  const d1ReadBudgetChanges = d1ReadBudget.changes || {}
  check(fs.existsSync(d1ReadBudgetR2Path), 'D1 read-budget R2 Worker manifest missing')
  const d1ReadBudgetR2 = JSON.parse(fs.readFileSync(d1ReadBudgetR2Path, 'utf8'))
  check(d1ReadBudgetR2?.version === 1 && d1ReadBudgetR2?.revision === 'd1-read-budget-r2', 'D1 read-budget R2 Worker manifest invalid')
  const d1ReadBudgetR2Changes = d1ReadBudgetR2.changes || {}
  check(fs.existsSync(d1ReadBudgetR3Path), 'D1 read-budget R3 Worker manifest missing')
  const d1ReadBudgetR3 = JSON.parse(fs.readFileSync(d1ReadBudgetR3Path, 'utf8'))
  check(d1ReadBudgetR3?.version === 1 && d1ReadBudgetR3?.revision === 'd1-read-budget-r3', 'D1 read-budget R3 Worker manifest invalid')
  const d1ReadBudgetR3Changes = d1ReadBudgetR3.changes || {}
  check(fs.existsSync(orderEditScopeR1Path), 'Order edit scope R1 Worker manifest missing')
  const orderEditScopeR1 = JSON.parse(fs.readFileSync(orderEditScopeR1Path, 'utf8'))
  check(orderEditScopeR1?.version === 1 && orderEditScopeR1?.revision === 'order-edit-scope-r1', 'Order edit scope R1 Worker manifest invalid')
  const orderEditScopeR1Changes = orderEditScopeR1.changes || {}
  check(fs.existsSync(d1ReadBudgetR4Path), 'D1 read-budget R4 Worker manifest missing')
  const d1ReadBudgetR4 = JSON.parse(fs.readFileSync(d1ReadBudgetR4Path, 'utf8'))
  check(d1ReadBudgetR4?.version === 1 && d1ReadBudgetR4?.revision === 'd1-read-budget-r4', 'D1 read-budget R4 Worker manifest invalid')
  const d1ReadBudgetR4Changes = d1ReadBudgetR4.changes || {}
  check(fs.existsSync(d1ReadBudgetR53Path), 'D1 read-budget R5.3 Worker manifest missing')
  const d1ReadBudgetR53 = JSON.parse(fs.readFileSync(d1ReadBudgetR53Path, 'utf8'))
  check(d1ReadBudgetR53?.version === 1 && d1ReadBudgetR53?.revision === 'd1-read-budget-r5-3', 'D1 read-budget R5.3 Worker manifest invalid')
  const d1ReadBudgetR53Changes = d1ReadBudgetR53.changes || {}
  check(fs.existsSync(d1ReadBudgetR54Path), 'D1 read-budget R5.4 Worker manifest missing')
  const d1ReadBudgetR54 = JSON.parse(fs.readFileSync(d1ReadBudgetR54Path, 'utf8'))
  check(d1ReadBudgetR54?.version === 1 && d1ReadBudgetR54?.revision === 'd1-read-budget-r5-4', 'D1 read-budget R5.4 Worker manifest invalid')
  const d1ReadBudgetR54Changes = d1ReadBudgetR54.changes || {}
  check(fs.existsSync(d1ReadBudgetR56Path), 'D1 read-budget R5.6 Worker manifest missing')
  const d1ReadBudgetR56 = JSON.parse(fs.readFileSync(d1ReadBudgetR56Path, 'utf8'))
  check(d1ReadBudgetR56?.version === 1 && d1ReadBudgetR56?.revision === 'd1-read-budget-r5-6', 'D1 read-budget R5.6 Worker manifest invalid')
  const d1ReadBudgetR56Changes = d1ReadBudgetR56.changes || {}
  check(fs.existsSync(d1ReadBudgetR57Path), 'D1 read-budget R5.7 Worker manifest missing')
  const d1ReadBudgetR57 = JSON.parse(fs.readFileSync(d1ReadBudgetR57Path, 'utf8'))
  check(d1ReadBudgetR57?.version === 1 && d1ReadBudgetR57?.revision === 'd1-read-budget-r5-7', 'D1 read-budget R5.7 Worker manifest invalid')
  const d1ReadBudgetR57Changes = d1ReadBudgetR57.changes || {}
  check(fs.existsSync(d1ReadBudgetR58Path), 'D1 read-budget R5.8 Worker manifest missing')
  const d1ReadBudgetR58 = JSON.parse(fs.readFileSync(d1ReadBudgetR58Path, 'utf8'))
  check(d1ReadBudgetR58?.version === 1 && d1ReadBudgetR58?.revision === 'd1-read-budget-r5-8', 'D1 read-budget R5.8 Worker manifest invalid')
  const d1ReadBudgetR58Changes = d1ReadBudgetR58.changes || {}
  check(fs.existsSync(d1ReadBudgetR59Path), 'D1 read-budget R5.9 Worker manifest missing')
  const d1ReadBudgetR59 = JSON.parse(fs.readFileSync(d1ReadBudgetR59Path, 'utf8'))
  check(d1ReadBudgetR59?.version === 1 && d1ReadBudgetR59?.revision === 'd1-read-budget-r5-9', 'D1 read-budget R5.9 Worker manifest invalid')
  const d1ReadBudgetR59Changes = d1ReadBudgetR59.changes || {}
  check(fs.existsSync(d1ReadBudgetR510Path), 'D1 read-budget R5.10 Worker manifest missing')
  const d1ReadBudgetR510 = JSON.parse(fs.readFileSync(d1ReadBudgetR510Path, 'utf8'))
  check(d1ReadBudgetR510?.version === 1 && d1ReadBudgetR510?.revision === 'd1-read-budget-r5-10', 'D1 read-budget R5.10 Worker manifest invalid')
  const d1ReadBudgetR510Changes = d1ReadBudgetR510.changes || {}
  check(fs.existsSync(runtimeSqlSyntaxR1Path), 'Runtime SQL syntax R1 Worker manifest missing')
  const runtimeSqlSyntaxR1 = JSON.parse(fs.readFileSync(runtimeSqlSyntaxR1Path, 'utf8'))
  check(runtimeSqlSyntaxR1?.version === 1 && runtimeSqlSyntaxR1?.revision === 'runtime-sql-syntax-r1', 'Runtime SQL syntax R1 Worker manifest invalid')
  const runtimeSqlSyntaxR1Changes = runtimeSqlSyntaxR1.changes || {}
  check(fs.existsSync(operationalAutonomyR2WorkerPath), 'Operational autonomy R2 Worker manifest missing')
  const operationalAutonomyR2Worker = JSON.parse(fs.readFileSync(operationalAutonomyR2WorkerPath, 'utf8'))
  check(operationalAutonomyR2Worker?.version === 1 && operationalAutonomyR2Worker?.revision === 'operational-autonomy-r2', 'Operational autonomy R2 Worker manifest invalid')
  check(fs.existsSync(phase1bWorkshopReturnDispositionPath), 'Phase 1B Workshop return disposition Worker manifest missing')
  const phase1bWorkshopReturnDisposition = JSON.parse(fs.readFileSync(phase1bWorkshopReturnDispositionPath, 'utf8'))
  check(phase1bWorkshopReturnDisposition?.version === 1 && phase1bWorkshopReturnDisposition?.revision === 'phase1b-workshop-return-disposition-r1', 'Phase 1B Workshop return disposition Worker manifest invalid')
  const phase1bWorkshopReturnDispositionChanges = phase1bWorkshopReturnDisposition.changes || {}
  check(fs.existsSync(arrivalSaveReliabilityPath), 'Arrival save reliability Worker manifest missing')
  const arrivalSaveReliability = JSON.parse(fs.readFileSync(arrivalSaveReliabilityPath, 'utf8'))
  check(arrivalSaveReliability?.version === 1 && arrivalSaveReliability?.revision === 'arrival-save-reliability-r1', 'Arrival save reliability Worker manifest invalid')
  const arrivalSaveReliabilityChanges = arrivalSaveReliability.changes || {}
  check(fs.existsSync(shippingShortageHotfixPath), 'Shipping shortage hotfix Worker manifest missing')
  const shippingShortageHotfix = JSON.parse(fs.readFileSync(shippingShortageHotfixPath, 'utf8'))
  check(shippingShortageHotfix?.version === 1 && shippingShortageHotfix?.revision === 'shipping-shortage-nonblocking-r1', 'Shipping shortage hotfix Worker manifest invalid')
  const shippingShortageHotfixChanges = shippingShortageHotfix.changes || {}
  check(fs.existsSync(exchangeStaleHandoverPath), 'Exchange stale-handover Worker manifest missing')
  const exchangeStaleHandover = JSON.parse(fs.readFileSync(exchangeStaleHandoverPath, 'utf8'))
  check(exchangeStaleHandover?.version === 1 && exchangeStaleHandover?.revision === 'exchange-stale-handover-r1', 'Exchange stale-handover Worker manifest invalid')
  const exchangeStaleHandoverChanges = exchangeStaleHandover.changes || {}
  check(fs.existsSync(orderEditPaymentMethodPath), 'Order edit payment-method Worker manifest missing')
  const orderEditPaymentMethod = JSON.parse(fs.readFileSync(orderEditPaymentMethodPath, 'utf8'))
  check(orderEditPaymentMethod?.version === 1 && orderEditPaymentMethod?.revision === 'order-edit-payment-method-r1', 'Order edit payment-method Worker manifest invalid')
  const orderEditPaymentMethodChanges = orderEditPaymentMethod.changes || {}
  check(fs.existsSync(orderDeleteMobilityPath), 'Order delete mobility Worker manifest missing')
  const orderDeleteMobility = JSON.parse(fs.readFileSync(orderDeleteMobilityPath, 'utf8'))
  check(orderDeleteMobility?.version === 1 && orderDeleteMobility?.revision === 'order-delete-mobility-r1', 'Order delete mobility Worker manifest invalid')
  const orderDeleteMobilityAdded = orderDeleteMobility.added || {}
  const stocktakeLostResponse = fs.existsSync(stocktakeLostResponsePath) ? JSON.parse(fs.readFileSync(stocktakeLostResponsePath, 'utf8')) : null
  const stocktakeLostResponseChanges = stocktakeLostResponse?.version === 1 ? (stocktakeLostResponse.changes || {}) : {}
  const financeOrderDateSync = fs.existsSync(financeOrderDateSyncPath) ? JSON.parse(fs.readFileSync(financeOrderDateSyncPath, 'utf8')) : null
  const financeOrderDateSyncChanges = financeOrderDateSync?.version === 1 ? (financeOrderDateSync.changes || {}) : {}
  const financeF2Trace = fs.existsSync(financeF2TracePath) ? JSON.parse(fs.readFileSync(financeF2TracePath, 'utf8')) : null
  const financeF2TraceChanges = financeF2Trace?.version === 1 ? (financeF2Trace.changes || {}) : {}
  const financeF4MoneyJournal = fs.existsSync(financeF4MoneyJournalPath) ? JSON.parse(fs.readFileSync(financeF4MoneyJournalPath, 'utf8')) : null
  const financeF4MoneyJournalChanges = financeF4MoneyJournal?.version === 1 ? (financeF4MoneyJournal.changes || {}) : {}
  const financeF5BusinessSemantics = fs.existsSync(financeF5BusinessSemanticsPath) ? JSON.parse(fs.readFileSync(financeF5BusinessSemanticsPath, 'utf8')) : null
  const financeF5BusinessSemanticsChanges = financeF5BusinessSemantics?.version === 1 ? (financeF5BusinessSemantics.changes || {}) : {}
  const financeF6DeleteMoneyHistory = fs.existsSync(financeF6DeleteMoneyHistoryPath) ? JSON.parse(fs.readFileSync(financeF6DeleteMoneyHistoryPath, 'utf8')) : null
  const financeF6DeleteMoneyHistoryChanges = financeF6DeleteMoneyHistory?.version === 1 ? (financeF6DeleteMoneyHistory.changes || {}) : {}
  const financeF6ReportSemantics = fs.existsSync(financeF6ReportSemanticsPath) ? JSON.parse(fs.readFileSync(financeF6ReportSemanticsPath, 'utf8')) : null
  const financeF6ReportSemanticsChanges = financeF6ReportSemantics?.version === 1 ? (financeF6ReportSemantics.changes || {}) : {}
  const financeF6DeadMetrics = fs.existsSync(financeF6DeadMetricsPath) ? JSON.parse(fs.readFileSync(financeF6DeadMetricsPath, 'utf8')) : null
  const financeF6DeadMetricsChanges = financeF6DeadMetrics?.version === 1 ? (financeF6DeadMetrics.changes || {}) : {}
  const financeF9Summary = fs.existsSync(financeF9SummaryPath) ? JSON.parse(fs.readFileSync(financeF9SummaryPath, 'utf8')) : null
  const financeF9SummaryChanges = financeF9Summary?.version === 1 ? (financeF9Summary.changes || {}) : {}
  const financeF9DatePriority = fs.existsSync(financeF9DatePriorityPath) ? JSON.parse(fs.readFileSync(financeF9DatePriorityPath, 'utf8')) : null
  const financeF9DatePriorityChanges = financeF9DatePriority?.version === 1 ? (financeF9DatePriority.changes || {}) : {}

  const files = walk(workerRoot)
  const indexPath = path.join(workerRoot, 'index.ts')
  check(files.length >= 28, `Worker module tree unexpectedly small: ${files.length}`)
  check(fs.existsSync(indexPath), 'worker/index.ts missing')

  const required = [
    'core/http.ts', 'core/settings.ts', 'core/sql.ts', 'core/text.ts', 'core/types.ts',
    'domains/auth.ts', 'domains/critical.ts', 'domains/catalog.ts', 'domains/money.ts', 'domains/order-delete.ts',
    'domains/activity.ts', 'domains/cash.ts', 'domains/finance-reports.ts', 'domains/order-core.ts',
    'domains/storage.ts', 'domains/references.ts', 'domains/orders-relations.ts', 'domains/clients.ts',
    'domains/workshop-schema.ts', 'domains/inventory-reservations.ts', 'domains/inventory-primitives.ts',
    'domains/inventory-stocktake.ts', 'domains/inventory-read.ts', 'domains/inventory-movement.ts',
    'domains/orders-read.ts', 'domains/order-reservations.ts', 'domains/catalog-review.ts', 'domains/orders-write.ts',
    'domains/lifecycle.ts', 'domains/returns-exchanges.ts', 'domains/workshop-matching.ts', 'domains/workshop.ts', 'domains/team.ts', 'domains/warehouse-attention.ts',
  ]
  if (!cleanup) required.push('domains/imports.ts')
  for (const relative of required) check(fs.existsSync(path.join(workerRoot, relative)), `Worker module missing: ${relative}`)
  if (cleanup) check(!fs.existsSync(path.join(workerRoot, 'domains/imports.ts')), 'Retired imports.ts unexpectedly returned')

  const indexText = fs.readFileSync(indexPath, 'utf8')
  check(indexText.includes("structuralModularization: '1906a'"), '1906A live health marker missing')
  check(indexText.split(/\r?\n/).length <= 1600, `worker/index.ts is no longer a composition root (${indexText.split(/\r?\n/).length} lines)`)
  for (const forbidden of ['async function createOrder', 'async function applyInventoryMovement', 'async function createReturn', 'async function listTeamActivity']) check(!indexText.includes(forbidden), `Domain logic leaked back into worker/index.ts: ${forbidden}`)

  const declarations = new Map()
  let currentRouter = ''
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    check(!text.includes('@ts-nocheck'), `Worker module disables type checking: ${path.relative(root, file)}`)
    if (file !== indexPath) check(fs.statSync(file).size <= 240_000, `Worker module is still too large: ${path.relative(root, file)} (${fs.statSync(file).size} bytes)`)
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of source.statements) {
      for (const name of declarationNames(statement)) {
        check(!declarations.has(name), `Duplicate top-level Worker declaration after split: ${name}`)
        declarations.set(name, normalizeMovedDeclaration(statement.getText(source)))
      }
      if (file === indexPath && ts.isExportAssignment(statement)) currentRouter = statement.getText(source)
    }
  }

  const removedNames = Object.keys(removed)
  const expectedDeclarationCount = manifest.declarationCount - removedNames.length + Object.keys(warehouseTruthFreshnessAdded).length + Object.keys(warehouseAttentionTruthAdded).length + Object.keys(dailyWarehouseAdded).length + Object.keys(attentionContextAdded).length + Object.keys(orderCreateSaveIntegrityAdded).length + Object.keys(orderDeleteMobilityAdded).length + Object.keys(returnExchangeCancelAutonomyAdded).length
  check(declarations.size === expectedDeclarationCount, `Worker declaration count changed outside accepted allow-lists: ${declarations.size}/${expectedDeclarationCount}`)
  for (const [name, expectedHash] of Object.entries(manifest.declarations)) {
    if (Object.hasOwn(removed, name)) {
      check(removed[name] === expectedHash, `1906C removal hash does not match accepted 1906A declaration: ${name}`)
      check(!declarations.has(name), `Retired Worker declaration unexpectedly returned: ${name}`)
      continue
    }
    check(declarations.has(name), `Worker declaration disappeared outside cleanup allow-list: ${name}`)
    const cleanupChanged = cleanup?.changedWorkerDeclarations?.[name]
    const acceptedPreBoundaryHash = cleanupChanged ? cleanupChanged.after : expectedHash
    if (cleanupChanged) check(cleanupChanged.before === expectedHash, `1906C changed declaration baseline hash mismatch: ${name}`)
    const boundaryChanged = boundaryChanges[name]
    let acceptedPostBoundaryHash = acceptedPreBoundaryHash
    if (boundaryChanged) {
      check(boundaryChanged.before === acceptedPreBoundaryHash, `1906E declaration baseline hash mismatch: ${name}`)
      acceptedPostBoundaryHash = boundaryChanged.after
    }
    const transferRuntimeChanged = transferRuntimeChanges[name]
    let acceptedPostTransferHash = acceptedPostBoundaryHash
    if (transferRuntimeChanged) {
      check(transferRuntimeChanged.before === acceptedPostBoundaryHash, `191D declaration baseline hash mismatch: ${name}`)
      acceptedPostTransferHash = transferRuntimeChanged.after
    }
    const runtimeHardeningChanged = runtimeHardeningChanges[name]
    let acceptedPostRuntimeHardeningHash = acceptedPostTransferHash
    if (runtimeHardeningChanged) {
      check(runtimeHardeningChanged.before === acceptedPostTransferHash, `191E declaration baseline hash mismatch: ${name}`)
      acceptedPostRuntimeHardeningHash = runtimeHardeningChanged.after
    }
    const adminSessionIntegrityChanged = adminSessionIntegrityChanges[name]
    let acceptedPostAdminSessionHash = acceptedPostRuntimeHardeningHash
    if (adminSessionIntegrityChanged) {
      check(adminSessionIntegrityChanged.before === acceptedPostRuntimeHardeningHash, `191F declaration baseline hash mismatch: ${name}`)
      acceptedPostAdminSessionHash = adminSessionIntegrityChanged.after
    }
    const warehouseTruthFreshnessChanged = warehouseTruthFreshnessChanges[name]
    let acceptedPostWarehouseTruthHash = acceptedPostAdminSessionHash
    if (warehouseTruthFreshnessChanged) {
      check(warehouseTruthFreshnessChanged.before === acceptedPostAdminSessionHash, `192A1 declaration baseline hash mismatch: ${name}`)
      acceptedPostWarehouseTruthHash = warehouseTruthFreshnessChanged.after
    }
    const catalogTruthFinalizerChanged = catalogTruthFinalizerChanges[name]
    let acceptedPostCatalogTruthHash = acceptedPostWarehouseTruthHash
    if (catalogTruthFinalizerChanged) {
      check(catalogTruthFinalizerChanged.before === acceptedPostWarehouseTruthHash, `192A2 declaration baseline hash mismatch: ${name}`)
      acceptedPostCatalogTruthHash = catalogTruthFinalizerChanged.after
    }
    const warehouseAttentionTruthChanged = warehouseAttentionTruthChanges[name]
    let acceptedPostWarehouseAttentionHash = acceptedPostCatalogTruthHash
    if (warehouseAttentionTruthChanged) {
      check(warehouseAttentionTruthChanged.before === acceptedPostCatalogTruthHash, `192B1 declaration baseline hash mismatch: ${name}`)
      acceptedPostWarehouseAttentionHash = warehouseAttentionTruthChanged.after
    }
    const dailyWarehouseChanged = dailyWarehouseChanges[name]
    let acceptedPostDailyWarehouseHash = acceptedPostWarehouseAttentionHash
    if (dailyWarehouseChanged) {
      check(dailyWarehouseChanged.before === acceptedPostWarehouseAttentionHash, `192B2A declaration baseline hash mismatch: ${name}`)
      acceptedPostDailyWarehouseHash = dailyWarehouseChanged.after
    }
    const attentionContextChanged = attentionContextChanges[name]
    let acceptedPostAttentionContextHash = acceptedPostDailyWarehouseHash
    if (attentionContextChanged) {
      check(attentionContextChanged.before === acceptedPostDailyWarehouseHash, `192B2A2 declaration baseline hash mismatch: ${name}`)
      acceptedPostAttentionContextHash = attentionContextChanged.after
    }
    const handoverSqlAliasSafetyChanged = handoverSqlAliasSafetyChanges[name]
    let acceptedPostHandoverSqlAliasHash = acceptedPostAttentionContextHash
    if (handoverSqlAliasSafetyChanged) {
      check(handoverSqlAliasSafetyChanged.before === acceptedPostAttentionContextHash, `192B2A3 declaration baseline hash mismatch: ${name}`)
      acceptedPostHandoverSqlAliasHash = handoverSqlAliasSafetyChanged.after
    }
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    let acceptedPostOrderCreateSaveHash = acceptedPostHandoverSqlAliasHash
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 declaration baseline hash mismatch: ${name}`)
      acceptedPostOrderCreateSaveHash = orderCreateSaveIntegrityChanged.after
    }
    const stocktakeLostResponseChanged = stocktakeLostResponseChanges[name]
    let acceptedPostStocktakeLostResponseHash = acceptedPostOrderCreateSaveHash
    if (stocktakeLostResponseChanged) {
      check(stocktakeLostResponseChanged.before === acceptedPostOrderCreateSaveHash, `Stocktake lost-response declaration baseline hash mismatch: ${name}`)
      acceptedPostStocktakeLostResponseHash = stocktakeLostResponseChanged.after
    }
    const financeOrderDateSyncChanged = financeOrderDateSyncChanges[name]
    let acceptedPostFinanceOrderDateSyncHash = acceptedPostStocktakeLostResponseHash
    if (financeOrderDateSyncChanged) {
      check(financeOrderDateSyncChanged.before === acceptedPostStocktakeLostResponseHash, `Finance order-date sync declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceOrderDateSyncHash = financeOrderDateSyncChanged.after
    }
    const financeF2TraceChanged = financeF2TraceChanges[name]
    let acceptedPostFinanceF2TraceHash = acceptedPostFinanceOrderDateSyncHash
    if (financeF2TraceChanged) {
      check(financeF2TraceChanged.before === acceptedPostFinanceOrderDateSyncHash, `Finance F2 trace declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF2TraceHash = financeF2TraceChanged.after
    }
    const financeF4MoneyJournalChanged = financeF4MoneyJournalChanges[name]
    let acceptedPostFinanceF4MoneyJournalHash = acceptedPostFinanceF2TraceHash
    if (financeF4MoneyJournalChanged) {
      check(financeF4MoneyJournalChanged.before === acceptedPostFinanceF2TraceHash, `Finance F4 money journal declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF4MoneyJournalHash = financeF4MoneyJournalChanged.after
    }
    const financeF5BusinessSemanticsChanged = financeF5BusinessSemanticsChanges[name]
    let acceptedPostFinanceF5BusinessSemanticsHash = acceptedPostFinanceF4MoneyJournalHash
    if (financeF5BusinessSemanticsChanged) {
      check(financeF5BusinessSemanticsChanged.before === acceptedPostFinanceF4MoneyJournalHash, `Finance F5 business semantics declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF5BusinessSemanticsHash = financeF5BusinessSemanticsChanged.after
    }
    const financeF6DeleteMoneyHistoryChanged = financeF6DeleteMoneyHistoryChanges[name]
    let acceptedPostFinanceF6DeleteMoneyHistoryHash = acceptedPostFinanceF5BusinessSemanticsHash
    if (financeF6DeleteMoneyHistoryChanged) {
      check(financeF6DeleteMoneyHistoryChanged.before === acceptedPostFinanceF5BusinessSemanticsHash, `Finance F6 delete-money-history declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF6DeleteMoneyHistoryHash = financeF6DeleteMoneyHistoryChanged.after
    }
    const financeF6ReportSemanticsChanged = financeF6ReportSemanticsChanges[name]
    let acceptedPostFinanceF6ReportSemanticsHash = acceptedPostFinanceF6DeleteMoneyHistoryHash
    if (financeF6ReportSemanticsChanged) {
      check(financeF6ReportSemanticsChanged.before === acceptedPostFinanceF6DeleteMoneyHistoryHash, `Finance F6 report-semantics declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF6ReportSemanticsHash = financeF6ReportSemanticsChanged.after
    }
    const financeF6DeadMetricsChanged = financeF6DeadMetricsChanges[name]
    let acceptedPostFinanceF6DeadMetricsHash = acceptedPostFinanceF6ReportSemanticsHash
    if (financeF6DeadMetricsChanged) {
      check(financeF6DeadMetricsChanged.before === acceptedPostFinanceF6ReportSemanticsHash, `Finance F6 dead-metrics declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF6DeadMetricsHash = financeF6DeadMetricsChanged.after
    }
    const financeF9SummaryChanged = financeF9SummaryChanges[name]
    const acceptedPostFinanceF9SummaryHash = financeF9SummaryChanged ? financeF9SummaryChanged.after : acceptedPostFinanceF6DeadMetricsHash
    if (financeF9SummaryChanged) check(financeF9SummaryChanged.before === acceptedPostFinanceF6DeadMetricsHash, `Finance F9 summary declaration baseline hash mismatch: ${name}`)
    const financeF9DatePriorityChanged = financeF9DatePriorityChanges[name]
    let acceptedPostFinanceF9DatePriorityHash = acceptedPostFinanceF9SummaryHash
    if (financeF9DatePriorityChanged) {
      check(financeF9DatePriorityChanged.before === acceptedPostFinanceF9SummaryHash, `Finance F9 date-priority declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF9DatePriorityHash = financeF9DatePriorityChanged.after
    }
    const phase1bWorkshopReturnDispositionChanged = phase1bWorkshopReturnDispositionChanges[name]
    let acceptedPostPhase1bHash = acceptedPostFinanceF9DatePriorityHash
    if (phase1bWorkshopReturnDispositionChanged) {
      check(phase1bWorkshopReturnDispositionChanged.before === acceptedPostFinanceF9DatePriorityHash, `Phase 1B Workshop return disposition baseline hash mismatch: ${name}`)
      acceptedPostPhase1bHash = phase1bWorkshopReturnDispositionChanged.after
    }
    const arrivalSaveReliabilityChanged = arrivalSaveReliabilityChanges[name]
    let acceptedPostArrivalReliabilityHash = acceptedPostPhase1bHash
    if (arrivalSaveReliabilityChanged) {
      check(arrivalSaveReliabilityChanged.before === acceptedPostPhase1bHash, `Arrival save reliability baseline hash mismatch: ${name}`)
      acceptedPostArrivalReliabilityHash = arrivalSaveReliabilityChanged.after
    }
    const shippingShortageHotfixChanged = shippingShortageHotfixChanges[name]
    let acceptedPostShippingShortageHash = acceptedPostArrivalReliabilityHash
    if (shippingShortageHotfixChanged) {
      check(shippingShortageHotfixChanged.before === acceptedPostArrivalReliabilityHash, `Shipping shortage hotfix baseline hash mismatch: ${name}`)
      acceptedPostShippingShortageHash = shippingShortageHotfixChanged.after
    }
    const exchangeStaleHandoverChanged = exchangeStaleHandoverChanges[name]
    let acceptedPostExchangeStaleHandoverHash = acceptedPostShippingShortageHash
    if (exchangeStaleHandoverChanged) {
      check(exchangeStaleHandoverChanged.before === acceptedPostShippingShortageHash, `Exchange stale-handover baseline hash mismatch: ${name}`)
      acceptedPostExchangeStaleHandoverHash = exchangeStaleHandoverChanged.after
    }
    const orderEditPaymentMethodChanged = orderEditPaymentMethodChanges[name]
    let acceptedPostOrderEditPaymentHash = acceptedPostExchangeStaleHandoverHash
    if (orderEditPaymentMethodChanged) {
      check(orderEditPaymentMethodChanged.before === acceptedPostExchangeStaleHandoverHash, `Order edit payment-method baseline hash mismatch: ${name}`)
      acceptedPostOrderEditPaymentHash = orderEditPaymentMethodChanged.after
    }
    const returnExchangeCancelAutonomyChanged = returnExchangeCancelAutonomyChanges[name]
    let acceptedPostCancellationAutonomyHash = acceptedPostOrderEditPaymentHash
    if (returnExchangeCancelAutonomyChanged) {
      check(returnExchangeCancelAutonomyChanged.before === acceptedPostOrderEditPaymentHash, `Return/exchange cancel autonomy baseline hash mismatch: ${name}`)
      acceptedPostCancellationAutonomyHash = returnExchangeCancelAutonomyChanged.after
    }
    const orderEditAutonomyChanged = orderEditAutonomyChanges[name]
    let acceptedPostOrderEditAutonomyHash = acceptedPostCancellationAutonomyHash
    if (orderEditAutonomyChanged) {
      check(orderEditAutonomyChanged.before === acceptedPostCancellationAutonomyHash, `Order edit autonomy baseline hash mismatch: ${name}`)
      acceptedPostOrderEditAutonomyHash = orderEditAutonomyChanged.after
    }
    const d1CapacityAutonomyChanged = d1CapacityAutonomyChanges[name]
    let acceptedPostD1CapacityHash = acceptedPostOrderEditAutonomyHash
    if (d1CapacityAutonomyChanged) {
      check(d1CapacityAutonomyChanged.before === acceptedPostOrderEditAutonomyHash, `D1 capacity autonomy baseline hash mismatch: ${name}`)
      acceptedPostD1CapacityHash = d1CapacityAutonomyChanged.after
    }
    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    let acceptedPostD1ReadBudgetHash = acceptedPostD1CapacityHash
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostD1CapacityHash, `D1 read-budget R1 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetHash = d1ReadBudgetChanged.after
    }
    const d1ReadBudgetR2Changed = d1ReadBudgetR2Changes[name]
    let acceptedPostD1ReadBudgetR2Hash = acceptedPostD1ReadBudgetHash
    if (d1ReadBudgetR2Changed) {
      check(d1ReadBudgetR2Changed.before === acceptedPostD1ReadBudgetHash, `D1 read-budget R2 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR2Hash = d1ReadBudgetR2Changed.after
    }
    const d1ReadBudgetR3Changed = d1ReadBudgetR3Changes[name]
    let acceptedPostD1ReadBudgetR3Hash = acceptedPostD1ReadBudgetR2Hash
    if (d1ReadBudgetR3Changed) {
      check(d1ReadBudgetR3Changed.before === acceptedPostD1ReadBudgetR2Hash, `D1 read-budget R3 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR3Hash = d1ReadBudgetR3Changed.after
    }
    const orderEditScopeR1Changed = orderEditScopeR1Changes[name]
    let acceptedPostOrderEditScopeHash = acceptedPostD1ReadBudgetR3Hash
    if (orderEditScopeR1Changed) {
      check(orderEditScopeR1Changed.before === acceptedPostD1ReadBudgetR3Hash, `Order edit scope R1 baseline hash mismatch: ${name}`)
      acceptedPostOrderEditScopeHash = orderEditScopeR1Changed.after
    }
    const d1ReadBudgetR4Changed = d1ReadBudgetR4Changes[name]
    let acceptedPostD1ReadBudgetR4Hash = acceptedPostOrderEditScopeHash
    if (d1ReadBudgetR4Changed) {
      check(d1ReadBudgetR4Changed.before === acceptedPostOrderEditScopeHash, `D1 read-budget R4 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR4Hash = d1ReadBudgetR4Changed.after
    }
    const d1ReadBudgetR53Changed = d1ReadBudgetR53Changes[name]
    let acceptedPostD1ReadBudgetR53Hash = acceptedPostD1ReadBudgetR4Hash
    if (d1ReadBudgetR53Changed) {
      check(d1ReadBudgetR53Changed.before === acceptedPostD1ReadBudgetR4Hash, `D1 read-budget R5.3 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR53Hash = d1ReadBudgetR53Changed.after
    }
    const d1ReadBudgetR56Changed = d1ReadBudgetR56Changes[name]
    let acceptedPostD1ReadBudgetR56Hash = acceptedPostD1ReadBudgetR53Hash
    if (d1ReadBudgetR56Changed) {
      check(d1ReadBudgetR56Changed.before === acceptedPostD1ReadBudgetR53Hash, `D1 read-budget R5.6 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR56Hash = d1ReadBudgetR56Changed.after
    }
    const d1ReadBudgetR57Changed = d1ReadBudgetR57Changes[name]
    let acceptedPostD1ReadBudgetR57Hash = acceptedPostD1ReadBudgetR56Hash
    if (d1ReadBudgetR57Changed) {
      check(d1ReadBudgetR57Changed.before === acceptedPostD1ReadBudgetR56Hash, `D1 read-budget R5.7 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR57Hash = d1ReadBudgetR57Changed.after
    }
    const d1ReadBudgetR58Changed = d1ReadBudgetR58Changes[name]
    let acceptedPostD1ReadBudgetR58Hash = acceptedPostD1ReadBudgetR57Hash
    if (d1ReadBudgetR58Changed) {
      check(d1ReadBudgetR58Changed.before === acceptedPostD1ReadBudgetR57Hash, `D1 read-budget R5.8 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR58Hash = d1ReadBudgetR58Changed.after
    }
    const d1ReadBudgetR59Changed = d1ReadBudgetR59Changes[name]
    let acceptedPostD1ReadBudgetR59Hash = acceptedPostD1ReadBudgetR58Hash
    if (d1ReadBudgetR59Changed) {
      check(d1ReadBudgetR59Changed.before === acceptedPostD1ReadBudgetR58Hash, `D1 read-budget R5.9 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR59Hash = d1ReadBudgetR59Changed.after
    }
    const d1ReadBudgetR510Changed = d1ReadBudgetR510Changes[name]
    if (d1ReadBudgetR510Changed) {
      check(d1ReadBudgetR510Changed.before === acceptedPostD1ReadBudgetR59Hash, `D1 read-budget R5.10 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR510Changed.after, `Worker declaration changed beyond exact D1 read-budget R5.10 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR59Hash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)
    }
  }

  // Shipping hotfix 2026-09-01: normalize only this retired final-shipping blocker
  // back to the accepted router baseline. The shipping regression requires it absent live.
  const normalizedRouter = currentRouter
    .replace(/\n\s*const orderDeleteMatch = url\.pathname\.match\(\/\^\\\/api\\\/orders\\\/\(\\d\+\)\\\/delete\$\/\);[\s\S]*?(?=\n\s*const orderMatch = url\.pathname\.match)/, '')
    .replace(
      "          const blockers = await getOrderShipmentInventoryBlockers(env.DB, id);",
      `          const handoverReviewBlockers = await orderHandoverReviewBlockers(env.DB, id);
          if (handoverReviewBlockers.length) {
            return json({
              ok: false,
              code: 'stock_handover_review_required',
              message: 'Перед отправкой уточните товары со Склада и Бутика: после даты заказа была физическая ревизия или сверка, поэтому нужно один раз подтвердить, где находился товар в тот момент.',
              items: handoverReviewBlockers,
            }, { status: 409 });
          }
          const blockers = await getOrderShipmentInventoryBlockers(env.DB, id);`,
    )
    .replace(
      "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {\n        return json(await listInventoryCycleCountSuggestions(env.DB, url));\n      }",
      "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {\n        const denied = requireAdminAccess(request);\n        if (denied) return denied;\n        return json(await listInventoryCycleCountSuggestions(env.DB, url));\n      }",
    )
    .replace(/\n\s*orderEditAutonomy:\s*'192b2a6',\s*\n/, '\n')
    .replace(/\n\s*returnExchangeCancelAutonomy:\s*'192b2a5',\s*\n/, '\n')
    .replace(/\n\s*orderCreateSaveIntegrity:\s*'192b2a4',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionContextFix:\s*'192b2a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseDailyAttentionUx:\s*'192b2a',\s*\n/, '\n')
    .replace(/\n\s*warehouseAttentionTruthGates:\s*'192b1',\s*\n/, '\n')
    .replace(/\n\s*catalogTruthFinalizer:\s*'192a2',\s*\n/, '\n')
    .replace(/\n\s*warehouseTruthFreshness:\s*'192a1',\s*\n/, '\n')
    .replace(/\n\s*adminSessionIntegrity:\s*'191f',\s*\n/, '\n')
    .replace(/\n\s*runtimeLimitsAtomicity:\s*'191e',\s*\n/, '\n')
    .replace(/\n\s*transferRuntimeSafety:\s*'191d',\s*\n/, '\n')
    .replace(/\n\s*typeApiBoundaryCleanup:\s*'1906e',\s*\n/, '\n')
    .replace(/\n\s*bundleLazyLoading:\s*'1906d',\s*\n/, '\n')
    .replace(/\n\s*deadLegacyCleanup:\s*'1906c',\s*\n/, '\n')
    .replace(/\n\s*frontendControllerModularization:\s*'1906b',\s*\n/, '\n')
    .replace(/\n\s*structuralModularization:\s*'1906a',\s*\n/, '\n')
  const pre191eRouterHash = cleanup ? cleanup.postCleanupWorkerRouterHash : manifest.routerHash
  let acceptedPostRuntimeRouterHash = pre191eRouterHash
  if (runtimeHardening) {
    check(runtimeHardening.router?.before === pre191eRouterHash, '191E router baseline hash mismatch')
    acceptedPostRuntimeRouterHash = runtimeHardening.router.after
  }
  let acceptedPostAdminRouterHash = acceptedPostRuntimeRouterHash
  if (adminSessionIntegrity) {
    check(adminSessionIntegrity.router?.before === acceptedPostRuntimeRouterHash, '191F router baseline hash mismatch')
    acceptedPostAdminRouterHash = adminSessionIntegrity.router.after
  }
  let acceptedPostWarehouseRouterHash = acceptedPostAdminRouterHash
  if (warehouseTruthFreshness) {
    check(warehouseTruthFreshness.router?.before === acceptedPostAdminRouterHash, '192A1 router baseline hash mismatch')
    acceptedPostWarehouseRouterHash = warehouseTruthFreshness.router.after
  }
  let acceptedPostCatalogRouterHash = acceptedPostWarehouseRouterHash
  if (catalogTruthFinalizer) {
    check(catalogTruthFinalizer.router?.before === acceptedPostWarehouseRouterHash, '192A2 router baseline hash mismatch')
    acceptedPostCatalogRouterHash = catalogTruthFinalizer.router.after
  }
  let acceptedPostAttentionRouterHash = acceptedPostCatalogRouterHash
  if (warehouseAttentionTruth) {
    check(warehouseAttentionTruth.router?.before === acceptedPostCatalogRouterHash, '192B1 router baseline hash mismatch')
    acceptedPostAttentionRouterHash = warehouseAttentionTruth.router.after
  }
  let acceptedPostDailyRouterHash = acceptedPostAttentionRouterHash
  if (dailyWarehouse) {
    check(dailyWarehouse.router?.before === acceptedPostAttentionRouterHash, '192B2A router baseline hash mismatch')
    acceptedPostDailyRouterHash = dailyWarehouse.router.after
  }
  let acceptedPostAttentionContextRouterHash = acceptedPostDailyRouterHash
  if (attentionContext) {
    check(attentionContext.router?.before === acceptedPostDailyRouterHash, '192B2A2 router baseline hash mismatch')
    acceptedPostAttentionContextRouterHash = attentionContext.router.after
  }
  let acceptedPostOrderCreateRouterHash = acceptedPostAttentionContextRouterHash
  if (orderCreateSaveIntegrity) {
    check(orderCreateSaveIntegrity.router?.before === acceptedPostAttentionContextRouterHash, '192B2A4 router baseline hash mismatch')
    acceptedPostOrderCreateRouterHash = orderCreateSaveIntegrity.router.after
  }
  check(returnExchangeCancelAutonomy.router?.before === acceptedPostOrderCreateRouterHash, 'Return/exchange cancel autonomy router baseline hash mismatch')
  const acceptedPostCancellationAutonomyRouterHash = returnExchangeCancelAutonomy.router.after
  check(orderEditAutonomy.router?.before === acceptedPostCancellationAutonomyRouterHash, 'Order edit autonomy router baseline hash mismatch')
  const acceptedPostOrderEditAutonomyRouterHash = orderEditAutonomy.router.after
  check(operationalAutonomyR2Worker.router?.before === acceptedPostOrderEditAutonomyRouterHash, 'Operational autonomy R2 router baseline hash mismatch')
  check(sha(normalizedRouter) === operationalAutonomyR2Worker.router.after, 'Worker router changed beyond exact operational autonomy R2 delta')

  for (const [name, expectedHash] of Object.entries(warehouseTruthFreshnessAdded)) {
    check(declarations.has(name), `192A1 added Worker declaration missing: ${name}`)
    const warehouseAttentionChanged = warehouseAttentionTruthChanges[name]
    const acceptedPostAttentionHash = warehouseAttentionChanged ? warehouseAttentionChanged.after : expectedHash
    if (warehouseAttentionChanged) check(warehouseAttentionChanged.before === expectedHash, `192B1 changed 192A1-added declaration baseline hash mismatch: ${name}`)
    const dailyWarehouseChanged = dailyWarehouseChanges[name]
    const acceptedPostDailyHash = dailyWarehouseChanged ? dailyWarehouseChanged.after : acceptedPostAttentionHash
    if (dailyWarehouseChanged) check(dailyWarehouseChanged.before === acceptedPostAttentionHash, `192B2A changed 192A1-added declaration baseline hash mismatch: ${name}`)
    const attentionContextChanged = attentionContextChanges[name]
    const acceptedPostAttentionContextHash = attentionContextChanged ? attentionContextChanged.after : acceptedPostDailyHash
    if (attentionContextChanged) check(attentionContextChanged.before === acceptedPostDailyHash, `192B2A2 changed 192A1-added declaration baseline hash mismatch: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostAttentionContextHash, `192B2A4 changed 192A1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192A1-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostAttentionContextHash, `192A1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(warehouseAttentionTruthAdded)) {
    check(declarations.has(name), `192B1 added Worker declaration missing: ${name}`)
    const dailyWarehouseChanged = dailyWarehouseChanges[name]
    const acceptedPostDailyHash = dailyWarehouseChanged ? dailyWarehouseChanged.after : expectedHash
    if (dailyWarehouseChanged) check(dailyWarehouseChanged.before === expectedHash, `192B2A changed 192B1-added declaration baseline hash mismatch: ${name}`)
    const attentionContextChanged = attentionContextChanges[name]
    const acceptedPostAttentionContextHash = attentionContextChanged ? attentionContextChanged.after : acceptedPostDailyHash
    if (attentionContextChanged) check(attentionContextChanged.before === acceptedPostDailyHash, `192B2A2 changed 192B1-added declaration baseline hash mismatch: ${name}`)
    const handoverSqlAliasSafetyChanged = handoverSqlAliasSafetyChanges[name]
    const acceptedPostHandoverSqlAliasHash = handoverSqlAliasSafetyChanged ? handoverSqlAliasSafetyChanged.after : acceptedPostAttentionContextHash
    if (handoverSqlAliasSafetyChanged) check(handoverSqlAliasSafetyChanged.before === acceptedPostAttentionContextHash, `192B2A3 changed 192B1-added declaration baseline hash mismatch: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    let acceptedPostOrderCreateHash = acceptedPostHandoverSqlAliasHash
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostOrderCreateHash = orderCreateSaveIntegrityChanged.after
    }
    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    let acceptedPostD1ReadBudgetHash = acceptedPostOrderCreateHash
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostOrderCreateHash, `D1 read-budget R1 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetHash = d1ReadBudgetChanged.after
    }
    const d1ReadBudgetR2Changed = d1ReadBudgetR2Changes[name]
    let acceptedPostD1ReadBudgetR2Hash = acceptedPostD1ReadBudgetHash
    if (d1ReadBudgetR2Changed) {
      check(d1ReadBudgetR2Changed.before === acceptedPostD1ReadBudgetHash, `D1 read-budget R2 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR2Hash = d1ReadBudgetR2Changed.after
    }
    const d1ReadBudgetR3Changed = d1ReadBudgetR3Changes[name]
    let acceptedPostD1ReadBudgetR3Hash = acceptedPostD1ReadBudgetR2Hash
    if (d1ReadBudgetR3Changed) {
      check(d1ReadBudgetR3Changed.before === acceptedPostD1ReadBudgetR2Hash, `D1 read-budget R3 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR3Hash = d1ReadBudgetR3Changed.after
    }
    const d1ReadBudgetR54Changed = d1ReadBudgetR54Changes[name]
    let acceptedPostD1ReadBudgetR54Hash = acceptedPostD1ReadBudgetR3Hash
    if (d1ReadBudgetR54Changed) {
      check(d1ReadBudgetR54Changed.before === acceptedPostD1ReadBudgetR3Hash, `D1 read-budget R5.4 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetR54Hash = d1ReadBudgetR54Changed.after
    }
    const runtimeSqlSyntaxR1Changed = runtimeSqlSyntaxR1Changes[name]
    if (runtimeSqlSyntaxR1Changed) {
      check(runtimeSqlSyntaxR1Changed.before === acceptedPostD1ReadBudgetR54Hash, `Runtime SQL syntax R1 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === runtimeSqlSyntaxR1Changed.after, `192B1-added declaration changed beyond exact Runtime SQL syntax R1 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR54Hash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(dailyWarehouseAdded)) {
    check(declarations.has(name), `192B2A added Worker declaration missing: ${name}`)
    const attentionContextChanged = attentionContextChanges[name]
    const acceptedPostAttentionContextHash = attentionContextChanged ? attentionContextChanged.after : expectedHash
    if (attentionContextChanged) check(attentionContextChanged.before === expectedHash, `192B2A2 changed 192B2A-added declaration baseline hash mismatch: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostAttentionContextHash, `192B2A4 changed 192B2A-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192B2A-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostAttentionContextHash, `192B2A added Worker declaration changed: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(attentionContextAdded)) {
    check(declarations.has(name), `192B2A2 added Worker declaration missing: ${name}`)
    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === expectedHash, `192B2A4 changed 192B2A2-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `192B2A2-added declaration changed beyond exact 192B2A4 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === expectedHash, `192B2A2 added Worker declaration changed: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(orderCreateSaveIntegrityAdded)) {
    check(declarations.has(name), `192B2A4 added Worker declaration missing: ${name}`)
    const financeF5BusinessSemanticsChanged = financeF5BusinessSemanticsChanges[name]
    if (financeF5BusinessSemanticsChanged) {
      check(financeF5BusinessSemanticsChanged.before === expectedHash, `Finance F5 changed 192B2A4-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF5BusinessSemanticsChanged.after, `192B2A4-added declaration changed beyond exact Finance F5 business semantics allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === expectedHash, `192B2A4 added Worker declaration changed: ${name}`)
    }
  }

  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {
    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)
    check(sha(declarations.get(name)) === expectedHash, `Order delete mobility declaration changed beyond exact allow-list: ${name}`)
  }

  for (const [name, expectedHash] of Object.entries(returnExchangeCancelAutonomyAdded)) {
    check(declarations.has(name), `Return/exchange cancel autonomy added Worker declaration missing: ${name}`)
    check(sha(declarations.get(name)) === expectedHash, `Return/exchange cancel autonomy declaration changed beyond exact allow-list: ${name}`)
  }

  const graph = new Map(files.map((file) => [file, new Set()]))
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const target = resolveImport(file, match[1])
      if (!target || !graph.has(target)) continue
      check(target !== indexPath, `Worker domain imports composition root: ${path.relative(workerRoot, file)}`)
      graph.get(file).add(target)
    }
  }
  const visiting = new Set(), visited = new Set()
  function visit(node, chain = []) {
    if (visiting.has(node)) fail(`Circular Worker import: ${[...chain, node].map((file) => path.relative(workerRoot, file)).join(' -> ')}`)
    if (visited.has(node)) return
    visiting.add(node)
    for (const dep of graph.get(node) || []) visit(dep, [...chain, node])
    visiting.delete(node); visited.add(node)
  }
  for (const file of files) visit(file)

  const cleanupNote = cleanup ? `, ${removedNames.length} explicitly retired legacy declarations` : ''
  const boundaryNote = boundary ? `, ${Object.keys(boundaryChanges).length} exact 1906E boundary deltas` : ''
  const transferRuntimeNote = transferRuntime ? `, ${Object.keys(transferRuntimeChanges).length} exact 191D transfer-runtime delta` : ''
  const runtimeHardeningNote = runtimeHardening ? `, ${Object.keys(runtimeHardeningChanges).length} exact 191E runtime-hardening deltas` : ''
  const adminSessionIntegrityNote = adminSessionIntegrity ? `, ${Object.keys(adminSessionIntegrityChanges).length} exact 191F admin-session deltas` : ''
  const warehouseTruthFreshnessNote = warehouseTruthFreshness ? `, ${Object.keys(warehouseTruthFreshnessChanges).length} changed + ${Object.keys(warehouseTruthFreshnessAdded).length} added 192A1 warehouse-truth declarations` : ''
  const catalogTruthFinalizerNote = catalogTruthFinalizer ? `, ${Object.keys(catalogTruthFinalizerChanges).length} exact 192A2 catalog-truth delta` : ''
  const warehouseAttentionTruthNote = warehouseAttentionTruth ? `, ${Object.keys(warehouseAttentionTruthChanges).length} changed + ${Object.keys(warehouseAttentionTruthAdded).length} added 192B1 warehouse-truth declarations` : ''
  const dailyWarehouseNote = dailyWarehouse ? `, ${Object.keys(dailyWarehouseChanges).length} changed + ${Object.keys(dailyWarehouseAdded).length} added 192B2A daily-warehouse declarations` : ''
  const attentionContextNote = attentionContext ? `, ${Object.keys(attentionContextChanges).length} changed + ${Object.keys(attentionContextAdded).length} added 192B2A2 attention-context declarations` : ''
  const handoverSqlAliasSafetyNote = handoverSqlAliasSafety ? `, ${Object.keys(handoverSqlAliasSafetyChanges).length} exact 192B2A3 handover-SQL alias delta` : ''
  const orderCreateSaveIntegrityNote = orderCreateSaveIntegrity ? `, ${Object.keys(orderCreateSaveIntegrityChanges).length} changed + ${Object.keys(orderCreateSaveIntegrityAdded).length} added 192B2A4 order-save declarations` : ''
  const returnExchangeCancelAutonomyNote = `, ${Object.keys(returnExchangeCancelAutonomyChanges).length} changed + ${Object.keys(returnExchangeCancelAutonomyAdded).length} added return/exchange cancellation-autonomy declarations`
  const financeF5BusinessSemanticsNote = financeF5BusinessSemantics ? `, ${Object.keys(financeF5BusinessSemanticsChanges).length} exact Finance F5 business-semantics deltas` : ''
  console.log(`STEP 190.6A WORKER MODULARIZATION TESTS PASSED — ${files.length} TS files, ${declarations.size} preserved declarations${cleanupNote}${boundaryNote}${transferRuntimeNote}${runtimeHardeningNote}${adminSessionIntegrityNote}${warehouseTruthFreshnessNote}${catalogTruthFinalizerNote}${warehouseAttentionTruthNote}${dailyWarehouseNote}${attentionContextNote}${handoverSqlAliasSafetyNote}${orderCreateSaveIntegrityNote}${returnExchangeCancelAutonomyNote}${financeF5BusinessSemanticsNote}, 0 import cycles`)
} catch (error) {
  console.error(`STEP 190.6A WORKER MODULARIZATION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

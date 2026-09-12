import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const write = (relative, text) => fs.writeFileSync(path.join(root, relative), text)
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const mainText = (relative) => execFileSync('git', ['show', `origin/main:${relative}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

function replaceOnce(relative, oldText, newText) {
  const current = read(relative)
  const count = current.split(oldText).length - 1
  if (count !== 1) throw new Error(`${relative}: replacement anchor count ${count}, expected 1`)
  write(relative, current.replace(oldText, newText))
}

function replaceBetween(relative, startMarker, endMarker, replacement) {
  const current = read(relative)
  const start = current.indexOf(startMarker)
  if (start < 0) throw new Error(`${relative}: start marker missing`)
  const end = current.indexOf(endMarker, start)
  if (end < 0) throw new Error(`${relative}: end marker missing`)
  if (current.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error(`${relative}: start marker is not unique`)
  write(relative, current.slice(0, start) + replacement + current.slice(end))
}

// Dashboard business date must follow Kazakhstan local date, not UTC midnight.
replaceOnce(
  'worker/domains/inventory-read.ts',
  "  const today = new Date().toISOString().slice(0, 10);",
  `  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {\n    timeZone: 'Asia/Almaty',\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));\n  const today = \`${'${todayParts.year}'}-${'${todayParts.month}'}-${'${todayParts.day}'}\`;`
)

// R6.3 manager reuse currently keys by numeric manager_id only. That loses rows when
// historical orders have no live manager_id (all become 0), and can overwrite split SQL
// groups for one live manager. Aggregate by stable identity and sum duplicate groups.
const managerBlock = `  const managerIdentityKey = (managerId: number, managerName: unknown) => {\n    const normalizedName = (cleanText(managerName) || 'Не указан').replace(/\\s+/g, ' ').trim().toLocaleUpperCase('ru-RU');\n    return managerId > 0 ? \`id:\${managerId}\` : \`legacy:\${normalizedName}\`;\n  };\n  const managerDayKey = (date: unknown, managerId: number, managerName: unknown) =>\n    \`\${cleanText(date)}||\${managerIdentityKey(managerId, managerName)}\`;\n\n  const managerPaymentMap = new Map<string, { managerId: number; manager: string; colorKey: string; primary_received: number; order_extra_received: number; debt_closed: number; extra_received: number }>();\n  for (const row of mapSqlRows(managerPaymentDayRows) as any[]) {\n    const managerId = toInt(row.manager_id, 0);\n    const manager = cleanText(row.manager) || 'Не указан';\n    const key = managerDayKey(row.date, managerId, manager);\n    const current = managerPaymentMap.get(key) || {\n      managerId, manager, colorKey: normalizeManagerColor(row.color_key, managerId - 1),\n      primary_received: 0, order_extra_received: 0, debt_closed: 0, extra_received: 0,\n    };\n    current.manager = manager;\n    current.colorKey = normalizeManagerColor(row.color_key, managerId - 1);\n    current.primary_received += Number(row.primary_received || 0);\n    current.order_extra_received += Number(row.order_extra_received || 0);\n    current.debt_closed += Number(row.debt_closed || 0);\n    current.extra_received += Number(row.extra_received || 0);\n    managerPaymentMap.set(key, current);\n  }\n  const managerReturnMap = new Map<string, { managerId: number; manager: string; colorKey: string; totalReturns: number }>();\n  for (const row of mapSqlRows(managerReturnDayRows) as any[]) {\n    const managerId = toInt(row.manager_id, 0);\n    const manager = cleanText(row.manager) || 'Не указан';\n    const key = managerDayKey(row.date, managerId, manager);\n    const current = managerReturnMap.get(key) || {\n      managerId, manager, colorKey: normalizeManagerColor(row.color_key, managerId - 1), totalReturns: 0,\n    };\n    current.manager = manager;\n    current.colorKey = normalizeManagerColor(row.color_key, managerId - 1);\n    current.totalReturns += Number(row.total_returns || 0);\n    managerReturnMap.set(key, current);\n  }\n  const managerOrderMap = new Map<string, any>();\n  for (const row of mapSqlRows(managerOrderDayRows) as any[]) {\n    const managerId = toInt(row.manager_id, 0);\n    const manager = cleanText(row.manager) || 'Не указан';\n    const key = managerDayKey(row.date, managerId, manager);\n    const current = managerOrderMap.get(key) || {\n      date: cleanText(row.date), manager_id: managerId, manager,\n      color_key: normalizeManagerColor(row.color_key, managerId - 1),\n      order_count: 0, nonzero_order_count: 0, total_sales: 0, total_received: 0, total_returns: 0, total_debt: 0,\n    };\n    current.manager = manager;\n    current.color_key = normalizeManagerColor(row.color_key, managerId - 1);\n    current.order_count += Number(row.order_count || 0);\n    current.nonzero_order_count += Number(row.nonzero_order_count || 0);\n    current.total_sales += Number(row.total_sales || 0);\n    current.total_received += Number(row.total_received || 0);\n    current.total_returns += Number(row.total_returns || 0);\n    current.total_debt += Number(row.total_debt || 0);\n    managerOrderMap.set(key, current);\n  }\n  const managerKeys = new Set<string>([...managerOrderMap.keys(), ...managerPaymentMap.keys(), ...managerReturnMap.keys()]);\n  const managerDaysMap = new Map<string, any>();\n  const managerSummaryMap = new Map<string, any>();\n  for (const key of managerKeys) {\n    const separator = key.indexOf('||');\n    const date = separator >= 0 ? key.slice(0, separator) : key;\n    const row = managerOrderMap.get(key) || {};\n    const paymentInfo = managerPaymentMap.get(key) || { managerId: 0, manager: '', colorKey: '', primary_received: 0, order_extra_received: 0, debt_closed: 0, extra_received: 0 };\n    const returnInfo = managerReturnMap.get(key) || { managerId: 0, manager: '', colorKey: '', totalReturns: 0 };\n    const managerId = toInt(row.manager_id, 0) || toInt(paymentInfo.managerId, 0) || toInt(returnInfo.managerId, 0);\n    const manager = cleanText(row.manager) || paymentInfo.manager || returnInfo.manager || 'Не указан';\n    const colorKey = normalizeManagerColor(cleanText(row.color_key) || paymentInfo.colorKey || returnInfo.colorKey, managerId - 1);\n    const actualReceived = Number(paymentInfo.primary_received || 0) + Number(paymentInfo.order_extra_received || 0) + Number(paymentInfo.debt_closed || 0) + Number(paymentInfo.extra_received || 0);\n    const actualReturns = Number(returnInfo.totalReturns || 0);\n    const nonzeroOrderCount = Number(row.nonzero_order_count || 0);\n    if (!managerDaysMap.has(date)) managerDaysMap.set(date, { date, orderCount: 0, totalSales: 0, totalReceived: 0, totalReturns: 0, totalDebt: 0, managers: [] });\n    const bucket = managerDaysMap.get(date);\n    const managerRow = {\n      managerId,\n      manager,\n      colorKey,\n      order_count: Number(row.order_count || 0),\n      total_sales: Number(row.total_sales || 0),\n      total_received: actualReceived,\n      primary_received: Number(paymentInfo.primary_received || 0),\n      order_extra_received: Number(paymentInfo.order_extra_received || 0),\n      debt_closed: Number(paymentInfo.debt_closed || 0),\n      extra_received: Number(paymentInfo.extra_received || 0),\n      total_returns: actualReturns,\n      total_debt: Number(row.total_debt || 0),\n      avg_check: nonzeroOrderCount > 0 ? Math.round(Number(row.total_sales || 0) / nonzeroOrderCount) : 0,\n    };\n    const summaryKey = managerIdentityKey(managerId, manager);\n    const summary = managerSummaryMap.get(summaryKey) || {\n      manager_id: managerId,\n      manager,\n      color_key: colorKey,\n      order_count: 0,\n      total_sales: 0,\n      total_received: 0,\n      total_returns: 0,\n      total_debt: 0,\n      nonzero_order_count: 0,\n    };\n    summary.manager = manager;\n    summary.color_key = colorKey;\n    summary.order_count += managerRow.order_count;\n    summary.total_sales += managerRow.total_sales;\n    summary.total_returns += managerRow.total_returns;\n    summary.total_debt += managerRow.total_debt;\n    summary.nonzero_order_count += nonzeroOrderCount;\n    managerSummaryMap.set(summaryKey, summary);\n    bucket.orderCount += managerRow.order_count;\n    bucket.totalSales += managerRow.total_sales;\n    bucket.totalReceived += managerRow.total_received;\n    bucket.totalReturns += managerRow.total_returns;\n    bucket.totalDebt += managerRow.total_debt;\n    bucket.managers.push(managerRow);\n  }\n  for (const bucket of managerDaysMap.values()) bucket.managers.sort((a: any, b: any) => b.total_received - a.total_received || a.manager.localeCompare(b.manager, 'ru') || a.managerId - b.managerId);\n  if (!financeWorkspaceOnly) for (const operation of paymentOperations) {\n    const managerId = operation.managerId == null ? 0 : Number(operation.managerId);\n    const manager = cleanText(operation.manager) || 'Не указан';\n    const summaryKey = managerIdentityKey(managerId, manager);\n    const summary = managerSummaryMap.get(summaryKey) || {\n      manager_id: managerId,\n      manager,\n      color_key: normalizeManagerColor(operation.managerColor, managerId - 1),\n      order_count: 0,\n      total_sales: 0,\n      total_received: 0,\n      total_returns: 0,\n      total_debt: 0,\n      nonzero_order_count: 0,\n    };\n    summary.total_received += Number(operation.amount || 0);\n    managerSummaryMap.set(summaryKey, summary);\n  }\n  const normalizedManagerRows = Array.from(managerSummaryMap.values()).map((summary: any) => ({\n    manager_id: summary.manager_id,\n    manager: summary.manager,\n    color_key: summary.color_key,\n    order_count: summary.order_count,\n    total_sales: summary.total_sales,\n    total_received: summary.total_received,\n    total_returns: summary.total_returns,\n    total_debt: summary.total_debt,\n    avg_check: summary.nonzero_order_count > 0 ? summary.total_sales / summary.nonzero_order_count : 0,\n  })).sort((a, b) => Number(b.total_received || 0) - Number(a.total_received || 0) || String(a.manager).localeCompare(String(b.manager), 'ru'));\n\n`
replaceBetween(
  'worker/domains/finance-reports.ts',
  '  const managerPaymentMap = new Map<string,',
  '  const productDaysMap = new Map<string, any>();',
  managerBlock,
)

write('scripts/test-d1-read-budget-r6-3.mjs', `import fs from 'node:fs'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\n\nconst root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')\nconst source = fs.readFileSync(path.join(root, 'worker/domains/finance-reports.ts'), 'utf8')\n\nconst requireMatch = (pattern, message) => {\n  if (!pattern.test(source)) throw new Error(message)\n}\n\nif (/\\bmanagerRows\\b|\\bmanagerCashRows\\b/.test(source)) {\n  throw new Error('R6.3: dedicated manager summary result sets must be removed instead of executing redundant D1 reads.')\n}\nrequireMatch(\n  /COUNT\\(CASE WHEN o\\.total_amount <> 0 THEN 1 END\\) AS nonzero_order_count/,\n  'R6.3: manager day rows must preserve the exact non-zero-order denominator for avg_check.'\n)\nrequireMatch(\n  /const managerIdentityKey = [\\s\\S]*managerId > 0 \\? \\`id:\\$\\{managerId\\}\\` : \\`legacy:\\$\\{normalizedName\\}\\`/,\n  'R6.3: manager reuse must distinguish live manager ids from historical snapshot names.'\n)\nrequireMatch(\n  /const managerSummaryMap = new Map<string, any>\\(\\)[\\s\\S]*summary\\.order_count \\+= managerRow\\.order_count[\\s\\S]*summary\\.total_returns \\+= managerRow\\.total_returns[\\s\\S]*summary\\.nonzero_order_count \\+= nonzeroOrderCount/,\n  'R6.3: manager summary must rebuild order and return facts from already-loaded day rows without id=0 collisions.'\n)\nrequireMatch(\n  /for \\(const operation of paymentOperations\\)[\\s\\S]*const summaryKey = managerIdentityKey\\(managerId, manager\\)[\\s\\S]*summary\\.total_received \\+= Number\\(operation\\.amount \\|\\| 0\\)/,\n  'R6.3: manager summary must reuse paymentOperations with the same collision-safe identity.'\n)\nrequireMatch(\n  /avg_check: summary\\.nonzero_order_count > 0 \\? summary\\.total_sales \\/ summary\\.nonzero_order_count : 0/,\n  'R6.3: rebuilt manager avg_check must match AVG(NULLIF(total_amount, 0)) semantics without changing precision.'\n)\n\nconsole.log('D1 read budget R6.3 checks passed.')\n`)

write('scripts/test-stabilization-20260912-r2-manager-date.mjs', `import fs from 'node:fs'\nimport assert from 'node:assert/strict'\n\nconst dashboard = fs.readFileSync('worker/domains/inventory-read.ts', 'utf8')\nconst finance = fs.readFileSync('worker/domains/finance-reports.ts', 'utf8')\n\nconst dashboardStart = dashboard.indexOf('export async function getDashboardInsights')\nassert.ok(dashboardStart >= 0, 'Dashboard declaration missing')\nconst dashboardBody = dashboard.slice(dashboardStart)\nassert.ok(dashboardBody.includes("timeZone: 'Asia/Almaty'"), 'Dashboard must use Kazakhstan business timezone')\nassert.ok(dashboardBody.includes('.formatToParts(new Date())'), 'Dashboard date must be assembled from timezone-aware parts')\nassert.ok(!dashboardBody.includes("new Date().toISOString().slice(0, 10)"), 'Dashboard must not derive business day from UTC')\n\nassert.ok(finance.includes('const managerIdentityKey = (managerId: number, managerName: unknown)'), 'Collision-safe manager identity missing')\nassert.ok(finance.includes("managerId > 0 ? `id:${managerId}` : `legacy:${normalizedName}`"), 'Historical managers must not collapse into numeric id 0')\nassert.ok(finance.includes('const managerSummaryMap = new Map<string, any>()'), 'Manager summary must use stable string identities')\nassert.ok(finance.includes('current.order_count += Number(row.order_count || 0)'), 'Split manager order groups must accumulate instead of overwrite')\nassert.ok(finance.includes('current.primary_received += Number(row.primary_received || 0)'), 'Split manager payment groups must accumulate instead of overwrite')\nassert.ok(finance.includes('current.totalReturns += Number(row.total_returns || 0)'), 'Split manager return groups must accumulate instead of overwrite')\nassert.ok(!finance.includes("managerPaymentMap.set(`${cleanText(row.date)}||${managerId}`"), 'Old manager-id-only payment key must stay removed')\nassert.ok(!finance.includes('const managerSummaryMap = new Map<number, any>()'), 'Old numeric-only manager summary key must stay removed')\n\nconsole.log('September 12 stabilization R2 manager/date regression: OK')\n`)

replaceOnce(
  'package.json',
  'node scripts/test-stabilization-20260912-r1.mjs && node scripts/test-phase1c-workshop-return-safety.mjs',
  'node scripts/test-stabilization-20260912-r1.mjs && node scripts/test-stabilization-20260912-r2-manager-date.mjs && node scripts/test-phase1c-workshop-return-safety.mjs',
)

// Exact declaration hashes for the two Worker declarations changed by this package.
function declarationNames(statement) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
function declarationMap(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result = new Map()
  for (const statement of source.statements) {
    for (const name of declarationNames(statement)) result.set(name, statement.getText(source).replace(/^export\\s+/, ''))
  }
  return result
}
const workerChanges = {}
for (const relative of ['worker/domains/inventory-read.ts', 'worker/domains/finance-reports.ts']) {
  const before = declarationMap(relative, mainText(relative))
  const after = declarationMap(relative, read(relative))
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(name)
    const right = after.get(name)
    if (left === right) continue
    if (left == null || right == null) throw new Error(`Unexpected added/removed Worker declaration: ${name}`)
    workerChanges[name] = { before: sha256(left), after: sha256(right) }
  }
}
const expectedWorkerNames = ['getDashboardInsights', 'listFinanceReports']
if (JSON.stringify(Object.keys(workerChanges).sort()) !== JSON.stringify(expectedWorkerNames)) {
  throw new Error(`Unexpected R2 Worker declaration set: ${Object.keys(workerChanges).sort().join(',')}`)
}
write('scripts/stabilization-20260912-r2-manager-date-worker-manifest.json', JSON.stringify({
  version: 1,
  revision: 'stabilization-20260912-r2-manager-date',
  changes: Object.fromEntries(expectedWorkerNames.map((name) => [name, workerChanges[name]])),
}, null, 2) + '\n')

// Chain the exact R2 declaration layer after R1 without weakening any older baseline.
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  "const stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-worker-manifest.json')",
  "const stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-worker-manifest.json')\nconst stabilizationR2ManifestPath = path.join(root, 'scripts/stabilization-20260912-r2-manager-date-worker-manifest.json')",
)
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  "if (Object.keys(stabilizationManifest.changes || {}).sort().join(',') !== 'createReturn,getDashboardInsights,listWorkshopTasks,readWorkshopCounts,workshopStandaloneReturnOrdersCte') throw new Error('September 12 stabilization Worker allow-list widened unexpectedly')",
  "if (Object.keys(stabilizationManifest.changes || {}).sort().join(',') !== 'createReturn,getDashboardInsights,listWorkshopTasks,readWorkshopCounts,workshopStandaloneReturnOrdersCte') throw new Error('September 12 stabilization Worker allow-list widened unexpectedly')\nconst stabilizationR2Manifest = JSON.parse(fs.readFileSync(stabilizationR2ManifestPath, 'utf8'))\nif (stabilizationR2Manifest?.version !== 1 || stabilizationR2Manifest?.revision !== 'stabilization-20260912-r2-manager-date') throw new Error('September 12 R2 manager/date Worker manifest invalid')\nif (Object.keys(stabilizationR2Manifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('September 12 R2 manager/date Worker allow-list widened unexpectedly')",
)
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  "  + 'const stabilizationChanges = ' + JSON.stringify(stabilizationManifest.changes || {}) + '\\n')",
  "  + 'const stabilizationChanges = ' + JSON.stringify(stabilizationManifest.changes || {}) + '\\n'\n  + 'const stabilizationR2Changes = ' + JSON.stringify(stabilizationR2Manifest.changes || {}) + '\\n')",
)
replaceOnce(
  'scripts/test-step1906a-worker-modularization.mjs',
  "  '        return sha(declarations.get(name)) === acceptedPostStabilizationHash',",
  "  '        const stabilizationR2Changed = stabilizationR2Changes[name]',\n  '        let acceptedPostStabilizationR2Hash = acceptedPostStabilizationHash',\n  '        if (stabilizationR2Changed) {',\n  \"          check(stabilizationR2Changed.before === acceptedPostStabilizationHash, 'September 12 R2 manager/date baseline hash mismatch: ' + name)\",\n  '          acceptedPostStabilizationR2Hash = stabilizationR2Changed.after',\n  '        }',\n  '        return sha(declarations.get(name)) === acceptedPostStabilizationR2Hash',",
)

console.log('September 12 stabilization R2 manager/date finalizer applied.')

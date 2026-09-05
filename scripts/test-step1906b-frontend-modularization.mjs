import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const manifestPath = path.join(root, 'scripts/step1906b-frontend-preservation-manifest.json')
const cleanupPath = path.join(root, 'scripts/step1906c-dead-code-manifest.json')
const warehouseAttentionPath = path.join(root, 'scripts/step192b1-warehouse-truth-attention-manifest.json')
const dailyWarehousePath = path.join(root, 'scripts/step192b2a-daily-warehouse-manifest.json')
const attentionVisibilityPath = path.join(root, 'scripts/step192b2a1-attention-visibility-manifest.json')
const orderSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-frontend-order-save-integrity-manifest.json')
const stocktakeLostResponseFrontendPath = path.join(root, 'scripts/stocktake-lost-response-frontend-manifest.json')
const operationalAutonomyR2Path = path.join(root, 'scripts/operational-autonomy-r2-frontend-manifest.json')
const w1WarehouseReliabilityPath = path.join(root, 'scripts/w1-warehouse-reliability-frontend-manifest.json')
const w2HumanWarehousePath = path.join(root, 'scripts/w2-human-warehouse-frontend-manifest.json')
const w3WarehouseReliabilityPath = path.join(root, 'scripts/w3-1a-warehouse-reliability-frontend-manifest.json')
const w3StockMicroCheckPath = path.join(root, 'scripts/w3-1b-stock-micro-check-frontend-manifest.json')
const w3NaturalRecoveryPath = path.join(root, 'scripts/w3-2-natural-recovery-frontend-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')

function parse(relative) {
  const file = path.join(root, relative)
  check(fs.existsSync(file), `Missing frontend module: ${relative}`)
  const text = fs.readFileSync(file, 'utf8')
  const kind = relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return { relative, file, text, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind) }
}

function findFunction(source, name) {
  let found = null
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  check(found?.body && ts.isBlock(found.body), `Function ${name} not found`)
  return found
}

function declarationName(statement) {
  if (ts.isFunctionDeclaration(statement) && statement.name) return statement.name.text
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0]
    if (ts.isIdentifier(declaration.name)) return declaration.name.text
  }
  return ''
}

function statementMap(relative, functionName = null) {
  const parsed = parse(relative)
  const statements = functionName ? findFunction(parsed.source, functionName).body.statements : parsed.source.statements
  return new Map(statements.map((statement) => [declarationName(statement), normalize(statement.getText(parsed.source))]).filter(([name]) => name))
}

function hookTokens(relative, functionName) {
  const parsed = parse(relative)
  const fn = findFunction(parsed.source, functionName)
  const result = []
  function visit(node) {
    if (ts.isFunctionLike(node) && node !== fn) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use[A-Z]/.test(node.expression.text)) {
      result.push(node.expression.text)
      return
    }
    ts.forEachChild(node, visit)
  }
  for (const statement of fn.body.statements) visit(statement)
  return result
}

function bodyStatementHashes(relative, functionName) {
  const parsed = parse(relative)
  const fn = findFunction(parsed.source, functionName)
  return [...fn.body.statements]
    .filter((statement) => !ts.isReturnStatement(statement))
    .map((statement) => sha(normalize(statement.getText(parsed.source))))
}

function lineCount(relative) {
  return parse(relative).text.split(/\r?\n/).length
}

try {
  check(fs.existsSync(manifestPath), '1906B preservation manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const cleanup = fs.existsSync(cleanupPath) ? JSON.parse(fs.readFileSync(cleanupPath, 'utf8')) : null
  const warehouseAttention = fs.existsSync(warehouseAttentionPath) ? JSON.parse(fs.readFileSync(warehouseAttentionPath, 'utf8')) : null
  const dailyWarehouse = fs.existsSync(dailyWarehousePath) ? JSON.parse(fs.readFileSync(dailyWarehousePath, 'utf8')) : null
  const attentionVisibility = fs.existsSync(attentionVisibilityPath) ? JSON.parse(fs.readFileSync(attentionVisibilityPath, 'utf8')) : null
  const orderSaveIntegrity = fs.existsSync(orderSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderSaveIntegrityPath, 'utf8')) : null
  const stocktakeLostResponseFrontend = fs.existsSync(stocktakeLostResponseFrontendPath) ? JSON.parse(fs.readFileSync(stocktakeLostResponseFrontendPath, 'utf8')) : null
  const operationalAutonomyR2 = fs.existsSync(operationalAutonomyR2Path) ? JSON.parse(fs.readFileSync(operationalAutonomyR2Path, 'utf8')) : null
  const w1WarehouseReliability = fs.existsSync(w1WarehouseReliabilityPath) ? JSON.parse(fs.readFileSync(w1WarehouseReliabilityPath, 'utf8')) : null
  const w2HumanWarehouse = fs.existsSync(w2HumanWarehousePath) ? JSON.parse(fs.readFileSync(w2HumanWarehousePath, 'utf8')) : null
  const w3WarehouseReliability = fs.existsSync(w3WarehouseReliabilityPath) ? JSON.parse(fs.readFileSync(w3WarehouseReliabilityPath, 'utf8')) : null
  const w3StockMicroCheck = fs.existsSync(w3StockMicroCheckPath) ? JSON.parse(fs.readFileSync(w3StockMicroCheckPath, 'utf8')) : null
  const w3NaturalRecovery = fs.existsSync(w3NaturalRecoveryPath) ? JSON.parse(fs.readFileSync(w3NaturalRecoveryPath, 'utf8')) : null
  if (operationalAutonomyR2) check(operationalAutonomyR2.version === 1 && operationalAutonomyR2.revision === 'operational-autonomy-r2', 'Operational autonomy R2 frontend manifest invalid')
  if (w1WarehouseReliability) check(w1WarehouseReliability.version === 1 && w1WarehouseReliability.revision === 'w1-warehouse-reliability', 'W1 Warehouse reliability frontend manifest invalid')
  if (w2HumanWarehouse) check(w2HumanWarehouse.version === 1 && w2HumanWarehouse.revision === 'w2-human-warehouse', 'W2 human Warehouse frontend manifest invalid')
  if (w3WarehouseReliability) check(w3WarehouseReliability.version === 1 && w3WarehouseReliability.revision === 'w3-1a-warehouse-reliability', 'W3.1A Warehouse reliability frontend manifest invalid')
  if (w3StockMicroCheck) check(w3StockMicroCheck.version === 1 && w3StockMicroCheck.revision === 'w3-1b-stock-micro-check', 'W3.1B stock micro-check frontend manifest invalid')
  if (w3NaturalRecovery) check(w3NaturalRecovery.version === 1 && w3NaturalRecovery.revision === 'w3-2-natural-recovery', 'W3.2 natural recovery frontend manifest invalid')
  check(manifest?.version === 1, '1906B preservation manifest invalid')
  check(manifest.baseAppHooks?.length === 352, `Unexpected 1906A App hook baseline: ${manifest.baseAppHooks?.length}`)
  check(manifest.baseInvHooks?.length === 119, `Unexpected 1906A Inventory hook baseline: ${manifest.baseInvHooks?.length}`)

  const required = [
    'src/app/controllers/useApiClient.ts',
    'src/app/controllers/useOperationalViewModel.ts',
    'src/app/controllers/useWorkspaceViewModel.tsx',
    'src/features/export/documentExport.ts',
    'src/features/inventory/inventoryDraftFactories.ts',
    'src/features/inventory/useInventoryAttentionActions.ts',
    'src/features/inventory/views/types.ts',
    'src/features/inventory/views/renderInventoryAttentionPanel.tsx',
    ...manifest.panels.map((panel) => `src/features/inventory/views/${panel.func}.tsx`),
  ]
  for (const relative of required) parse(relative)

  // React hook order is part of behavior. Expand only the three hooks introduced by 1906B,
  // then require the exact 1906A direct-hook sequence.
  const expansion = new Map([
    ['useApiClient', hookTokens('src/app/controllers/useApiClient.ts', 'useApiClient')],
    ['useOperationalViewModel', hookTokens('src/app/controllers/useOperationalViewModel.ts', 'useOperationalViewModel')],
    ['useWorkspaceViewModel', hookTokens('src/app/controllers/useWorkspaceViewModel.tsx', 'useWorkspaceViewModel')],
  ])
  const currentAppHooks = hookTokens('src/App.tsx', 'App')
  const flattenedAppHooks = currentAppHooks.flatMap((name) => expansion.get(name) || [name])
  const removedHookIndices = new Set(cleanup?.removedAppHookIndices || [])
  let expectedAppHooks = cleanup ? manifest.baseAppHooks.filter((_name, index) => !removedHookIndices.has(index)) : manifest.baseAppHooks
  if (warehouseAttention) {
    check(warehouseAttention.version === 1 && warehouseAttention.step === '192b1', '192B1 frontend preservation manifest invalid')
    const insertions = Array.isArray(warehouseAttention.frontend?.appHookInsertions) ? warehouseAttention.frontend.appHookInsertions : []
    for (const insertion of insertions) {
      const index = Number(insertion?.index)
      const hook = String(insertion?.hook || '')
      check(Number.isInteger(index) && index >= 0 && index <= expectedAppHooks.length && /^use[A-Z]/.test(hook), '192B1 App hook insertion invalid')
      expectedAppHooks = [...expectedAppHooks.slice(0, index), hook, ...expectedAppHooks.slice(index)]
    }
  }
  check(JSON.stringify(flattenedAppHooks) === JSON.stringify(expectedAppHooks), warehouseAttention ? 'App hook order changed outside exact 1906C cleanup + 192B1 attention insertion' : (cleanup ? 'App hook order changed outside the exact 1906C dead-hook allow-list' : 'App hook order/call set changed during 1906B extraction'))
  const currentInventoryHooks = hookTokens('src/features/sections/InventorySection.tsx', 'InventorySection')
  let expectedInventoryHooks = [...manifest.baseInvHooks]
  if (dailyWarehouse?.frontend?.inventoryHookRewrite) {
    const rewrite = dailyWarehouse.frontend.inventoryHookRewrite
    const index = Number(rewrite.index)
    const before = Array.isArray(rewrite.before) ? rewrite.before : []
    const after = Array.isArray(rewrite.after) ? rewrite.after : []
    check(JSON.stringify(expectedInventoryHooks.slice(index, index + before.length)) === JSON.stringify(before), '192B2A Inventory hook rewrite baseline mismatch')
    expectedInventoryHooks = [...expectedInventoryHooks.slice(0, index), ...after, ...expectedInventoryHooks.slice(index + before.length)]
  }
  check(JSON.stringify(currentInventoryHooks) === JSON.stringify(expectedInventoryHooks), dailyWarehouse ? 'InventorySection hook order changed outside exact 192B2A daily-warehouse rewrite' : 'InventorySection hook order/call set changed during 1906B extraction')

  // The two extracted view-model blocks must remain statement-for-statement identical to 1906A.
  const operationalHashes = bodyStatementHashes('src/app/controllers/useOperationalViewModel.ts', 'useOperationalViewModel')
  const workspaceHashes = bodyStatementHashes('src/app/controllers/useWorkspaceViewModel.tsx', 'useWorkspaceViewModel')
  let expectedOperationalHashes = [...manifest.operational.hashes]
  if (attentionVisibility) {
    check(attentionVisibility.version === 1 && attentionVisibility.step === '192b2a1', '192B2A1 frontend visibility manifest invalid')
    const changes = Array.isArray(attentionVisibility.frontend?.operationalStatementChanges) ? attentionVisibility.frontend.operationalStatementChanges : []
    check(changes.length === 2, '192B2A1 must allow exactly two operational allow-list statement changes')
    for (const change of changes) {
      const index = Number(change?.index)
      check(Number.isInteger(index) && index >= 0 && index < expectedOperationalHashes.length, '192B2A1 operational statement index invalid')
      check(expectedOperationalHashes[index] === change.before, `192B2A1 operational statement baseline mismatch at ${index}`)
      expectedOperationalHashes[index] = change.after
    }
  }
  if (operationalAutonomyR2) {
    const changes = Array.isArray(operationalAutonomyR2.frontend?.operationalStatementChanges) ? operationalAutonomyR2.frontend.operationalStatementChanges : []
    check(changes.length === 1, 'Operational autonomy R2 must allow exactly one operational view-model statement change')
    for (const change of changes) {
      const index = Number(change?.index)
      check(Number.isInteger(index) && index >= 0 && index < expectedOperationalHashes.length, 'Operational autonomy R2 operational statement index invalid')
      check(expectedOperationalHashes[index] === change.before, `Operational autonomy R2 operational statement baseline mismatch at ${index}`)
      expectedOperationalHashes[index] = change.after
    }
  }
  check(JSON.stringify(operationalHashes) === JSON.stringify(expectedOperationalHashes), operationalAutonomyR2 ? 'Operational view-model changed outside exact operational-autonomy R2 allow-list' : (attentionVisibility ? 'Operational view-model changed outside exact 192B2A1 Attention visibility allow-list' : 'Operational view-model statements changed during extraction'))
  let expectedWorkspaceHashes = [...(cleanup?.postCleanupWorkspaceHashes || manifest.workspace.hashes)]
  if (dailyWarehouse?.frontend?.workspaceStatementChange) {
    const change = dailyWarehouse.frontend.workspaceStatementChange
    const index = Number(change.index)
    check(expectedWorkspaceHashes[index] === change.before, '192B2A Workspace statement baseline mismatch')
    expectedWorkspaceHashes[index] = change.after
  }
  if (orderSaveIntegrity) {
    check(orderSaveIntegrity.version === 1 && orderSaveIntegrity.step === '192b2a4', '192B2A4 frontend preservation manifest invalid')
    const changes = Array.isArray(orderSaveIntegrity.frontend?.workspaceStatementChanges) ? orderSaveIntegrity.frontend.workspaceStatementChanges : []
    check(changes.length === 1, '192B2A4 must allow exactly one workspace statement change')
    for (const change of changes) {
      const index = Number(change?.index)
      check(Number.isInteger(index) && index >= 0 && index < expectedWorkspaceHashes.length, '192B2A4 workspace statement index invalid')
      check(expectedWorkspaceHashes[index] === change.before, `192B2A4 workspace statement baseline mismatch at ${index}`)
      expectedWorkspaceHashes[index] = change.after
    }
  }
  check(JSON.stringify(workspaceHashes) === JSON.stringify(expectedWorkspaceHashes), orderSaveIntegrity ? 'Workspace view-model changed outside exact 192B2A4 order-save allow-list' : (dailyWarehouse ? 'Workspace view-model changed outside exact 192B2A shortage-decision statement' : (cleanup ? 'Workspace view-model changed outside the exact 1906C dead-sector cleanup' : 'Workspace view-model statements changed during extraction')))

  // Smaller moved helpers/controllers are likewise body-hash preserved.
  const preservationGroups = [
    ['api-top', 'src/app/controllers/useApiClient.ts', null],
    ['api-hook', 'src/app/controllers/useApiClient.ts', 'useApiClient'],
    ['inventory-factory', 'src/features/inventory/inventoryDraftFactories.ts', null],
    ['export', 'src/features/export/documentExport.ts', null],
  ]
  for (const [label, relative, functionName] of preservationGroups) {
    const map = statementMap(relative, functionName)
    for (const [key, expectedHash] of Object.entries(manifest.preserve)) {
      if (!key.startsWith(`${label}:`)) continue
      const name = key.slice(label.length + 1)
      check(map.has(name), `Preserved declaration missing: ${key}`)
      const allowedApiHookChange = label === 'api-hook' ? orderSaveIntegrity?.frontend?.apiHookChanges?.[name] : null
      let acceptedApiHookHash = expectedHash
      if (allowedApiHookChange) {
        check(allowedApiHookChange.before === expectedHash, `192B2A4 API hook baseline mismatch: ${name}`)
        acceptedApiHookHash = allowedApiHookChange.after
      }
      const stocktakeApiHookChange = label === 'api-hook' ? stocktakeLostResponseFrontend?.frontend?.apiHookChanges?.[name] : null
      if (stocktakeApiHookChange) {
        check(stocktakeApiHookChange.before === acceptedApiHookHash, `Stocktake lost-response API hook baseline mismatch: ${name}`)
        check(sha(map.get(name)) === stocktakeApiHookChange.after, `API hook changed beyond exact stocktake lost-response allow-list: ${name}`)
      } else {
        check(sha(map.get(name)) === acceptedApiHookHash, allowedApiHookChange ? `192B2A4 API hook changed outside exact allow-list: ${name}` : `Preserved declaration changed: ${key}`)
      }
    }
  }

  if (orderSaveIntegrity) {
    const apiTop = statementMap('src/app/controllers/useApiClient.ts')
    const added = orderSaveIntegrity.frontend?.apiTopAdded || {}
    check(Object.keys(added).length === 2, '192B2A4 must allow exactly two API top-level helper additions')
    for (const [name, expectedHash] of Object.entries(added)) {
      check(apiTop.has(name), `192B2A4 API helper missing: ${name}`)
      check(sha(apiTop.get(name)) === expectedHash, `192B2A4 API helper hash mismatch: ${name}`)
    }
  }


  if (stocktakeLostResponseFrontend) {
    check(stocktakeLostResponseFrontend.version === 1 && stocktakeLostResponseFrontend.revision === 'stocktake-lost-response-r1', 'Stocktake lost-response frontend preservation manifest invalid')
    const modulesAdded = stocktakeLostResponseFrontend.frontend?.modulesAdded || {}
    check(Object.keys(modulesAdded).length === 1 && Object.hasOwn(modulesAdded, 'src/app/controllers/inventoryWriteRetry.ts'), 'Stocktake lost-response must add exactly the inventoryWriteRetry module')
    for (const [relative, expectedHash] of Object.entries(modulesAdded)) {
      const parsed = parse(relative)
      check(sha(normalize(parsed.text)) === expectedHash, `Stocktake lost-response frontend module hash mismatch: ${relative}`)
    }
  }

  // Inventory panels are plain render functions, not React component boundaries: JSX stays token/text equivalent.
  const inventoryController = parse('src/features/sections/InventorySection.tsx').text
  for (const panel of manifest.panels) {
    const relative = `src/features/inventory/views/${panel.func}.tsx`
    const parsed = parse(relative)
    const fn = findFunction(parsed.source, panel.func)
    const returnStatement = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
    check(returnStatement?.expression, `${panel.func}: return expression missing`)
    let expression = returnStatement.expression
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression
    let text = expression.getText(parsed.source)
    if (panel.func === 'renderInventoryOverviewPanel') text = text.replace('{renderRoutineCycleCountCue(ctx)}', '')
    if (panel.allowedTransform === 'String(field)->field') text = text.replace(/String\(field\)/g, 'field')
    if (panel.allowedTransform === 'arrivalWorkspaceInjection') {
      const controllerText = parse('src/features/sections/InventorySection.tsx').text
      const arrivalStart = controllerText.indexOf('<div className=\"inventory-arrival-legacy-workspace\">')
      const arrivalButton = '<button className=\"inventory-arrival-add-position\" type=\"button\" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
      const arrivalButtonEnd = controllerText.indexOf(arrivalButton, arrivalStart) + arrivalButton.length
      const arrivalCloseEnd = controllerText.indexOf('</div>', arrivalButtonEnd) + '</div>'.length
      check(arrivalStart >= 0 && arrivalButtonEnd >= arrivalButton.length && arrivalCloseEnd >= '</div>'.length, 'Frozen Arrival block missing for movement reconstruction')
      text = text.replace('{arrivalWorkspace}', controllerText.slice(arrivalStart, arrivalCloseEnd))
    }
    const dailyPanelChange = dailyWarehouse?.frontend?.panelReturnChanges?.[panel.func]
    let expectedPanelHash = dailyPanelChange?.after || panel.hash
    if (dailyPanelChange) check(dailyPanelChange.before === panel.hash, `${panel.func}: 192B2A panel baseline hash mismatch`)
    const autonomyPanelChange = operationalAutonomyR2?.frontend?.panelReturnChanges?.[panel.func]
    if (autonomyPanelChange) {
      check(autonomyPanelChange.before === expectedPanelHash, `${panel.func}: operational-autonomy R2 panel baseline hash mismatch`)
      expectedPanelHash = autonomyPanelChange.after
    }
    const w1PanelChange = w1WarehouseReliability?.frontend?.panelReturnChanges?.[panel.func]
    if (w1PanelChange) {
      check(w1PanelChange.before === expectedPanelHash, `${panel.func}: W1 Warehouse reliability panel baseline hash mismatch`)
      expectedPanelHash = w1PanelChange.after
    }
    const w2PanelChange = w2HumanWarehouse?.frontend?.panelReturnChanges?.[panel.func]
    if (w2PanelChange) {
      check(w2PanelChange.before === expectedPanelHash, `${panel.func}: W2 human Warehouse panel baseline hash mismatch`)
      expectedPanelHash = w2PanelChange.after
    }
    const w3PanelChange = w3WarehouseReliability?.frontend?.panelReturnChanges?.[panel.func]
    if (w3PanelChange) {
      check(w3PanelChange.before === expectedPanelHash, `${panel.func}: W3.1A Warehouse reliability panel baseline hash mismatch`)
      expectedPanelHash = w3PanelChange.after
    }
    const w3MicroPanelChange = w3StockMicroCheck?.frontend?.panelReturnChanges?.[panel.func]
    if (w3MicroPanelChange) {
      check(w3MicroPanelChange.before === expectedPanelHash, `${panel.func}: W3.1B stock micro-check panel baseline hash mismatch`)
      expectedPanelHash = w3MicroPanelChange.after
    }
    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B delta`)
    check(hookTokens(relative, panel.func).length === 0, `${panel.func}: renderer unexpectedly owns React hooks/lifecycle`)
    check(inventoryController.includes(`{${panel.func}({`), `${panel.func}: InventorySection no longer calls renderer directly`)
  }

  if (w2HumanWarehouse?.frontend?.attentionReturnChange) {
    const change = w2HumanWarehouse.frontend.attentionReturnChange
    const autonomyAttention = operationalAutonomyR2?.frontend?.panelReturnChanges?.renderInventoryAttentionPanel
    check(autonomyAttention?.after === change.before, 'W2 Attention baseline must match the accepted operational-autonomy renderer')
    const parsed = parse('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
    const fn = findFunction(parsed.source, 'renderInventoryAttentionPanel')
    const returnStatement = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
    check(returnStatement?.expression, 'renderInventoryAttentionPanel: return expression missing')
    let expression = returnStatement.expression
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression
    let expectedAttentionHash = change.after
    const naturalRecoveryAttention = w3NaturalRecovery?.frontend?.attentionReturnChange
    if (naturalRecoveryAttention) {
      check(naturalRecoveryAttention.before === expectedAttentionHash, 'W3.2 Attention baseline must match accepted W2 Attention delta')
      expectedAttentionHash = naturalRecoveryAttention.after
    }
    check(sha(normalize(expression.getText(parsed.source))) === expectedAttentionHash, w3NaturalRecovery ? 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2/W3.2 deltas' : 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2 delta')
  }

  // Keep the controller split meaningful and prevent a silent return to the old monoliths.
  check(lineCount('src/App.tsx') <= 7000, `App.tsx regrew beyond 1906B controller budget (${lineCount('src/App.tsx')} lines)`)
  check(lineCount('src/features/sections/InventorySection.tsx') <= 2580, `InventorySection.tsx regrew beyond 1906B controller budget (${lineCount('src/features/sections/InventorySection.tsx')} lines)`)
  check(lineCount('src/app/controllers/useOperationalViewModel.ts') <= 1350, 'useOperationalViewModel.ts unexpectedly oversized')
  check(lineCount('src/app/controllers/useWorkspaceViewModel.tsx') <= 950, 'useWorkspaceViewModel.tsx unexpectedly oversized')
  check(lineCount('src/app/controllers/useApiClient.ts') <= 220, 'useApiClient.ts unexpectedly oversized')
  for (const panel of manifest.panels) {
    const relative = `src/features/inventory/views/${panel.func}.tsx`
    check(lineCount(relative) <= 650, `${panel.func}: view renderer regrew beyond 650 lines`)
  }

  for (const relative of ['src/App.tsx', 'src/app/controllers/useApiClient.ts', 'src/app/controllers/useOperationalViewModel.ts', 'src/app/controllers/useWorkspaceViewModel.tsx', ...manifest.panels.map((panel) => `src/features/inventory/views/${panel.func}.tsx`)]) {
    check(!parse(relative).text.includes('@ts-nocheck'), `${relative}: 1906B module disables type checking`)
  }
  const inventoryText = parse('src/features/sections/InventorySection.tsx').text
  const boundaryCleanupActive = fs.existsSync(path.join(root, 'shared/api-contracts.ts'))
  if (boundaryCleanupActive) {
    check(!inventoryText.includes('@ts-nocheck'), 'Inventory controller returned to @ts-nocheck after 1906E boundary cleanup')
  } else {
    check(inventoryText.startsWith('// @ts-nocheck -- controller still carries the legacy wide view-model; panel renderers are type-checked in Step 190.6B.'), 'Inventory legacy controller ts-nocheck boundary changed unexpectedly')
  }

  const worker = parse('worker/index.ts').text
  check(worker.includes("frontendControllerModularization: '1906b'"), '1906B live health marker missing')

  console.log(`STEP 190.6B FRONTEND MODULARIZATION TESTS PASSED — App ${lineCount('src/App.tsx')} lines, Inventory ${lineCount('src/features/sections/InventorySection.tsx')} lines, ${manifest.panels.length} preserved panels, hook order preserved${dailyWarehouse ? ', exact 192B2A daily-warehouse frontend deltas accepted' : ''}${attentionVisibility ? ', exact 192B2A1 Attention visibility delta accepted' : ''}${orderSaveIntegrity ? ', exact 192B2A4 order-save frontend deltas accepted' : ''}${operationalAutonomyR2 ? ', exact operational-autonomy R2 frontend deltas accepted' : ''}${w1WarehouseReliability ? ', exact W1 Warehouse reliability frontend delta accepted' : ''}${w2HumanWarehouse ? ', exact W2 human Warehouse frontend deltas accepted' : ''}${w3WarehouseReliability ? ', exact W3.1A Warehouse reliability frontend delta accepted' : ''}${w3StockMicroCheck ? ', exact W3.1B stock micro-check frontend delta accepted' : ''}${w3NaturalRecovery ? ', exact W3.2 natural-recovery Attention delta accepted' : ''}`)
} catch (error) {
  console.error(`STEP 190.6B FRONTEND MODULARIZATION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

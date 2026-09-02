from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Frontend preservation chain.
path = ROOT / 'scripts/test-step1906b-frontend-modularization.mjs'
text = path.read_text(encoding='utf-8')

def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return value.replace(old, new, 1)

text = replace_once(text,
"const stocktakeLostResponseFrontendPath = path.join(root, 'scripts/stocktake-lost-response-frontend-manifest.json')",
"const stocktakeLostResponseFrontendPath = path.join(root, 'scripts/stocktake-lost-response-frontend-manifest.json')\nconst operationalAutonomyR2Path = path.join(root, 'scripts/operational-autonomy-r2-frontend-manifest.json')",
'frontend path declaration')

text = replace_once(text,
"  const stocktakeLostResponseFrontend = fs.existsSync(stocktakeLostResponseFrontendPath) ? JSON.parse(fs.readFileSync(stocktakeLostResponseFrontendPath, 'utf8')) : null",
"  const stocktakeLostResponseFrontend = fs.existsSync(stocktakeLostResponseFrontendPath) ? JSON.parse(fs.readFileSync(stocktakeLostResponseFrontendPath, 'utf8')) : null\n  const operationalAutonomyR2 = fs.existsSync(operationalAutonomyR2Path) ? JSON.parse(fs.readFileSync(operationalAutonomyR2Path, 'utf8')) : null\n  if (operationalAutonomyR2) check(operationalAutonomyR2.version === 1 && operationalAutonomyR2.revision === 'operational-autonomy-r2', 'Operational autonomy R2 frontend manifest invalid')",
'frontend manifest load')

old_operational = """  check(JSON.stringify(operationalHashes) === JSON.stringify(expectedOperationalHashes), attentionVisibility ? 'Operational view-model changed outside exact 192B2A1 Attention visibility allow-list' : 'Operational view-model statements changed during extraction')"""
new_operational = """  if (operationalAutonomyR2) {\n    const changes = Array.isArray(operationalAutonomyR2.frontend?.operationalStatementChanges) ? operationalAutonomyR2.frontend.operationalStatementChanges : []\n    check(changes.length === 1, 'Operational autonomy R2 must allow exactly one operational view-model statement change')\n    for (const change of changes) {\n      const index = Number(change?.index)\n      check(Number.isInteger(index) && index >= 0 && index < expectedOperationalHashes.length, 'Operational autonomy R2 operational statement index invalid')\n      check(expectedOperationalHashes[index] === change.before, `Operational autonomy R2 operational statement baseline mismatch at ${index}`)\n      expectedOperationalHashes[index] = change.after\n    }\n  }\n  check(JSON.stringify(operationalHashes) === JSON.stringify(expectedOperationalHashes), operationalAutonomyR2 ? 'Operational view-model changed outside exact operational-autonomy R2 allow-list' : (attentionVisibility ? 'Operational view-model changed outside exact 192B2A1 Attention visibility allow-list' : 'Operational view-model statements changed during extraction'))"""
text = replace_once(text, old_operational, new_operational, 'frontend operational statement chain')

old_panel = """    const dailyPanelChange = dailyWarehouse?.frontend?.panelReturnChanges?.[panel.func]\n    const expectedPanelHash = dailyPanelChange?.after || panel.hash\n    if (dailyPanelChange) check(dailyPanelChange.before === panel.hash, `${panel.func}: 192B2A panel baseline hash mismatch`)\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A delta`)"""
new_panel = """    const dailyPanelChange = dailyWarehouse?.frontend?.panelReturnChanges?.[panel.func]\n    let expectedPanelHash = dailyPanelChange?.after || panel.hash\n    if (dailyPanelChange) check(dailyPanelChange.before === panel.hash, `${panel.func}: 192B2A panel baseline hash mismatch`)\n    const autonomyPanelChange = operationalAutonomyR2?.frontend?.panelReturnChanges?.[panel.func]\n    if (autonomyPanelChange) {\n      check(autonomyPanelChange.before === expectedPanelHash, `${panel.func}: operational-autonomy R2 panel baseline hash mismatch`)\n      expectedPanelHash = autonomyPanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy delta`)"""
text = replace_once(text, old_panel, new_panel, 'frontend panel chain')

text = replace_once(text,
"${orderSaveIntegrity ? ', exact 192B2A4 order-save frontend deltas accepted' : ''}`)",
"${orderSaveIntegrity ? ', exact 192B2A4 order-save frontend deltas accepted' : ''}${operationalAutonomyR2 ? ', exact operational-autonomy R2 frontend deltas accepted' : ''}`)",
'frontend console suffix')
path.write_text(text, encoding='utf-8')

# Worker router preservation chain.
worker_test_path = ROOT / 'scripts/test-step1906a-worker-modularization.mjs'
worker_test = worker_test_path.read_text(encoding='utf-8')
worker_test = replace_once(worker_test,
"const d1ReadBudgetR2Path = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')",
"const d1ReadBudgetR2Path = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')\nconst operationalAutonomyR2WorkerPath = path.join(root, 'scripts/operational-autonomy-r2-worker-manifest.json')",
'worker path declaration')
worker_test = replace_once(worker_test,
"  const d1ReadBudgetR2Changes = d1ReadBudgetR2.changes || {}",
"  const d1ReadBudgetR2Changes = d1ReadBudgetR2.changes || {}\n  check(fs.existsSync(operationalAutonomyR2WorkerPath), 'Operational autonomy R2 Worker manifest missing')\n  const operationalAutonomyR2Worker = JSON.parse(fs.readFileSync(operationalAutonomyR2WorkerPath, 'utf8'))\n  check(operationalAutonomyR2Worker?.version === 1 && operationalAutonomyR2Worker?.revision === 'operational-autonomy-r2', 'Operational autonomy R2 Worker manifest invalid')",
'worker manifest load')
worker_test = replace_once(worker_test,
"""  check(orderEditAutonomy.router?.before === acceptedPostCancellationAutonomyRouterHash, 'Order edit autonomy router baseline hash mismatch')\n  check(sha(normalizedRouter) === orderEditAutonomy.router.after, 'Worker router changed beyond exact order edit autonomy delta')""",
"""  check(orderEditAutonomy.router?.before === acceptedPostCancellationAutonomyRouterHash, 'Order edit autonomy router baseline hash mismatch')\n  const acceptedPostOrderEditAutonomyRouterHash = orderEditAutonomy.router.after\n  check(operationalAutonomyR2Worker.router?.before === acceptedPostOrderEditAutonomyRouterHash, 'Operational autonomy R2 router baseline hash mismatch')\n  check(sha(normalizedRouter) === operationalAutonomyR2Worker.router.after, 'Worker router changed beyond exact operational autonomy R2 delta')""",
'worker router chain')
worker_test_path.write_text(worker_test, encoding='utf-8')

print('Operational autonomy R2 frontend + Worker preservation gates patched')

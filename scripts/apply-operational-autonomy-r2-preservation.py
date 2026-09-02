from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'scripts/test-step1906b-frontend-modularization.mjs'
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    text = text.replace(old, new, 1)

replace_once(
"const stocktakeLostResponseFrontendPath = path.join(root, 'scripts/stocktake-lost-response-frontend-manifest.json')",
"const stocktakeLostResponseFrontendPath = path.join(root, 'scripts/stocktake-lost-response-frontend-manifest.json')\nconst operationalAutonomyR2Path = path.join(root, 'scripts/operational-autonomy-r2-frontend-manifest.json')",
'path declaration')

replace_once(
"  const stocktakeLostResponseFrontend = fs.existsSync(stocktakeLostResponseFrontendPath) ? JSON.parse(fs.readFileSync(stocktakeLostResponseFrontendPath, 'utf8')) : null",
"  const stocktakeLostResponseFrontend = fs.existsSync(stocktakeLostResponseFrontendPath) ? JSON.parse(fs.readFileSync(stocktakeLostResponseFrontendPath, 'utf8')) : null\n  const operationalAutonomyR2 = fs.existsSync(operationalAutonomyR2Path) ? JSON.parse(fs.readFileSync(operationalAutonomyR2Path, 'utf8')) : null\n  if (operationalAutonomyR2) check(operationalAutonomyR2.version === 1 && operationalAutonomyR2.revision === 'operational-autonomy-r2', 'Operational autonomy R2 frontend manifest invalid')",
'manifest load')

old_panel = """    const dailyPanelChange = dailyWarehouse?.frontend?.panelReturnChanges?.[panel.func]\n    const expectedPanelHash = dailyPanelChange?.after || panel.hash\n    if (dailyPanelChange) check(dailyPanelChange.before === panel.hash, `${panel.func}: 192B2A panel baseline hash mismatch`)\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A delta`)"""
new_panel = """    const dailyPanelChange = dailyWarehouse?.frontend?.panelReturnChanges?.[panel.func]\n    let expectedPanelHash = dailyPanelChange?.after || panel.hash\n    if (dailyPanelChange) check(dailyPanelChange.before === panel.hash, `${panel.func}: 192B2A panel baseline hash mismatch`)\n    const autonomyPanelChange = operationalAutonomyR2?.frontend?.panelReturnChanges?.[panel.func]\n    if (autonomyPanelChange) {\n      check(autonomyPanelChange.before === expectedPanelHash, `${panel.func}: operational-autonomy R2 panel baseline hash mismatch`)\n      expectedPanelHash = autonomyPanelChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy delta`)"""
replace_once(old_panel, new_panel, 'panel chain')

replace_once(
"${orderSaveIntegrity ? ', exact 192B2A4 order-save frontend deltas accepted' : ''}`)",
"${orderSaveIntegrity ? ', exact 192B2A4 order-save frontend deltas accepted' : ''}${operationalAutonomyR2 ? ', exact operational-autonomy R2 panel delta accepted' : ''}`)",
'console suffix')

path.write_text(text, encoding='utf-8')
print('Operational autonomy R2 preservation gate patched')

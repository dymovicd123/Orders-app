from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)


path = Path('scripts/test-step1906b-frontend-modularization.mjs')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "const operationalAutonomyR2Path = path.join(root, 'scripts/operational-autonomy-r2-frontend-manifest.json')\n",
    "const operationalAutonomyR2Path = path.join(root, 'scripts/operational-autonomy-r2-frontend-manifest.json')\nconst w1WarehouseReliabilityPath = path.join(root, 'scripts/w1-warehouse-reliability-frontend-manifest.json')\n",
    'W1 manifest path',
)
text = replace_once(
    text,
    "  const operationalAutonomyR2 = fs.existsSync(operationalAutonomyR2Path) ? JSON.parse(fs.readFileSync(operationalAutonomyR2Path, 'utf8')) : null\n  if (operationalAutonomyR2) check(operationalAutonomyR2.version === 1 && operationalAutonomyR2.revision === 'operational-autonomy-r2', 'Operational autonomy R2 frontend manifest invalid')\n",
    "  const operationalAutonomyR2 = fs.existsSync(operationalAutonomyR2Path) ? JSON.parse(fs.readFileSync(operationalAutonomyR2Path, 'utf8')) : null\n  const w1WarehouseReliability = fs.existsSync(w1WarehouseReliabilityPath) ? JSON.parse(fs.readFileSync(w1WarehouseReliabilityPath, 'utf8')) : null\n  if (operationalAutonomyR2) check(operationalAutonomyR2.version === 1 && operationalAutonomyR2.revision === 'operational-autonomy-r2', 'Operational autonomy R2 frontend manifest invalid')\n  if (w1WarehouseReliability) check(w1WarehouseReliability.version === 1 && w1WarehouseReliability.revision === 'w1-warehouse-reliability', 'W1 Warehouse reliability frontend manifest invalid')\n",
    'W1 manifest load',
)
text = replace_once(
    text,
    """    const autonomyPanelChange = operationalAutonomyR2?.frontend?.panelReturnChanges?.[panel.func]
    if (autonomyPanelChange) {
      check(autonomyPanelChange.before === expectedPanelHash, `${panel.func}: operational-autonomy R2 panel baseline hash mismatch`)
      expectedPanelHash = autonomyPanelChange.after
    }
    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy delta`)
""",
    """    const autonomyPanelChange = operationalAutonomyR2?.frontend?.panelReturnChanges?.[panel.func]
    if (autonomyPanelChange) {
      check(autonomyPanelChange.before === expectedPanelHash, `${panel.func}: operational-autonomy R2 panel baseline hash mismatch`)
      expectedPanelHash = autonomyPanelChange.after
    }
    const w1PanelChange = w1WarehouseReliability?.frontend?.panelReturnChanges?.[panel.func]
    if (w1PanelChange) {
      check(w1PanelChange.before === expectedPanelHash, `${panel.func}: W1 Warehouse reliability panel baseline hash mismatch`)
      expectedPanelHash = w1PanelChange.after
    }
    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1 delta`)
""",
    'W1 panel exact delta',
)
text = replace_once(
    text,
    "${operationalAutonomyR2 ? ', exact operational-autonomy R2 frontend deltas accepted' : ''}`)",
    "${operationalAutonomyR2 ? ', exact operational-autonomy R2 frontend deltas accepted' : ''}${w1WarehouseReliability ? ', exact W1 Warehouse reliability frontend delta accepted' : ''}`)",
    'W1 success output',
)
path.write_text(text, encoding='utf-8')

manifest = {
    'version': 1,
    'revision': 'w1-warehouse-reliability',
    'frontend': {
        'panelReturnChanges': {
            'renderInventoryCatalogPanel': {
                'before': '689351c54440bdd88a1f192c2de2780295f68686226e2f39c6999ba93ba29a51',
                'after': '6b887683978eb585b97dfecafa242b9da6be76f65582703ff4386915540e2afb',
            }
        }
    },
}
Path('scripts/w1-warehouse-reliability-frontend-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

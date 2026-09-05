from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)

p = Path('scripts/test-step1906b-frontend-modularization.mjs')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    "const w5ManagerWarehouseAccessPath = path.join(root, 'scripts/w5-manager-warehouse-access-frontend-manifest.json')\n",
    "const w5ManagerWarehouseAccessPath = path.join(root, 'scripts/w5-manager-warehouse-access-frontend-manifest.json')\nconst w5FullStocktakePath = path.join(root, 'scripts/w5-4-full-stocktake-frontend-manifest.json')\n",
    '1906b W5.4 path')
s = replace_once(s,
    "  const w5ManagerWarehouseAccess = fs.existsSync(w5ManagerWarehouseAccessPath) ? JSON.parse(fs.readFileSync(w5ManagerWarehouseAccessPath, 'utf8')) : null\n",
    "  const w5ManagerWarehouseAccess = fs.existsSync(w5ManagerWarehouseAccessPath) ? JSON.parse(fs.readFileSync(w5ManagerWarehouseAccessPath, 'utf8')) : null\n  const w5FullStocktake = fs.existsSync(w5FullStocktakePath) ? JSON.parse(fs.readFileSync(w5FullStocktakePath, 'utf8')) : null\n",
    '1906b W5.4 load')
s = replace_once(s,
    "  if (w5ManagerWarehouseAccess) check(w5ManagerWarehouseAccess.version === 1 && w5ManagerWarehouseAccess.revision === 'w5-manager-warehouse-access', 'W5 manager Warehouse access frontend manifest invalid')\n",
    "  if (w5ManagerWarehouseAccess) check(w5ManagerWarehouseAccess.version === 1 && w5ManagerWarehouseAccess.revision === 'w5-manager-warehouse-access', 'W5 manager Warehouse access frontend manifest invalid')\n  if (w5FullStocktake) check(w5FullStocktake.version === 1 && w5FullStocktake.revision === 'w5-4-full-stocktake', 'W5.4 full stocktake frontend manifest invalid')\n",
    '1906b W5.4 validate')
old = "    const w5ManagerAccessChange = w5ManagerWarehouseAccess?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5ManagerAccessChange) {\n      check(w5ManagerAccessChange.before === expectedPanelHash, `${panel.func}: W5 manager Warehouse access panel baseline hash mismatch`)\n      expectedPanelHash = w5ManagerAccessChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access delta`)"
new = "    const w5ManagerAccessChange = w5ManagerWarehouseAccess?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5ManagerAccessChange) {\n      check(w5ManagerAccessChange.before === expectedPanelHash, `${panel.func}: W5 manager Warehouse access panel baseline hash mismatch`)\n      expectedPanelHash = w5ManagerAccessChange.after\n    }\n    const w5FullStocktakeChange = w5FullStocktake?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5FullStocktakeChange) {\n      check(w5FullStocktakeChange.before === expectedPanelHash, `${panel.func}: W5.4 full stocktake panel baseline hash mismatch`)\n      expectedPanelHash = w5FullStocktakeChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access/W5.4 delta`)"
s = replace_once(s, old, new, '1906b W5.4 panel chain')
p.write_text(s, encoding='utf-8')
print('W5.4 preservation gate updated')

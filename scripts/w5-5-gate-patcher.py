from pathlib import Path
import json


def one(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

# Worker preservation gate
p = Path('scripts/test-step1906a-worker-modularization.mjs')
s = p.read_text(encoding='utf-8')
s = one(s,
"const w3NaturalRecoveryWorkerPath = path.join(root, 'scripts/w3-2-natural-recovery-worker-manifest.json')\n",
"const w3NaturalRecoveryWorkerPath = path.join(root, 'scripts/w3-2-natural-recovery-worker-manifest.json')\nconst w5FoundItemsWorkerPath = path.join(root, 'scripts/w5-5-found-items-worker-manifest.json')\n",
'1906a W5.5 path')
s = one(s,
"  const w3NaturalRecoveryWorkerChanges = w3NaturalRecoveryWorker?.changes || {}\n\n  const files = walk(workerRoot)\n",
"  const w3NaturalRecoveryWorkerChanges = w3NaturalRecoveryWorker?.changes || {}\n  const w5FoundItemsWorker = fs.existsSync(w5FoundItemsWorkerPath) ? JSON.parse(fs.readFileSync(w5FoundItemsWorkerPath, 'utf8')) : null\n  if (w5FoundItemsWorker) check(w5FoundItemsWorker.version === 1 && w5FoundItemsWorker.revision === 'w5-5-found-items', 'W5.5 found-items Worker manifest invalid')\n  const w5FoundItemsChanges = w5FoundItemsWorker?.changes || {}\n  const w5FoundItemsAdded = w5FoundItemsWorker?.added || {}\n\n  const files = walk(workerRoot)\n",
'1906a W5.5 load')
s = one(s,
" + Object.keys(orderDeleteMobilityAdded).length + Object.keys(returnExchangeCancelAutonomyAdded).length\n",
" + Object.keys(orderDeleteMobilityAdded).length + Object.keys(returnExchangeCancelAutonomyAdded).length + Object.keys(w5FoundItemsAdded).length\n",
'1906a declaration count')
s = one(s,
"    check(\n      sha(declarations.get(name)) === acceptedPostW3NaturalRecoveryHash,\n      w3NaturalRecoveryWorkerChanged\n        ? `Worker declaration changed beyond exact W3.2 natural recovery allow-list: ${name}`\n        : `Worker declaration body changed beyond accepted cumulative deltas: ${name}`,\n    )\n",
"    const w5FoundItemsChanged = w5FoundItemsChanges[name]\n    let acceptedPostW5FoundItemsHash = acceptedPostW3NaturalRecoveryHash\n    if (w5FoundItemsChanged) {\n      check(w5FoundItemsChanged.before === acceptedPostW3NaturalRecoveryHash, `W5.5 found-items declaration baseline hash mismatch: ${name}`)\n      acceptedPostW5FoundItemsHash = w5FoundItemsChanged.after\n    }\n    check(\n      sha(declarations.get(name)) === acceptedPostW5FoundItemsHash,\n      w5FoundItemsChanged\n        ? `Worker declaration changed beyond exact W5.5 found-items allow-list: ${name}`\n        : `Worker declaration body changed beyond accepted cumulative deltas: ${name}`,\n    )\n",
'1906a W5.5 declaration chain')
s = one(s,
"  // Shipping hotfix 2026-09-01: normalize only this retired final-shipping blocker\n",
"  for (const [name, expectedHash] of Object.entries(w5FoundItemsAdded)) {\n    check(declarations.has(name), `W5.5 added Worker declaration missing: ${name}`)\n    check(sha(declarations.get(name)) === expectedHash, `W5.5 added Worker declaration changed: ${name}`)\n  }\n\n  // Shipping hotfix 2026-09-01: normalize only this retired final-shipping blocker\n",
'1906a W5.5 added validation')
old_router = """  const normalizedRouter = currentRouter
"""
new_router = r'''  const w5RevertedRouter = w5FoundItemsWorker ? currentRouter
    .replace(
      "const input = await readJson<{ productId?: unknown; material?: unknown; length?: unknown; category?: unknown; gender?: unknown; color?: unknown; size?: unknown; sizes?: unknown; createReferenceFields?: unknown; deferUnknown?: unknown }>(request);",
      "const input = await readJson<{ productId?: unknown; material?: unknown; length?: unknown; category?: unknown; gender?: unknown; color?: unknown; size?: unknown; createReferenceFields?: unknown }>(request);",
    )
    .replace(
      `        const createReferenceFields = input.createReferenceFields;
        const wantsNewReferenceValue = Array.isArray(createReferenceFields)
          ? createReferenceFields.length > 0
          : Boolean(createReferenceFields && typeof createReferenceFields === 'object' && Object.values(createReferenceFields as Record<string, unknown>).some((value) => value === true));`,
      `        const createReferenceFields = input.createReferenceFields && typeof input.createReferenceFields === 'object'
          ? input.createReferenceFields as Record<string, unknown>
          : {};
        const wantsNewReferenceValue = Object.values(createReferenceFields).some((value) => value === true);`,
    )
    .replace(/\n\s*const inventoryFoundStockReconcileMatch = url\.pathname\.match\(\/\^\\\/api\\\/inventory\\\/found-stock\\\/\(\\d\+\)\\\/reconcile\$\/\);[\s\S]*?(?=\n\s*const |\n\s*if \(url\.pathname|\n\s*return json|\n\s*}\n)/, '')
    : currentRouter
  if (w5FoundItemsWorker) {
    check(sha(currentRouter) === w5FoundItemsWorker.router.after, 'W5.5 Worker router changed beyond exact found-items delta')
    check(sha(w5RevertedRouter) === w5FoundItemsWorker.router.before, 'W5.5 Worker router reverse baseline mismatch')
  }
  const normalizedRouter = w5RevertedRouter
'''
s = one(s, old_router, new_router, '1906a W5.5 router normalization')
p.write_text(s, encoding='utf-8')

# Frontend preservation gate
p = Path('scripts/test-step1906b-frontend-modularization.mjs')
s = p.read_text(encoding='utf-8')
s = one(s,
"const w5FullStocktakePath = path.join(root, 'scripts/w5-4-full-stocktake-frontend-manifest.json')\n",
"const w5FullStocktakePath = path.join(root, 'scripts/w5-4-full-stocktake-frontend-manifest.json')\nconst w5FoundItemsPath = path.join(root, 'scripts/w5-5-found-items-frontend-manifest.json')\n",
'1906b W5.5 path')
s = one(s,
"  const w5FullStocktake = fs.existsSync(w5FullStocktakePath) ? JSON.parse(fs.readFileSync(w5FullStocktakePath, 'utf8')) : null\n",
"  const w5FullStocktake = fs.existsSync(w5FullStocktakePath) ? JSON.parse(fs.readFileSync(w5FullStocktakePath, 'utf8')) : null\n  const w5FoundItems = fs.existsSync(w5FoundItemsPath) ? JSON.parse(fs.readFileSync(w5FoundItemsPath, 'utf8')) : null\n",
'1906b W5.5 load')
s = one(s,
"  if (w5FullStocktake) check(w5FullStocktake.version === 1 && w5FullStocktake.revision === 'w5-4-full-stocktake', 'W5.4 full stocktake frontend manifest invalid')\n",
"  if (w5FullStocktake) check(w5FullStocktake.version === 1 && w5FullStocktake.revision === 'w5-4-full-stocktake', 'W5.4 full stocktake frontend manifest invalid')\n  if (w5FoundItems) check(w5FoundItems.version === 1 && w5FoundItems.revision === 'w5-5-found-items', 'W5.5 found-items frontend manifest invalid')\n",
'1906b W5.5 validate')
s = one(s,
"    const w5FullStocktakeChange = w5FullStocktake?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5FullStocktakeChange) {\n      check(w5FullStocktakeChange.before === expectedPanelHash, `${panel.func}: W5.4 full stocktake panel baseline hash mismatch`)\n      expectedPanelHash = w5FullStocktakeChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access/W5.4 delta`)\n",
"    const w5FullStocktakeChange = w5FullStocktake?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5FullStocktakeChange) {\n      check(w5FullStocktakeChange.before === expectedPanelHash, `${panel.func}: W5.4 full stocktake panel baseline hash mismatch`)\n      expectedPanelHash = w5FullStocktakeChange.after\n    }\n    const w5FoundItemsChange = w5FoundItems?.frontend?.panelReturnChanges?.[panel.func]\n    if (w5FoundItemsChange) {\n      check(w5FoundItemsChange.before === expectedPanelHash, `${panel.func}: W5.5 found-items panel baseline hash mismatch`)\n      expectedPanelHash = w5FoundItemsChange.after\n    }\n    check(sha(normalize(text)) === expectedPanelHash, `${panel.func}: rendered JSX changed outside accepted baseline/B2A/autonomy/W1/W2/W3.1A/W3.1B/W4/W5/W5.2/W5.3/W5.3R/manager-access/W5.4/W5.5 delta`)\n",
'1906b W5.5 panel chain')
p.write_text(s, encoding='utf-8')

# Release gate
p = Path('package.json')
pkg = json.loads(p.read_text(encoding='utf-8'))
marker = ' && node scripts/test-w5-5-found-items.mjs'
if marker not in pkg['scripts']['release:check']:
    pkg['scripts']['release:check'] += marker
p.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('W5.5 preservation gates patched')

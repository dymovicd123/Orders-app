from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one source match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    """const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')
const stocktakeLostResponsePath = path.join(root, 'scripts/stocktake-lost-response-worker-manifest.json')
""",
    """const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')
const phase1bWorkshopReturnDispositionPath = path.join(root, 'scripts/phase1b-workshop-return-disposition-worker-manifest.json')
const stocktakeLostResponsePath = path.join(root, 'scripts/stocktake-lost-response-worker-manifest.json')
""",
    '1906A Phase 1B manifest path',
)

replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    """  const orderCreateSaveIntegrity = fs.existsSync(orderCreateSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderCreateSaveIntegrityPath, 'utf8')) : null
  const orderCreateSaveIntegrityChanges = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.changes || {}) : {}
  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}
  const stocktakeLostResponse = fs.existsSync(stocktakeLostResponsePath) ? JSON.parse(fs.readFileSync(stocktakeLostResponsePath, 'utf8')) : null
""",
    """  const orderCreateSaveIntegrity = fs.existsSync(orderCreateSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderCreateSaveIntegrityPath, 'utf8')) : null
  const orderCreateSaveIntegrityChanges = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.changes || {}) : {}
  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}
  check(fs.existsSync(phase1bWorkshopReturnDispositionPath), 'Phase 1B Workshop return disposition Worker manifest missing')
  const phase1bWorkshopReturnDisposition = JSON.parse(fs.readFileSync(phase1bWorkshopReturnDispositionPath, 'utf8'))
  check(phase1bWorkshopReturnDisposition?.version === 1 && phase1bWorkshopReturnDisposition?.revision === 'phase1b-workshop-return-disposition-r1', 'Phase 1B Workshop return disposition Worker manifest invalid')
  const phase1bWorkshopReturnDispositionChanges = phase1bWorkshopReturnDisposition.changes || {}
  const stocktakeLostResponse = fs.existsSync(stocktakeLostResponsePath) ? JSON.parse(fs.readFileSync(stocktakeLostResponsePath, 'utf8')) : null
""",
    '1906A Phase 1B manifest load',
)

replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    """    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
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
""",
    """    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    let acceptedPostOrderCreateSaveHash = acceptedPostHandoverSqlAliasHash
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 declaration baseline hash mismatch: ${name}`)
      acceptedPostOrderCreateSaveHash = orderCreateSaveIntegrityChanged.after
    }
    const phase1bWorkshopReturnDispositionChanged = phase1bWorkshopReturnDispositionChanges[name]
    let acceptedPostPhase1BWorkshopReturnDispositionHash = acceptedPostOrderCreateSaveHash
    if (phase1bWorkshopReturnDispositionChanged) {
      check(phase1bWorkshopReturnDispositionChanged.before === acceptedPostOrderCreateSaveHash, `Phase 1B Workshop return disposition baseline hash mismatch: ${name}`)
      acceptedPostPhase1BWorkshopReturnDispositionHash = phase1bWorkshopReturnDispositionChanged.after
    }
    const stocktakeLostResponseChanged = stocktakeLostResponseChanges[name]
    let acceptedPostStocktakeLostResponseHash = acceptedPostPhase1BWorkshopReturnDispositionHash
    if (stocktakeLostResponseChanged) {
      check(stocktakeLostResponseChanged.before === acceptedPostPhase1BWorkshopReturnDispositionHash, `Stocktake lost-response declaration baseline hash mismatch: ${name}`)
      acceptedPostStocktakeLostResponseHash = stocktakeLostResponseChanged.after
    }
""",
    '1906A Phase 1B hash chain',
)

replace_once(
    'scripts/release-check.mjs',
    """    'scripts/step192b2a4-order-create-save-integrity-manifest.json',
""",
    """    'scripts/step192b2a4-order-create-save-integrity-manifest.json',
    'scripts/phase1b-workshop-return-disposition-worker-manifest.json',
""",
    'release check Phase 1B manifest presence',
)

print('Phase 1B structural manifest chain patched successfully.')

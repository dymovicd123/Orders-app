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
    """    const financeF9SummaryChanged = financeF9SummaryChanges[name]
    const acceptedPostFinanceF9SummaryHash = financeF9SummaryChanged ? financeF9SummaryChanged.after : acceptedPostFinanceF6DeadMetricsHash
    if (financeF9SummaryChanged) check(financeF9SummaryChanged.before === acceptedPostFinanceF6DeadMetricsHash, `Finance F9 summary declaration baseline hash mismatch: ${name}`)
    const financeF9DatePriorityChanged = financeF9DatePriorityChanges[name]
    if (financeF9DatePriorityChanged) {
      check(financeF9DatePriorityChanged.before === acceptedPostFinanceF9SummaryHash, `Finance F9 date-priority declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF9DatePriorityChanged.after, `Worker declaration changed beyond exact Finance F9 date-priority allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF9SummaryHash, `Worker declaration body changed beyond accepted Finance F1-F9 deltas: ${name}`)
    }
""",
    """    const financeF9SummaryChanged = financeF9SummaryChanges[name]
    const acceptedPostFinanceF9SummaryHash = financeF9SummaryChanged ? financeF9SummaryChanged.after : acceptedPostFinanceF6DeadMetricsHash
    if (financeF9SummaryChanged) check(financeF9SummaryChanged.before === acceptedPostFinanceF6DeadMetricsHash, `Finance F9 summary declaration baseline hash mismatch: ${name}`)
    const financeF9DatePriorityChanged = financeF9DatePriorityChanges[name]
    let acceptedPostFinanceF9DatePriorityHash = acceptedPostFinanceF9SummaryHash
    if (financeF9DatePriorityChanged) {
      check(financeF9DatePriorityChanged.before === acceptedPostFinanceF9SummaryHash, `Finance F9 date-priority declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF9DatePriorityHash = financeF9DatePriorityChanged.after
    }
    const phase1bWorkshopReturnDispositionChanged = phase1bWorkshopReturnDispositionChanges[name]
    if (phase1bWorkshopReturnDispositionChanged) {
      check(phase1bWorkshopReturnDispositionChanged.before === acceptedPostFinanceF9DatePriorityHash, `Phase 1B Workshop return disposition baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === phase1bWorkshopReturnDispositionChanged.after, `Worker declaration changed beyond exact Phase 1B Workshop return disposition allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF9DatePriorityHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B deltas: ${name}`)
    }
""",
    '1906A Phase 1B final hash chain',
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

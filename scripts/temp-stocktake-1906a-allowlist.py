from pathlib import Path

path = Path('scripts/test-step1906a-worker-modularization.mjs')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    "const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
    "const orderCreateSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-order-create-save-integrity-manifest.json')\nconst stocktakeLostResponsePath = path.join(root, 'scripts/stocktake-lost-response-worker-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
    '1906A manifest path',
)

replace_once(
    """  const orderCreateSaveIntegrity = fs.existsSync(orderCreateSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderCreateSaveIntegrityPath, 'utf8')) : null
  const orderCreateSaveIntegrityChanges = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.changes || {}) : {}
  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}
""",
    """  const orderCreateSaveIntegrity = fs.existsSync(orderCreateSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderCreateSaveIntegrityPath, 'utf8')) : null
  const orderCreateSaveIntegrityChanges = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.changes || {}) : {}
  const orderCreateSaveIntegrityAdded = orderCreateSaveIntegrity?.version === 1 ? (orderCreateSaveIntegrity.added || {}) : {}
  const stocktakeLostResponse = fs.existsSync(stocktakeLostResponsePath) ? JSON.parse(fs.readFileSync(stocktakeLostResponsePath, 'utf8')) : null
  const stocktakeLostResponseChanges = stocktakeLostResponse?.version === 1 ? (stocktakeLostResponse.changes || {}) : {}
""",
    '1906A manifest load',
)

replace_once(
    """    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderCreateSaveIntegrityChanged.after, `Worker declaration changed beyond exact 192B2A4 order-save allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostHandoverSqlAliasHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save deltas: ${name}`)
    }
""",
    """    const orderCreateSaveIntegrityChanged = orderCreateSaveIntegrityChanges[name]
    let acceptedPostOrderCreateSaveHash = acceptedPostHandoverSqlAliasHash
    if (orderCreateSaveIntegrityChanged) {
      check(orderCreateSaveIntegrityChanged.before === acceptedPostHandoverSqlAliasHash, `192B2A4 declaration baseline hash mismatch: ${name}`)
      acceptedPostOrderCreateSaveHash = orderCreateSaveIntegrityChanged.after
    }
    const stocktakeLostResponseChanged = stocktakeLostResponseChanges[name]
    if (stocktakeLostResponseChanged) {
      check(stocktakeLostResponseChanged.before === acceptedPostOrderCreateSaveHash, `Stocktake lost-response declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === stocktakeLostResponseChanged.after, `Worker declaration changed beyond exact stocktake lost-response allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostOrderCreateSaveHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay deltas: ${name}`)
    }
""",
    '1906A final allow-list layer',
)

path.write_text(text, encoding='utf-8', newline='\n')

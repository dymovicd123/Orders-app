from pathlib import Path

path = Path('scripts/test-step1906b-frontend-modularization.mjs')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    "const orderSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-frontend-order-save-integrity-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
    "const orderSaveIntegrityPath = path.join(root, 'scripts/step192b2a4-frontend-order-save-integrity-manifest.json')\nconst stocktakeLostResponseFrontendPath = path.join(root, 'scripts/stocktake-lost-response-frontend-manifest.json')\nconst fail = (message) => { throw new Error(message) }",
    '1906B manifest path',
)

replace_once(
    "  const orderSaveIntegrity = fs.existsSync(orderSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderSaveIntegrityPath, 'utf8')) : null\n",
    "  const orderSaveIntegrity = fs.existsSync(orderSaveIntegrityPath) ? JSON.parse(fs.readFileSync(orderSaveIntegrityPath, 'utf8')) : null\n  const stocktakeLostResponseFrontend = fs.existsSync(stocktakeLostResponseFrontendPath) ? JSON.parse(fs.readFileSync(stocktakeLostResponseFrontendPath, 'utf8')) : null\n",
    '1906B manifest load',
)

replace_once(
    """      const allowedApiHookChange = label === 'api-hook' ? orderSaveIntegrity?.frontend?.apiHookChanges?.[name] : null
      if (allowedApiHookChange) {
        check(allowedApiHookChange.before === expectedHash, `192B2A4 API hook baseline mismatch: ${name}`)
        check(sha(map.get(name)) === allowedApiHookChange.after, `192B2A4 API hook changed outside exact allow-list: ${name}`)
      } else {
        check(sha(map.get(name)) === expectedHash, `Preserved declaration changed: ${key}`)
      }
""",
    """      const allowedApiHookChange = label === 'api-hook' ? orderSaveIntegrity?.frontend?.apiHookChanges?.[name] : null
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
""",
    '1906B chained api hook allow-list',
)

insert = """
  if (stocktakeLostResponseFrontend) {
    check(stocktakeLostResponseFrontend.version === 1 && stocktakeLostResponseFrontend.revision === 'stocktake-lost-response-r1', 'Stocktake lost-response frontend preservation manifest invalid')
    const apiTop = statementMap('src/app/controllers/useApiClient.ts')
    const added = stocktakeLostResponseFrontend.frontend?.apiTopAdded || {}
    check(Object.keys(added).length === 1 && Object.hasOwn(added, 'managedInventoryWriteMode'), 'Stocktake lost-response must allow exactly managedInventoryWriteMode as the new API top-level helper')
    for (const [name, expectedHash] of Object.entries(added)) {
      check(apiTop.has(name), `Stocktake lost-response API helper missing: ${name}`)
      check(sha(apiTop.get(name)) === expectedHash, `Stocktake lost-response API helper hash mismatch: ${name}`)
    }
  }

"""
replace_once(
    "\n  // Inventory panels are plain render functions, not React component boundaries: JSX stays token/text equivalent.\n",
    "\n" + insert + "  // Inventory panels are plain render functions, not React component boundaries: JSX stays token/text equivalent.\n",
    '1906B frontend helper allow-list',
)

path.write_text(text, encoding='utf-8', newline='\n')

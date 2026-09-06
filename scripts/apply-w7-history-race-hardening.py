from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)

inventory_path = 'src/features/sections/InventorySection.tsx'
test_path = 'scripts/test-w7-sku-history-price-readiness.mjs'
doc_path = 'docs/continuation/W7_SKU_HISTORY_PRICE_READINESS_20260906.md'
context_path = 'docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md'

inventory = read(inventory_path)
if 'const historyRequestRef = useRef(0)' in inventory:
    print('W7 history race hardening already applied.')
    raise SystemExit(0)

inventory = replace_once(
    inventory,
    "  const [historyStocktakeDetailBusy, setHistoryStocktakeDetailBusy] = useState(false)\n  const [simpleStockOpenProductKey, setSimpleStockOpenProductKey] = useState('')",
    "  const [historyStocktakeDetailBusy, setHistoryStocktakeDetailBusy] = useState(false)\n  const historyRequestRef = useRef(0)\n  const [simpleStockOpenProductKey, setSimpleStockOpenProductKey] = useState('')",
    'history request token state',
)

old_movements = '''  async function loadHistoryMovements(reset = true) {
    if (historyBusy) return
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const data = await loadInventoryHistory({
        source: historyVariantFilter?.source || '',
        variantId: Number(historyVariantFilter?.variantId || 0),
        q: historyQuery,
        beforeId: reset ? 0 : Number(historyNextBeforeId || 0),
        limit: 50,
      })
      const rows = Array.isArray(data?.movements) ? data.movements : []
      setHistoryRows((current) => reset ? rows : [...current, ...rows])
      setHistoryHasMore(Boolean(data?.hasMore))
      setHistoryNextBeforeId(Number(data?.nextBeforeId || 0) || null)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить историю склада.')
    } finally {
      setHistoryBusy(false)
    }
  }
'''
new_movements = '''  async function loadHistoryMovements(reset = true) {
    const requestId = ++historyRequestRef.current
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const data = await loadInventoryHistory({
        source: historyVariantFilter?.source || '',
        variantId: Number(historyVariantFilter?.variantId || 0),
        q: historyQuery,
        beforeId: reset ? 0 : Number(historyNextBeforeId || 0),
        limit: 50,
      })
      if (requestId !== historyRequestRef.current) return
      const rows = Array.isArray(data?.movements) ? data.movements : []
      setHistoryRows((current) => reset ? rows : [...current, ...rows])
      setHistoryHasMore(Boolean(data?.hasMore))
      setHistoryNextBeforeId(Number(data?.nextBeforeId || 0) || null)
    } catch (err) {
      if (requestId !== historyRequestRef.current) return
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить историю склада.')
    } finally {
      if (requestId === historyRequestRef.current) setHistoryBusy(false)
    }
  }
'''
inventory = replace_once(inventory, old_movements, new_movements, 'movement history latest-request-wins')

old_checks = '''  async function loadHistoryChecks() {
    if (historyBusy) return
    setHistoryBusy(true)
    setHistoryError('')
    setHistoryStocktakeDetail(null)
    try {
      const data = await loadInventoryCheckHistory({ source: historyVariantFilter?.source || '', variantId: Number(historyVariantFilter?.variantId || 0), limit: 40 })
      setHistoryCheckRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить ревизии и сверки.')
    } finally {
      setHistoryBusy(false)
    }
  }
'''
new_checks = '''  async function loadHistoryChecks() {
    const requestId = ++historyRequestRef.current
    setHistoryBusy(true)
    setHistoryError('')
    setHistoryStocktakeDetail(null)
    try {
      const data = await loadInventoryCheckHistory({ source: historyVariantFilter?.source || '', variantId: Number(historyVariantFilter?.variantId || 0), limit: 40 })
      if (requestId !== historyRequestRef.current) return
      setHistoryCheckRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (err) {
      if (requestId !== historyRequestRef.current) return
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить ревизии и сверки.')
    } finally {
      if (requestId === historyRequestRef.current) setHistoryBusy(false)
    }
  }
'''
inventory = replace_once(inventory, old_checks, new_checks, 'check history latest-request-wins')
write(inventory_path, inventory)

w7test = read(test_path)
w7test = replace_once(
    w7test,
    "check(inventory.includes('function openSimpleStockHistory(detail: InventoryHistoryFilter)') && inventory.includes('setHistoryVariantFilter(detail)') && inventory.includes(\"setHistoryMode('movements')\") && inventory.includes(\"openInventoryPanel('history')\"), 'existing exact-position Warehouse history opener is missing')",
    "check(inventory.includes('function openSimpleStockHistory(detail: InventoryHistoryFilter)') && inventory.includes('setHistoryVariantFilter(detail)') && inventory.includes(\"setHistoryMode('movements')\") && inventory.includes(\"openInventoryPanel('history')\"), 'existing exact-position Warehouse history opener is missing')\ncheck(inventory.includes('const historyRequestRef = useRef(0)') && inventory.includes('const requestId = ++historyRequestRef.current') && inventory.includes('if (requestId !== historyRequestRef.current) return') && inventory.includes('if (requestId === historyRequestRef.current) setHistoryBusy(false)'), 'history source/SKU switching can still be overwritten by a stale in-flight response')",
    'W7 history race regression',
)
write(test_path, w7test)

doc = read(doc_path)
doc = replace_once(
    doc,
    '## Price-readiness contract (no prices yet)\n',
    '''## Adjacent history race hardening\n\nThe W7 integration exposed an existing concurrency weakness in the shared History controller: while one history request was in flight, switching source/SKU or switching between `Движения` and `Ревизии и сверки` could be ignored by the old global busy guard, after which the stale response could populate the new context.\n\nW7 fixes this with one shared latest-request token for movement/check history. A newer source/SKU/mode request supersedes the older response; stale success/error/finally paths cannot overwrite the current history or clear its busy state. This also hardens the pre-existing `Остатки → История` entry point, not only the new Catalog buttons.\n\n## Price-readiness contract (no prices yet)\n''',
    'W7 continuation race section',
)
write(doc_path, doc)

context = read(context_path)
context = replace_once(
    context,
    'Current conclusion: exact SKU history already exists and must be reused rather than rebuilt. Catalog SKU cards route lazily to the existing Warehouse history with explicit `source + variant_id`; no history reads are added to ordinary Catalog browsing.',
    'Current conclusion: exact SKU history already exists and must be reused rather than rebuilt. Catalog SKU cards route lazily to the existing Warehouse history with explicit `source + variant_id`; no history reads are added to ordinary Catalog browsing. The shared history controller now uses latest-request-wins protection so a stale in-flight source/SKU/mode response cannot overwrite a newer history context.',
    'canonical W7 race checkpoint',
)
write(context_path, context)

print('W7 history request race hardening applied.')

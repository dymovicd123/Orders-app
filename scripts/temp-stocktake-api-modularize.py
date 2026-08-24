from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8', newline='\n')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


api_path = 'src/app/controllers/useApiClient.ts'
api = read(api_path)
api = replace_once(
    api,
    "import { ApiResponseError } from '../utils'\n",
    "import { ApiResponseError } from '../utils'\nimport { prepareManagedInventoryWrite } from './inventoryWriteRetry'\n",
    'api helper import',
)
api = replace_once(
    api,
    """function managedInventoryWriteMode(method: string, path: string): 'json' | 'empty' | null {
  if (method === 'POST' && (
    path === '/api/inventory/stocktakes'
    || path === '/api/inventory/stocktakes/quick'
    || path === '/api/inventory/stocktakes/quick-batch'
    || path === '/api/inventory/cycle-counts/apply'
  )) return 'json'
  if (method === 'PATCH' && /^\\/api\\/inventory\\/stocktakes\\/[^/]+\\/items\\/\\d+$/.test(path)) return 'json'
  if (method === 'POST' && /^\\/api\\/inventory\\/stocktakes\\/[^/]+\\/(?:complete|cancel)$/.test(path)) return 'empty'
  return null
}

""",
    '',
    'remove api managed matcher',
)
api = replace_once(
    api,
    """    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const apiPath = url.split('?')[0].replace(/^https?:\\/\\/[^/]+/i, '')
    const managedInventoryMode = managedInventoryWriteMode(method, apiPath)
    let requestBody = init.body
    let managedInventoryRequestKey = ''
    let managedInventoryRequestId = ''

    if (!safeRead && managedInventoryMode && !headers.get('X-Idempotency-Key')) {
      try {
        const basePayload = managedInventoryMode === 'json' && typeof init.body === 'string'
          ? JSON.parse(init.body) as Record<string, unknown>
          : {}
        if (!basePayload || Array.isArray(basePayload) || typeof basePayload !== 'object') throw new Error('Invalid managed request payload')
        managedInventoryRequestKey = `inventory-write:${method}:${apiPath}`
        const prepared = prepareCriticalRequest(managedInventoryRequestKey, basePayload)
        managedInventoryRequestId = prepared.requestId
        headers.set('X-Idempotency-Key', prepared.requestId)
        if (managedInventoryMode === 'json') requestBody = JSON.stringify(prepared.payload)
      } catch {
        managedInventoryRequestKey = ''
        managedInventoryRequestId = ''
        requestBody = init.body
      }
    }

    const idempotentWrite = !safeRead && Boolean(headers.get('X-Idempotency-Key'))
""",
    """    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const managedInventory = prepareManagedInventoryWrite(method, url, init.body, headers, prepareCriticalRequest)
    const requestBody = managedInventory.body
    const managedInventoryRequestKey = managedInventory.requestKey
    const managedInventoryRequestId = managedInventory.requestId
    const idempotentWrite = !safeRead && Boolean(headers.get('X-Idempotency-Key'))
""",
    'compact managed inventory setup',
)
write(api_path, api)

helper_path = 'src/app/controllers/inventoryWriteRetry.ts'
helper = """type CriticalRequestPreparer = (
  key: string,
  basePayload: Record<string, unknown>,
) => { requestId: string; payload: Record<string, unknown> }

function managedInventoryWriteMode(method: string, path: string): 'json' | 'empty' | null {
  if (method === 'POST' && (
    path === '/api/inventory/stocktakes'
    || path === '/api/inventory/stocktakes/quick'
    || path === '/api/inventory/stocktakes/quick-batch'
    || path === '/api/inventory/cycle-counts/apply'
  )) return 'json'
  if (method === 'PATCH' && /^\\/api\\/inventory\\/stocktakes\\/[^/]+\\/items\\/\\d+$/.test(path)) return 'json'
  if (method === 'POST' && /^\\/api\\/inventory\\/stocktakes\\/[^/]+\\/(?:complete|cancel)$/.test(path)) return 'empty'
  return null
}

export function prepareManagedInventoryWrite(
  method: string,
  url: string,
  body: RequestInit['body'],
  headers: Headers,
  prepareCriticalRequest: CriticalRequestPreparer,
) {
  const path = url.split('?')[0].replace(/^https?:\\/\\/[^/]+/i, '')
  const mode = managedInventoryWriteMode(method, path)
  if (!mode || headers.get('X-Idempotency-Key')) return { body, requestKey: '', requestId: '' }

  try {
    const basePayload = mode === 'json' && typeof body === 'string'
      ? JSON.parse(body) as Record<string, unknown>
      : {}
    if (!basePayload || Array.isArray(basePayload) || typeof basePayload !== 'object') throw new Error('Invalid managed request payload')
    const requestKey = `inventory-write:${method}:${path}`
    const prepared = prepareCriticalRequest(requestKey, basePayload)
    headers.set('X-Idempotency-Key', prepared.requestId)
    return {
      body: mode === 'json' ? JSON.stringify(prepared.payload) : body,
      requestKey,
      requestId: prepared.requestId,
    }
  } catch {
    return { body, requestKey: '', requestId: '' }
  }
}
"""
write(helper_path, helper)

# Keep the regression test pointed at the extracted helper rather than growing
# useApiClient solely to satisfy string guards.
test_path = 'scripts/test-step192a1-warehouse-truth-freshness.mjs'
test = read(test_path)
test = replace_once(
    test,
    "  const apiClient = read('src/app/controllers/useApiClient.ts')\n",
    "  const apiClient = read('src/app/controllers/useApiClient.ts')\n  const inventoryWriteRetry = read('src/app/controllers/inventoryWriteRetry.ts')\n",
    '192A1 helper source',
)
test = replace_once(test, "check(apiClient.includes('managedInventoryWriteMode'), 'Stocktake writes are not opted into managed retry transport')", "check(inventoryWriteRetry.includes('managedInventoryWriteMode'), 'Stocktake writes are not opted into managed retry transport')", '192A1 matcher guard')
test = replace_once(test, "check(apiClient.includes('prepareCriticalRequest(managedInventoryRequestKey, basePayload)'), 'Stocktake request id is not persisted across reload')", "check(inventoryWriteRetry.includes('prepareCriticalRequest(requestKey, basePayload)'), 'Stocktake request id is not persisted across reload')", '192A1 prepare guard')
test = replace_once(test, "check(apiClient.includes(\"headers.set('X-Idempotency-Key', prepared.requestId)\"), 'Stocktake managed writes do not enable safe transport retry')", "check(inventoryWriteRetry.includes(\"headers.set('X-Idempotency-Key', prepared.requestId)\"), 'Stocktake managed writes do not enable safe transport retry')", '192A1 header guard')
write(test_path, test)

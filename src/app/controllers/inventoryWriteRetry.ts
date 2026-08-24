type CriticalRequestPreparer = (
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
  if (method === 'PATCH' && /^\/api\/inventory\/stocktakes\/[^/]+\/items\/\d+$/.test(path)) return 'json'
  if (method === 'POST' && /^\/api\/inventory\/stocktakes\/[^/]+\/(?:complete|cancel)$/.test(path)) return 'empty'
  return null
}

export function prepareManagedInventoryWrite(
  method: string,
  url: string,
  body: RequestInit['body'],
  headers: Headers,
  prepareCriticalRequest: CriticalRequestPreparer,
) {
  const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/i, '')
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

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { AccessRole } from '../types'
import { ApiResponseError } from '../utils'
import { prepareManagedInventoryWrite } from './inventoryWriteRetry'

type CachedApiResponse = {
  body: string
  status: number
  statusText: string
  headers: Array<[string, string]>
  savedAt: number
}

const TRANSIENT_API_STATUSES = new Set([408, 425, 429, 502, 503, 504, 520, 521, 522, 523, 524])
const OPERATIONAL_GET_STALE_TTL_MS = 45 * 1000
const SUPPORTING_GET_STALE_TTL_MS = 3 * 60 * 1000
const GET_RESPONSE_CACHE_LIMIT = 12
const GET_RESPONSE_CACHE_BODY_LIMIT = 4 * 1024 * 1024

function staleReadTtlForUrl(url: string) {
  const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/i, '')
  const operational = /^\/api\/(?:orders(?:\/|$)|inventory(?:\/|$)|workshop(?:\/|$)|returns(?:\/|$)|exchanges(?:\/|$)|finance\/cash-register(?:\/|$)|catalog-review(?:\/|$)|inventory-lifecycle(?:\/|$))/.test(path)
  return operational ? OPERATIONAL_GET_STALE_TTL_MS : SUPPORTING_GET_STALE_TTL_MS
}

function waitForApiRetry(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

function responseLooksLikeHtml(response: Response, bodyText: string) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  const preview = bodyText.replace(/^\uFEFF/, '').trim().slice(0, 100).toLowerCase()
  return contentType.includes('text/html')
    || preview.startsWith('<!doctype')
    || preview.startsWith('<html')
}

function criticalRequestFingerprintTag(value: string) {
  // sessionStorage must not contain the order/customer payload itself. This non-cryptographic tag is
  // only a local lookup hint; the Worker still verifies the full SHA-256 request fingerprint, so a
  // theoretical tag collision can only produce a safe 409 conflict, never reuse another payload.
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(36)}:${value.length}`
}

function criticalRequestStorageKey(key: string) {
  return `orders-app:critical-request:${key}`
}

type ApiClientArgs = {
  accessRole: AccessRole
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
}

export function useApiClient({ accessRole, setError, setMessage }: ApiClientArgs) {
  const getResponseCacheRef = useRef(new Map<string, CachedApiResponse>())
  const lastConnectionNoticeAtRef = useRef(0)
  const criticalRequestRef = useRef(new Map<string, { fingerprint: string; requestId: string }>())

  function prepareCriticalRequest<T extends Record<string, unknown>>(key: string, basePayload: T) {
    const fingerprint = JSON.stringify(basePayload)
    const fingerprintTag = criticalRequestFingerprintTag(fingerprint)
    const previous = criticalRequestRef.current.get(key)
    let requestId = previous?.fingerprint === fingerprint ? previous.requestId : ''

    if (!requestId) {
      try {
        const raw = window.sessionStorage.getItem(criticalRequestStorageKey(key))
        const saved = raw ? JSON.parse(raw) as { fingerprintTag?: string; requestId?: string } : null
        if (saved?.fingerprintTag === fingerprintTag && typeof saved.requestId === 'string' && saved.requestId) {
          requestId = saved.requestId
        }
      } catch {
        // Storage can be disabled by browser privacy settings. In-memory idempotency still works.
      }
    }
    if (!requestId) requestId = window.crypto.randomUUID()

    criticalRequestRef.current.set(key, { fingerprint, requestId })
    try {
      window.sessionStorage.setItem(criticalRequestStorageKey(key), JSON.stringify({ fingerprintTag, requestId }))
    } catch {
      // Best effort only; never block saving an order because browser storage is unavailable.
    }
    return {
      requestId,
      payload: { ...basePayload, requestId },
    }
  }

  function completeCriticalRequest(key: string, requestId: string) {
    const current = criticalRequestRef.current.get(key)
    if (current?.requestId === requestId) criticalRequestRef.current.delete(key)
    try {
      const raw = window.sessionStorage.getItem(criticalRequestStorageKey(key))
      const saved = raw ? JSON.parse(raw) as { requestId?: string } : null
      if (saved?.requestId === requestId) window.sessionStorage.removeItem(criticalRequestStorageKey(key))
    } catch {
      // Best effort only. A stale entry with a different payload cannot pass the Worker's fingerprint.
    }
  }

  const apiFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || undefined)
    headers.set('X-Access-Role', accessRole)
    if (accessRole === 'admin') headers.set('X-Archive-Actor', 'admin')

    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const safeRead = method === 'GET' || method === 'HEAD'
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const managedInventory = prepareManagedInventoryWrite(method, url, init.body, headers, prepareCriticalRequest)
    const requestBody = managedInventory.body
    const managedInventoryRequestKey = managedInventory.requestKey
    const managedInventoryRequestId = managedInventory.requestId
    const idempotentWrite = !safeRead && Boolean(headers.get('X-Idempotency-Key'))
    const retryableRequest = safeRead || idempotentWrite
    const cacheKey = `${accessRole}:${method}:${url}`
    const retryDelays = retryableRequest ? [0, 300, 850] : [0]
    let lastError: unknown = null

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt] > 0) await waitForApiRetry(retryDelays[attempt])
      try {
        const response = await fetch(input, { ...init, body: requestBody, headers, credentials: 'include' })
        if (!retryableRequest) return response

        const bodyText = await response.clone().text()
        const transientResponse = TRANSIENT_API_STATUSES.has(response.status)
          || responseLooksLikeHtml(response, bodyText)
          || (idempotentWrite && response.ok && !bodyText.replace(/^\uFEFF/, '').trim())
          || (Boolean(managedInventoryRequestKey) && response.status >= 500)
        if (transientResponse && attempt < retryDelays.length - 1) continue

        if (safeRead && response.ok && !transientResponse && bodyText.length <= GET_RESPONSE_CACHE_BODY_LIMIT) {
          const cache = getResponseCacheRef.current
          cache.delete(cacheKey)
          cache.set(cacheKey, {
            body: bodyText,
            status: response.status,
            statusText: response.statusText,
            headers: Array.from(response.headers.entries()),
            savedAt: Date.now(),
          })
          while (cache.size > GET_RESPONSE_CACHE_LIMIT) {
            const oldestKey = cache.keys().next().value
            if (!oldestKey) break
            cache.delete(oldestKey)
          }
        }

        if (!transientResponse) {
          if (managedInventoryRequestKey && managedInventoryRequestId) {
            completeCriticalRequest(managedInventoryRequestKey, managedInventoryRequestId)
          }
          return response
        }
        // Retry only transport/transient statuses. A normal Worker 500 is returned
        // immediately so the screen sees the real application error instead of
        // repeating a deterministic failing mutation/query.
        if (attempt === retryDelays.length - 1 && !responseLooksLikeHtml(response, bodyText)) return response
        lastError = new ApiResponseError('Сервер временно недоступен.', { status: response.status, transient: true })
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') throw fetchError
        lastError = fetchError
        if (attempt < retryDelays.length - 1) continue
      }
    }

    if (safeRead) {
      const cached = getResponseCacheRef.current.get(cacheKey)
      if (cached && Date.now() - cached.savedAt <= staleReadTtlForUrl(url)) {
        setError(null)
        if (Date.now() - lastConnectionNoticeAtRef.current > 8000) {
          lastConnectionNoticeAtRef.current = Date.now()
          setMessage('Связь с сервером временно нестабильна. Показаны последние успешно загруженные данные.')
        }
        const cachedHeaders = new Headers(cached.headers)
        cachedHeaders.set('X-Orders-App-Stale', '1')
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cachedHeaders,
        })
      }
    }

    throw new ApiResponseError('Не удалось связаться с сервером после нескольких попыток.', {
      transient: true,
      status: lastError instanceof ApiResponseError ? lastError.status : 0,
    })
  }, [accessRole])

  return { apiFetch, prepareCriticalRequest, completeCriticalRequest }
}

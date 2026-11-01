import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src=readFileSync('src/features/storage/DatabaseStorageMaintenance.tsx','utf8')
const start=src.indexOf('  const loadStatus = useCallback(')
const end=src.indexOf('  useEffect(',start)
assert(start>=0 && end>start,'Storage load hook not found')
const load=src.slice(start,end)
assert(load.includes('if (!isAdmin) return null'),'Only admins should start storage reads')
assert(load.includes("apiFetch(`/api/admin/storage"),'Storage request removed')
assert(!load.includes('setError('),'Background storage reads cannot trigger global orders error alerts')
assert(load.includes('if (includeMonths) {') && load.includes('setLoadError('),
  'Explicit panel load failures need a scoped error')
assert(load.includes('setLoadError(null)'), 'Successful load must clear scoped error')
assert(src.includes('role="alert"') && src.includes('maintenance.loadError'),
  'Manual storage error should be displayed inside storage modal')
assert(src.includes('maintenance.loadStatus(true)'),'Admin needs a retry action')
assert(src.includes("setError(error instanceof Error ? error.message : 'Не удалось обновить доступный объём базы.')"),
  'Explicit admin storage mutations must still report real errors')
const worker=readFileSync('worker/index.ts','utf8')
assert(worker.includes("url.pathname === '/api/admin/storage'"), 'Guarded backend route missing')
assert(worker.includes("requireAdminUser(authUser, 'Хранилище базы доступно только администратору.')"),
  'Admin-only access control must remain on server')
console.log('STORAGE_BACKGROUND_ALERT_ISOLATED_ADMIN_GUARD_UNCHANGED_PASS')

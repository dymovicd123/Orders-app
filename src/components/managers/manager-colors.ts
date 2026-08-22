import { MANAGER_COLOR_OPTIONS } from '../../app/constants'

export function managerFallbackColor(seed: string | number) {
  const text = String(seed || 'manager')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 31) + text.charCodeAt(index)) >>> 0
  return MANAGER_COLOR_OPTIONS[hash % MANAGER_COLOR_OPTIONS.length]
}

export function resolveManagerDisplayColor(colorKey?: string | null, seed: string | number = 'manager') {
  const normalized = String(colorKey || '').trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : managerFallbackColor(seed)
}

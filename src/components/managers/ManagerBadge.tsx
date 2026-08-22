import { resolveManagerDisplayColor } from './manager-colors'

export function ManagerBadge({ name, colorKey, compact = false, seed }: { name?: string | null; colorKey?: string | null; compact?: boolean; seed?: string | number }) {
  const resolvedColor = resolveManagerDisplayColor(colorKey, seed ?? name ?? 'manager')
  return (
    <span className={`manager-badge ${compact ? 'is-compact' : ''}`} style={{ borderColor: resolvedColor }}>
      <span className="manager-color-dot" style={{ backgroundColor: resolvedColor }} />
      <span>{name || 'Не указан'}</span>
    </span>
  )
}

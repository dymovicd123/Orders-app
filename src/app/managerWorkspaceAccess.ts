import type { AccessRole, AppSector } from './types'

// Manager navigation is intentionally a three-section daily workspace.
// Keep all other sectors available to authenticated administrators.
const managerSectors = new Set<AppSector>(['orders', 'workshop', 'inventory'])
const managerMenuIds = new Set(['orders', 'workshop', 'inventory'])

export function canOpenWorkspaceSector(role: AccessRole, sector: AppSector): boolean {
  return role === 'admin' || managerSectors.has(sector)
}

export function canSeeWorkspaceMenuItem(role: AccessRole, moduleId: string): boolean {
  return role === 'admin' || managerMenuIds.has(moduleId)
}

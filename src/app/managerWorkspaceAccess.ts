import type { AccessRole, AppSector } from './types'

// Managers use four daily workspaces; all other sections remain administrator-only.
// Keep all other sectors available to authenticated administrators.
const managerSectors = new Set<AppSector>(['orders', 'workshop', 'inventory', 'reports'])
const managerMenuIds = new Set(['orders', 'workshop', 'inventory', 'reports'])

export function canOpenWorkspaceSector(role: AccessRole, sector: AppSector): boolean {
  return role === 'admin' || managerSectors.has(sector)
}

export function canSeeWorkspaceMenuItem(role: AccessRole, moduleId: string): boolean {
  return role === 'admin' || managerMenuIds.has(moduleId)
}

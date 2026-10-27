import type { AccessRole, AppSector } from './types'

// Managers may use Leads and read their own KPI; the legacy salary plan stays admin-only.
// Keep all other sectors available to authenticated administrators.
const managerSectors = new Set<AppSector>(['orders', 'workshop', 'inventory', 'reports', 'finance', 'leads', 'plan'])
const managerMenuIds = new Set(['orders', 'workshop', 'inventory', 'reports', 'finance', 'leads', 'plan'])

export function canOpenWorkspaceSector(role: AccessRole, sector: AppSector): boolean {
  return role === 'admin' || managerSectors.has(sector)
}

export function canSeeWorkspaceMenuItem(role: AccessRole, moduleId: string): boolean {
  return role === 'admin' || managerMenuIds.has(moduleId)
}

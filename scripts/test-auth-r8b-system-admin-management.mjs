import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const team = read('src/features/sections/TeamSection.tsx')

  check(team.includes("const systemAdmins = authUsers.filter((user) => user.role === 'admin' && !user.managerId)"), 'System admins are not isolated from employees')
  check(team.includes('{isAdmin ? (') && team.includes('aria-label="Системные администраторы"'), 'System-admin management is not admin-only')
  check(team.includes("role: 'admin'") && team.includes('managerId: null') && team.includes("displayName: 'Системный администратор'"), 'System-admin save path is not explicitly unlinked and admin-only')
  check(team.includes("apiFetch(isEdit ? `/api/auth/users/${existingAccount.id}` : '/api/auth/users'"), 'System-admin management bypasses the authenticated account API')
  check(team.includes('Для системного администратора задайте временный пароль минимум из 8 символов.'), 'New system admins are not protected by a temporary-password requirement')
  check(team.includes('mustChangePassword: password ? true : systemAdminDraft.mustChangePassword'), 'Temporary system-admin password does not force a password change')
  check(team.includes('Отключить системного администратора') && team.includes("method: 'DELETE'"), 'System-admin disable path is missing')
  check(team.includes('не становится сотрудником') && team.includes('не будет использоваться как менеджер заказа'), 'System-admin employee isolation is not explained in the admin UI')
  check(!team.includes("managerId: 'system'"), 'System admin uses a fake employee linkage')

  console.log('AUTH R8B SYSTEM ADMIN MANAGEMENT PASSED — admins can create/manage unlinked system accounts only through authenticated auth APIs, with forced temporary-password change and no employee linkage.')
} catch (error) {
  console.error(`AUTH R8B SYSTEM ADMIN MANAGEMENT FAILED: ${error?.message || error}`)
  process.exit(1)
}

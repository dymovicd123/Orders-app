import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const team = read('src/features/sections/TeamSection.tsx')
  const css = read('src/styles/10-workshop-reports-team.css')

  check(team.includes("const systemAdmins = authUsers.filter((user) => user.role === 'admin' && !user.managerId)"), 'System-admin classification must require admin role with no employee link')
  check(team.includes('{isAdmin ? (') && team.includes('aria-label="Системные администраторы"'), 'System-admin block is not restricted to authenticated admins')
  check(team.includes('aria-label="Системные администраторы"'), 'System-admin block has no explicit admin-facing identity')
  check(team.includes('не привязаны к сотрудникам') && team.includes('не участвуют в заказах, табеле, зарплате или рабочих отчётах'), 'System-admin isolation copy is missing')
  check(team.includes('@{account.login}') && team.includes("account.displayName || 'Системный администратор'"), 'System-admin identity/status card missing')
  check(team.includes('account.mustChangePassword') && team.includes('Нужно сменить временный пароль'), 'Temporary-password state is not visible to admins')
  check(!team.includes('systemAdmins.map((account) => <ManagerBadge'), 'System admins must not be rendered as employees/managers')
  check(css.includes('.team-system-admins') && css.includes('.team-system-admin-card'), 'System-admin admin-only block styles missing')

  console.log('AUTH R8 SYSTEM ADMIN UX PASSED — unlinked admins stay out of employee workflows and are visible only to admins in a dedicated accountability block.')
} catch (error) {
  console.error(`AUTH R8 SYSTEM ADMIN UX FAILED: ${error?.message || error}`)
  process.exit(1)
}

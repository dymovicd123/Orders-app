import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'
const allowed = new Set(['picomatch','fdir','tinyglobby','vite','@vitejs/plugin-react'])
const affectedVersion = '4.0.7'

// Narrow, fail-closed exception for an UNPATCHED dev-only advisory.
// The complete audit still runs; production audit stays an independent hard gate.
// This expires automatically on any dependency/version/advisory/path change.
export function validateUnpatchedBuildOnlyAudit(report, lock) {
  if (!report || typeof report !== 'object' || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
    throw new Error('Неполный отчёт npm audit: разрешения не применяются.')
  }
  const active = Object.entries(report.vulnerabilities)
    .filter(([,entry]) => entry && ['high','critical'].includes(entry.severity))
  if (active.length === 0) return { exception: false }
  const reported = report.metadata.vulnerabilities
  if (reported.critical !== 0 || reported.high !== 5 || active.length !== 5) {
    throw new Error('Найдено больше уязвимостей, чем одна известная цепочка picomatch.')
  }
  if (active.some(([name]) => !allowed.has(name)) ||
    active.some(([name,entry]) => !lock.packages?.['node_modules/'+name]?.dev)) {
    throw new Error('Обнаружена новая уязвимость или затронута производственная зависимость.')
  }
  if (lock.packages?.['node_modules/picomatch']?.version !== affectedVersion) {
    throw new Error('Версия picomatch изменилась: исключение нужно пересмотреть.')
  }
  const root = report.vulnerabilities.picomatch
  if (!root || root.severity !== 'high' || root.isDirect ||
    !Array.isArray(root.via) || root.via.length !== 1 ||
    typeof root.via[0] !== 'object' || root.via[0]?.url !== advisory ||
    root.via[0]?.severity !== 'high') {
    throw new Error('Уязвимость picomatch не совпадает с известной и разрешённой записью.')
  }
  for (const [name,entry] of active) {
    if (!Array.isArray(entry.via) || entry.via.length === 0 ||
      entry.via.some(via => typeof via === 'string' ? !allowed.has(via) : via?.url !== advisory)) {
      throw new Error('Серьёзная уязвимость '+name+' не сводится исключительно к picomatch.')
    }
  }
  return { exception:true, advisory, count:active.length }
}

if (process.argv[1]?.endsWith('security-dependency-audit-20261117.mjs')) {
  const result = spawnSync('npm',['audit','--json','--audit-level=high'],{encoding:'utf8',maxBuffer:12*1024*1024})
  try {
    if (result.error || ![0,1].includes(result.status)) throw new Error('Не удалось выполнить npm audit.')
    const report = JSON.parse(result.stdout)
    const lock = JSON.parse(readFileSync('package-lock.json','utf8'))
    const state = validateUnpatchedBuildOnlyAudit(report,lock)
    if (state.exception) {
      process.stdout.write('SECURITY REVIEW: npm audit всё ещё обнаруживает '+state.count+
        ' dev-зависимостей из одной цепочки '+state.advisory+
        '. Исключение действует только для picomatch@4.0.7 без выпущенного исправления. '+
        'Новые high/critical и производственные зависимости блокируются.\\n')
    } else {
      if (result.status !== 0) throw new Error('npm audit вернул ошибку без уязвимостей high/critical.')
      process.stdout.write('npm audit: серьёзных уязвимостей нет. Исключение не использовано.\\n')
    }
  } catch(error) {
    process.stderr.write('SECURITY AUDIT FAIL: '+(error instanceof Error?error.message:String(error))+'\\n')
    if (result.stderr) process.stderr.write(result.stderr)
    process.exitCode=1
  }
}

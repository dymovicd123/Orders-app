import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const changedDeclarations = [
  ['worker/core/text.ts', 'normalizeDate'],
  ['worker/domains/orders-read.ts', 'parseArchiveRules'],
  ['worker/domains/workshop.ts', 'resolveWorkshopPeriod'],
  ['worker/domains/activity.ts', 'parseReportDateRange'],
  ['worker/domains/team.ts', 'normalizeMonthParam'],
]

function declarationMap(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      result.set(statement.name.text, statement.getText(source).replace(/^export\s+/, ''))
    }
  }
  return result
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

const changes = {}
for (const [file, name] of changedDeclarations) {
  const beforeText = execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' })
  const afterText = fs.readFileSync(file, 'utf8')
  const before = declarationMap(file, beforeText).get(name)
  const after = declarationMap(file, afterText).get(name)
  if (!before || !after) throw new Error(`Declaration missing for ${name} in ${file}`)
  if (before === after) throw new Error(`Declaration ${name} did not change; refusing to widen gate`)
  changes[name] = { before: sha(before), after: sha(after) }
}

const manifest = {
  version: 1,
  revision: 'business-date-boundaries-r1',
  changes,
}
fs.writeFileSync('scripts/business-date-boundaries-r1-worker-manifest.json', JSON.stringify(manifest, null, 2) + '\n')

const gatePath = 'scripts/test-step1906a-worker-modularization.mjs'
let gate = fs.readFileSync(gatePath, 'utf8')

function replaceOnce(oldText, newText, label) {
  const first = gate.indexOf(oldText)
  if (first < 0) throw new Error(`1906A anchor missing: ${label}`)
  if (gate.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`1906A anchor not unique: ${label}`)
  gate = gate.slice(0, first) + newText + gate.slice(first + oldText.length)
}

replaceOnce(
  "const stabilizationR2ManifestPath = path.join(root, 'scripts/stabilization-20260912-r2-manager-date-worker-manifest.json')\n",
  "const stabilizationR2ManifestPath = path.join(root, 'scripts/stabilization-20260912-r2-manager-date-worker-manifest.json')\nconst businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-worker-manifest.json')\n",
  'manifest path',
)

replaceOnce(
  "if (Object.keys(stabilizationR2Manifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('September 12 R2 manager/date Worker allow-list widened unexpectedly')\n",
  "if (Object.keys(stabilizationR2Manifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('September 12 R2 manager/date Worker allow-list widened unexpectedly')\nconst businessDateBoundaryManifest = JSON.parse(fs.readFileSync(businessDateBoundaryManifestPath, 'utf8'))\nif (businessDateBoundaryManifest?.version !== 1 || businessDateBoundaryManifest?.revision !== 'business-date-boundaries-r1') throw new Error('Business date boundary Worker manifest invalid')\nif (Object.keys(businessDateBoundaryManifest.changes || {}).sort().join(',') !== 'normalizeDate,normalizeMonthParam,parseArchiveRules,parseReportDateRange,resolveWorkshopPeriod') throw new Error('Business date boundary Worker allow-list widened unexpectedly')\n",
  'manifest validation',
)

replaceOnce(
  "  + 'const stabilizationR2Changes = ' + JSON.stringify(stabilizationR2Manifest.changes || {}) + '\\n')",
  "  + 'const stabilizationR2Changes = ' + JSON.stringify(stabilizationR2Manifest.changes || {}) + '\\n'\n  + 'const businessDateBoundaryChanges = ' + JSON.stringify(businessDateBoundaryManifest.changes || {}) + '\\n')",
  'injected changes',
)

replaceOnce(
  "  '        return sha(declarations.get(name)) === acceptedPostStabilizationR2Hash',\n  '',",
  "  '        const businessDateBoundaryChanged = businessDateBoundaryChanges[name]',\n  '        let acceptedPostBusinessDateBoundaryHash = acceptedPostStabilizationR2Hash',\n  '        if (businessDateBoundaryChanged) {',\n  \"          check(businessDateBoundaryChanged.before === acceptedPostStabilizationR2Hash, 'Business date boundary baseline hash mismatch: ' + name)\",\n  '          acceptedPostBusinessDateBoundaryHash = businessDateBoundaryChanged.after',\n  '        }',\n  '        return sha(declarations.get(name)) === acceptedPostBusinessDateBoundaryHash',\n  '',",
  'final hash chain',
)

fs.writeFileSync(gatePath, gate)
console.log('Registered exact 1906A Worker delta for business date boundaries.')

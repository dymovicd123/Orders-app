// Read-only inventory of the current executable test surface.
// "Unreferenced" means not mentioned by the repository's current runners;
// it does NOT mean obsolete or safe to delete. Static workflow references
// include path-scoped/one-off jobs that may not run on every PR.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const listFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name)
  return entry.isDirectory() ? listFiles(full) : [full]
})
const name = (p) => p.replaceAll('\\', '/')
const scripts = readdirSync('scripts').filter((p) => /^test-.*\.mjs$/.test(p))
  .map((p) => 'scripts/' + p).sort()
const scriptSet = new Set(scripts)
const workflowFiles = listFiles('.github/workflows').filter((p) => /\.ya?ml$/.test(p))
const testPaths = (source) => [...source.matchAll(/(?:scripts\/)?(test-[a-zA-Z0-9._-]+\.mjs)/g)]
  .map((m) => 'scripts/' + m[1]).filter((p) => scriptSet.has(p))
const fromWorkflows = new Set(workflowFiles.flatMap((p) => testPaths(readFileSync(p, 'utf8'))))
const releaseFile = 'scripts/test-main-current-business-release-20261031.mjs'
const fromRelease = new Set(testPaths(readFileSync(releaseFile, 'utf8')))
const fromPackage = new Set(testPaths(readFileSync('package.json', 'utf8')))
const otherRunnerFiles = readdirSync('scripts').filter((p) => p.endsWith('.mjs'))
  .map((p) => 'scripts/' + p)
const fromOtherScripts = new Set()
for (const p of otherRunnerFiles) {
  for (const target of testPaths(readFileSync(p, 'utf8'))) {
    if (target !== p) fromOtherScripts.add(target)
  }
}
// Static references are an upper bound: path-filtered and one-time workflows
// are not necessarily running in the current CI for every PR.
const wiredToActiveWorkflowOrReleaseGate = new Set([...fromWorkflows, ...fromRelease])
const notDirectlyWiredToCI = scripts.filter((p) => !wiredToActiveWorkflowOrReleaseGate.has(p))
const candidateUnreferenced = scripts.filter((p) => !fromWorkflows.has(p)
  && !fromRelease.has(p) && !fromPackage.has(p) && !fromOtherScripts.has(p))
const fixturePaths = listFiles('scripts/fixtures')
const fixtureBytes = fixturePaths.reduce((sum, p) => sum + statSync(p).size, 0)
const duplicateGroups = new Map()
for (const p of scripts) {
  const hash = createHash('sha256').update(readFileSync(p)).digest('hex')
  duplicateGroups.set(hash, [...(duplicateGroups.get(hash) || []), p])
}
const duplicates = [...duplicateGroups.values()].filter((group) => group.length > 1)
const largest = scripts.map((p) => ({ path: name(p), bytes: statSync(p).size }))
  .sort((a,b) => b.bytes-a.bytes).slice(0,12)
const result = {
  totalTests: scripts.length,
  referencedInRequiredReleaseGate: fromRelease.size,
  directlyReferencedByCurrentCI: wiredToActiveWorkflowOrReleaseGate.size,
  notDirectlyWiredToCurrentCI: notDirectlyWiredToCI.length,
  referencedInActiveWorkflows: fromWorkflows.size,
  referencedInOtherScripts: fromOtherScripts.size,
  referencedInPackageScripts: fromPackage.size,
  candidatesForManualReview: candidateUnreferenced.length,
  candidateExamples: candidateUnreferenced.slice(0,25),
  exactDuplicateGroups: duplicates.length,
  exactDuplicateFiles: duplicates.flat().length,
  duplicates: duplicates.slice(0,8),
  activeWorkflowFiles: workflowFiles.length,
  historicalFixtureFiles: fixturePaths.length,
  historicalFixtureBytes: fixtureBytes,
  largestTests: largest,
}
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} else {
  for (const [k,v] of Object.entries(result)) {
    if (Array.isArray(v)) continue
    console.log('CI_INVENTORY', k, v)
  }
  console.log('CI_INVENTORY_REVIEW_CANDIDATES (not deletion list)', JSON.stringify(result.candidateExamples))
  console.log('CI_INVENTORY_LARGEST_TESTS', JSON.stringify(result.largestTests))
}

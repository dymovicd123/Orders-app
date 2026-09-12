import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (value) => value.replace(/^export\s+/, '')

function declarationHash(sourceText, fileName, targetName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === targetName) {
      return sha(normalize(statement.getText(source)))
    }
  }
  throw new Error(`Declaration not found: ${targetName} in ${fileName}`)
}

function gitShow(refPath) {
  return execFileSync('git', ['show', refPath], { encoding: 'utf8' })
}

const changes = {
  getDashboardInsights: {
    before: declarationHash(gitShow('origin/main:worker/domains/inventory-read.ts'), 'inventory-read-main.ts', 'getDashboardInsights'),
    after: declarationHash(fs.readFileSync('worker/domains/inventory-read.ts', 'utf8'), 'inventory-read.ts', 'getDashboardInsights'),
  },
  listWorkshopTasks: {
    before: declarationHash(gitShow('origin/main:worker/domains/workshop.ts'), 'workshop-main.ts', 'listWorkshopTasks'),
    after: declarationHash(fs.readFileSync('worker/domains/workshop.ts', 'utf8'), 'workshop.ts', 'listWorkshopTasks'),
  },
}
for (const [name, value] of Object.entries(changes)) {
  if (value.before === value.after) throw new Error(`Expected changed declaration: ${name}`)
}

const manifest = {
  version: 1,
  revision: 'dashboard-workshop-attention-r1',
  changes,
}
fs.writeFileSync('scripts/dashboard-workshop-attention-r1-worker-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

const wrapperPath = 'scripts/test-step1906a-worker-modularization.mjs'
let wrapper = fs.readFileSync(wrapperPath, 'utf8')

const pathAnchor = "const d1ReadBudgetR63ManifestPath = path.join(root, 'scripts/d1-read-budget-r6-3-worker-manifest.json')\n"
if (!wrapper.includes(pathAnchor)) throw new Error('R6.3 manifest path anchor missing')
wrapper = wrapper.replace(pathAnchor, pathAnchor + "const dashboardWorkshopAttentionManifestPath = path.join(root, 'scripts/dashboard-workshop-attention-r1-worker-manifest.json')\n")

const validationAnchor = "if (Object.keys(d1ReadBudgetR63Manifest.changes || {}).join(',') !== 'listFinanceReports') throw new Error('D1 read budget R6.3 Worker allow-list widened unexpectedly')\n"
if (!wrapper.includes(validationAnchor)) throw new Error('R6.3 validation anchor missing')
const validationBlock = [
  validationAnchor.trimEnd(),
  "const dashboardWorkshopAttentionManifest = JSON.parse(fs.readFileSync(dashboardWorkshopAttentionManifestPath, 'utf8'))",
  "if (dashboardWorkshopAttentionManifest?.version !== 1 || dashboardWorkshopAttentionManifest?.revision !== 'dashboard-workshop-attention-r1') throw new Error('Dashboard workshop attention R1 Worker manifest invalid')",
  "if (Object.keys(dashboardWorkshopAttentionManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listWorkshopTasks') throw new Error('Dashboard workshop attention R1 Worker allow-list widened unexpectedly')",
  '',
].join('\n')
wrapper = wrapper.replace(validationAnchor, validationBlock)

const injectionOld = "patched = patched.replace(r63InjectedAnchor, r63InjectedAnchor + 'const d1ReadBudgetR63Changes = ' + JSON.stringify(d1ReadBudgetR63Manifest.changes || {}) + '\\n')"
const injectionNew = "patched = patched.replace(r63InjectedAnchor, r63InjectedAnchor + 'const d1ReadBudgetR63Changes = ' + JSON.stringify(d1ReadBudgetR63Manifest.changes || {}) + '\\n' + 'const dashboardWorkshopAttentionChanges = ' + JSON.stringify(dashboardWorkshopAttentionManifest.changes || {}) + '\\n')"
if (!wrapper.includes(injectionOld)) throw new Error('R6.3 injection anchor missing')
wrapper = wrapper.replace(injectionOld, injectionNew)

const blockStart = wrapper.indexOf('const r63CheckReplacement = [')
const blockEnd = wrapper.indexOf('patched = patched.replace(r63CheckAnchor, r63CheckReplacement)', blockStart)
if (blockStart < 0 || blockEnd < 0) throw new Error('R6.3 check block anchors missing')
const replacementBlock = [
  'const r63CheckReplacement = [',
  "  '    check(',",
  "  '      (() => {',",
  "  '        const d1ReadBudgetR63Changed = d1ReadBudgetR63Changes[name]',",
  "  '        let acceptedPostR63Hash = acceptedPostCatalogUnisexMergeHash',",
  "  '        if (d1ReadBudgetR63Changed) {',",
  "  \"          check(d1ReadBudgetR63Changed.before === acceptedPostCatalogUnisexMergeHash, 'D1 read budget R6.3 baseline hash mismatch: ' + name)\",",
  "  '          acceptedPostR63Hash = d1ReadBudgetR63Changed.after',",
  "  '        }',",
  "  '        const dashboardWorkshopAttentionChanged = dashboardWorkshopAttentionChanges[name]',",
  "  '        let acceptedPostDashboardAttentionHash = acceptedPostR63Hash',",
  "  '        if (dashboardWorkshopAttentionChanged) {',",
  "  \"          check(dashboardWorkshopAttentionChanged.before === acceptedPostR63Hash, 'Dashboard workshop attention R1 baseline hash mismatch: ' + name)\",",
  "  '          acceptedPostDashboardAttentionHash = dashboardWorkshopAttentionChanged.after',",
  "  '        }',",
  "  '        return sha(declarations.get(name)) === acceptedPostDashboardAttentionHash',",
  "  '      })(),',",
  "].join('\\n') + '\\n'",
  '',
].join('\n')
wrapper = wrapper.slice(0, blockStart) + replacementBlock + wrapper.slice(blockEnd)
fs.writeFileSync(wrapperPath, wrapper)

console.log(JSON.stringify(manifest, null, 2))

import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const git = (args) => execFileSync('git', args, { encoding: 'utf8' })
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const lineCount = (text) => text.split(/\r?\n/).length
const files = [
  'src/App.tsx',
  'src/app/types.ts',
  'src/app/utils.ts',
  'src/features/sections/OrderExchangeSection.tsx',
  'src/features/sections/OrderReturnsSection.tsx',
]
const manifest = { version: 1, revision: 'returns-physical-intake-r1', files: {} }
for (const file of files) {
  const before = git(['show', `origin/main:${file}`])
  const after = fs.readFileSync(file, 'utf8')
  if (before === after) throw new Error(`Expected physical intake frontend delta missing: ${file}`)
  manifest.files[file] = {
    beforeGitBlob: gitBlobSha(before),
    afterGitBlob: gitBlobSha(after),
    beforeLines: lineCount(before),
    afterLines: lineCount(after),
  }
}
fs.writeFileSync('scripts/returns-physical-intake-r1-frontend-manifest.json', JSON.stringify(manifest, null, 2) + '\n')

const gatePath = 'scripts/test-step1906b-frontend-modularization.mjs'
let gate = fs.readFileSync(gatePath, 'utf8')
const pathAnchor = "const operationalAutonomyA5ManifestPath = path.join(root, 'scripts/operational-autonomy-a5-frontend-manifest.json')\n"
if (!gate.includes(pathAnchor)) throw new Error('1906B physical intake path anchor missing')
gate = gate.replace(pathAnchor, pathAnchor + "const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-frontend-manifest.json')\n")

const a5Validation = "if (Object.keys(operationalAutonomyA5Manifest.files || {}).join(',') !== 'src/App.tsx,src/features/sections/OrderExchangeSection.tsx') throw new Error('Operational Autonomy A5 frontend allow-list widened unexpectedly')\n"
if (!gate.includes(a5Validation)) throw new Error('1906B physical intake manifest validation anchor missing')
const physicalValidation = [
  "const returnsPhysicalIntakeManifest = JSON.parse(fs.readFileSync(returnsPhysicalIntakeManifestPath, 'utf8'))",
  "if (returnsPhysicalIntakeManifest?.version !== 1 || returnsPhysicalIntakeManifest?.revision !== 'returns-physical-intake-r1') throw new Error('Returns physical intake R1 frontend manifest invalid')",
  "const returnsPhysicalIntakeExpectedFiles = ['src/App.tsx','src/app/types.ts','src/app/utils.ts','src/features/sections/OrderExchangeSection.tsx','src/features/sections/OrderReturnsSection.tsx']",
  "if (JSON.stringify(Object.keys(returnsPhysicalIntakeManifest.files || {})) !== JSON.stringify(returnsPhysicalIntakeExpectedFiles)) throw new Error('Returns physical intake R1 frontend allow-list widened unexpectedly')",
  '',
].join('\n')
gate = gate.replace(a5Validation, a5Validation + physicalValidation)

const shaAnchor = "const gitBlobSha = (text) => { const bytes = Buffer.from(text); return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\\0')).update(bytes).digest('hex') }\n"
if (!gate.includes(shaAnchor)) throw new Error('1906B physical intake sha anchor missing')
const standaloneChecks = [
  "for (const file of ['src/app/utils.ts', 'src/features/sections/OrderReturnsSection.tsx']) {",
  "  const delta = returnsPhysicalIntakeManifest.files[file]",
  "  const actual = fs.readFileSync(path.join(root, file), 'utf8')",
  "  if (!delta || gitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\\r?\\n/).length !== delta.afterLines) throw new Error('Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)",
  "}",
  '',
].join('\n')
gate = gate.replace(shaAnchor, shaAnchor + standaloneChecks)

const deltaAnchor = "    const operationalAutonomyA5Delta = operationalAutonomyA5Manifest.files?.[file]\n"
if (!gate.includes(deltaAnchor)) throw new Error('1906B physical intake delta anchor missing')
gate = gate.replace(deltaAnchor, deltaAnchor + "    const returnsPhysicalIntakeDelta = returnsPhysicalIntakeManifest.files?.[file]\n")

const a5Block = [
  "    if (operationalAutonomyA5Delta) {",
  "      if (operationalAutonomyA5Delta.beforeGitBlob !== acceptedGitBlob || operationalAutonomyA5Delta.beforeLines !== acceptedLines) throw new Error('Operational Autonomy A5 frontend predecessor drifted: ' + file)",
  "      acceptedGitBlob = operationalAutonomyA5Delta.afterGitBlob",
  "      acceptedLines = operationalAutonomyA5Delta.afterLines",
  "    }",
].join('\n')
if (!gate.includes(a5Block)) throw new Error('1906B physical intake A5 chain anchor missing')
const physicalChain = [
  a5Block,
  "    if (returnsPhysicalIntakeDelta) {",
  "      if (returnsPhysicalIntakeDelta.beforeGitBlob !== acceptedGitBlob || returnsPhysicalIntakeDelta.beforeLines !== acceptedLines) throw new Error('Returns physical intake R1 frontend predecessor drifted: ' + file)",
  "      acceptedGitBlob = returnsPhysicalIntakeDelta.afterGitBlob",
  "      acceptedLines = returnsPhysicalIntakeDelta.afterLines",
  "    }",
].join('\n')
gate = gate.replace(a5Block, physicalChain)

const errorAnchor = "      throw new Error(operationalAutonomyA5Delta\n        ? 'Operational Autonomy A5 frontend file changed beyond exact manifest: ' + file\n"
if (!gate.includes(errorAnchor)) throw new Error('1906B physical intake error-chain anchor missing')
gate = gate.replace(errorAnchor, "      throw new Error(returnsPhysicalIntakeDelta\n        ? 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file\n        : operationalAutonomyA5Delta\n        ? 'Operational Autonomy A5 frontend file changed beyond exact manifest: ' + file\n")

fs.writeFileSync(gatePath, gate)
console.log('1906B physical intake manifest and exact frontend layer finalized')

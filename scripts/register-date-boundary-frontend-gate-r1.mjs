import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const changedFiles = [
  'src/App.tsx',
  'src/app/utils.ts',
  'src/features/sections/DashboardSection.tsx',
]

function gitBlobSha(text) {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

function lineCount(text) {
  return text.split(/\r?\n/).length
}

const files = {}
for (const file of changedFiles) {
  const before = execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' })
  const after = fs.readFileSync(file, 'utf8')
  if (before === after) throw new Error(`Frontend file did not change; refusing to widen gate: ${file}`)
  files[file] = {
    beforeGitBlob: gitBlobSha(before),
    afterGitBlob: gitBlobSha(after),
    beforeLines: lineCount(before),
    afterLines: lineCount(after),
  }
}
fs.writeFileSync('scripts/business-date-boundaries-r1-frontend-manifest.json', JSON.stringify({
  version: 1,
  revision: 'business-date-boundaries-r1',
  files,
}, null, 2) + '\n')

const gatePath = 'scripts/test-step1906b-frontend-modularization.mjs'
let gate = fs.readFileSync(gatePath, 'utf8')

function replaceOnce(oldText, newText, label) {
  const first = gate.indexOf(oldText)
  if (first < 0) throw new Error(`1906B anchor missing: ${label}`)
  if (gate.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`1906B anchor not unique: ${label}`)
  gate = gate.slice(0, first) + newText + gate.slice(first + oldText.length)
}

replaceOnce(
  "const stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-frontend-manifest.json')\n",
  "const stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-frontend-manifest.json')\nconst businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-frontend-manifest.json')\n",
  'manifest path',
)

replaceOnce(
  "if (JSON.stringify(Object.keys(stabilizationManifest.files || {})) !== JSON.stringify(stabilizationExpectedFiles)) throw new Error('September 12 stabilization frontend allow-list widened unexpectedly')\nconst gitBlobSha",
  "if (JSON.stringify(Object.keys(stabilizationManifest.files || {})) !== JSON.stringify(stabilizationExpectedFiles)) throw new Error('September 12 stabilization frontend allow-list widened unexpectedly')\nconst businessDateBoundaryManifest = JSON.parse(fs.readFileSync(businessDateBoundaryManifestPath, 'utf8'))\nif (businessDateBoundaryManifest?.version !== 1 || businessDateBoundaryManifest?.revision !== 'business-date-boundaries-r1') throw new Error('Business date boundary frontend manifest invalid')\nconst businessDateBoundaryExpectedFiles = ['src/App.tsx','src/app/utils.ts','src/features/sections/DashboardSection.tsx']\nif (JSON.stringify(Object.keys(businessDateBoundaryManifest.files || {})) !== JSON.stringify(businessDateBoundaryExpectedFiles)) throw new Error('Business date boundary frontend allow-list widened unexpectedly')\nconst gitBlobSha",
  'manifest validation',
)

replaceOnce(
  "  if (stabilizationDelta) {\n    if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)\n    acceptedGitBlob = stabilizationDelta.afterGitBlob\n    acceptedLines = stabilizationDelta.afterLines\n  }\n  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) throw new Error(stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)\n",
  "  if (stabilizationDelta) {\n    if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)\n    acceptedGitBlob = stabilizationDelta.afterGitBlob\n    acceptedLines = stabilizationDelta.afterLines\n  }\n  const businessDateBoundaryDelta = businessDateBoundaryManifest.files?.[file]\n  if (businessDateBoundaryDelta) {\n    if (businessDateBoundaryDelta.beforeGitBlob !== acceptedGitBlob || businessDateBoundaryDelta.beforeLines !== acceptedLines) throw new Error('Business date boundary frontend predecessor drifted: ' + file)\n    acceptedGitBlob = businessDateBoundaryDelta.afterGitBlob\n    acceptedLines = businessDateBoundaryDelta.afterLines\n  }\n  if (!delta || gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) throw new Error(businessDateBoundaryDelta ? 'Business date boundary frontend file changed beyond exact manifest: ' + file : stabilizationDelta ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file : 'Returns physical intake R1 frontend file changed beyond exact manifest: ' + file)\n",
  'utils standalone chain',
)

replaceOnce(
  "const stabilizationDashboardActual = fs.readFileSync(path.join(root, stabilizationDashboardFile), 'utf8')\nif (!stabilizationDashboardDelta || gitBlobSha(stabilizationDashboardActual) !== stabilizationDashboardDelta.afterGitBlob || stabilizationDashboardActual.split(/\\r?\\n/).length !== stabilizationDashboardDelta.afterLines) throw new Error('September 12 Dashboard frontend changed beyond exact stabilization manifest')\n",
  "const stabilizationDashboardActual = fs.readFileSync(path.join(root, stabilizationDashboardFile), 'utf8')\nconst businessDateBoundaryDashboardDelta = businessDateBoundaryManifest.files[stabilizationDashboardFile]\nif (!stabilizationDashboardDelta || !businessDateBoundaryDashboardDelta) throw new Error('Dashboard frontend date-boundary manifests missing')\nif (businessDateBoundaryDashboardDelta.beforeGitBlob !== stabilizationDashboardDelta.afterGitBlob || businessDateBoundaryDashboardDelta.beforeLines !== stabilizationDashboardDelta.afterLines) throw new Error('Business date boundary Dashboard predecessor drifted')\nif (gitBlobSha(stabilizationDashboardActual) !== businessDateBoundaryDashboardDelta.afterGitBlob || stabilizationDashboardActual.split(/\\r?\\n/).length !== businessDateBoundaryDashboardDelta.afterLines) throw new Error('Business date boundary Dashboard frontend changed beyond exact manifest')\n",
  'dashboard chain',
)

replaceOnce(
  "    const returnsPhysicalIntakeDelta = returnsPhysicalIntakeManifest.files?.[file]\n    let acceptedGitBlob = delta.afterGitBlob",
  "    const returnsPhysicalIntakeDelta = returnsPhysicalIntakeManifest.files?.[file]\n    const businessDateBoundaryDelta = businessDateBoundaryManifest.files?.[file]\n    let acceptedGitBlob = delta.afterGitBlob",
  'current file delta declaration',
)

replaceOnce(
  "    if (stabilizationDelta) {\n      if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)\n      acceptedGitBlob = stabilizationDelta.afterGitBlob\n      acceptedLines = stabilizationDelta.afterLines\n    }\n    if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) {\n      throw new Error(stabilizationDelta\n        ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file",
  "    if (stabilizationDelta) {\n      if (stabilizationDelta.beforeGitBlob !== acceptedGitBlob || stabilizationDelta.beforeLines !== acceptedLines) throw new Error('September 12 stabilization frontend predecessor drifted: ' + file)\n      acceptedGitBlob = stabilizationDelta.afterGitBlob\n      acceptedLines = stabilizationDelta.afterLines\n    }\n    if (businessDateBoundaryDelta) {\n      if (businessDateBoundaryDelta.beforeGitBlob !== acceptedGitBlob || businessDateBoundaryDelta.beforeLines !== acceptedLines) throw new Error('Business date boundary frontend predecessor drifted: ' + file)\n      acceptedGitBlob = businessDateBoundaryDelta.afterGitBlob\n      acceptedLines = businessDateBoundaryDelta.afterLines\n    }\n    if (gitBlobSha(actual) !== acceptedGitBlob || actual.split(/\\r?\\n/).length !== acceptedLines) {\n      throw new Error(businessDateBoundaryDelta\n        ? 'Business date boundary frontend file changed beyond exact manifest: ' + file\n        : stabilizationDelta\n        ? 'September 12 stabilization frontend file changed beyond exact manifest: ' + file",
  'current file chain',
)

fs.writeFileSync(gatePath, gate)
console.log('Registered exact 1906B frontend delta for business date boundaries.')

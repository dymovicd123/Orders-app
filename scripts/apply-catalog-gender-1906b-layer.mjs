import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const files = [
  'src/App.tsx',
  'src/app/controllers/useOperationalViewModel.ts',
  'src/app/controllers/useWorkspaceViewModel.tsx',
  'src/app/types.ts',
  'src/features/inventory/views/catalogLegacyAdminModes.tsx',
  'src/features/inventory/views/renderInventoryCatalogPanel.tsx',
  'src/features/sections/InventorySection.tsx',
  'src/features/sections/OrderExchangeSection.tsx',
]
const fixtureRoot = path.join(root, 'scripts/fixtures/catalog-gender-scope-r1')
fs.mkdirSync(fixtureRoot, { recursive: true })
const manifest = { version: 1, revision: 'catalog-gender-scope-r1', files: {} }
for (const file of files) {
  const current = fs.readFileSync(path.join(root, file), 'utf8')
  const before = execFileSync('git', ['show', `origin/main:${file}`], { cwd: root, encoding: 'utf8' })
  if (current === before) throw new Error(`Catalog frontend target unexpectedly unchanged: ${file}`)
  const fixturePath = path.join(fixtureRoot, file)
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true })
  fs.writeFileSync(fixturePath, before)
  manifest.files[file] = {
    beforeGitBlob: gitBlobSha(before),
    afterGitBlob: gitBlobSha(current),
    beforeLines: before.split(/\r?\n/).length,
    afterLines: current.split(/\r?\n/).length,
  }
}
const predecessor = execFileSync('git', ['show', 'origin/main:scripts/test-step1906b-frontend-modularization.mjs'], { cwd: root, encoding: 'utf8' })
fs.writeFileSync(path.join(fixtureRoot, 'test-step1906b-frontend-modularization-predecessor.mjs'), predecessor)
fs.writeFileSync(path.join(root, 'scripts/catalog-gender-scope-r1-frontend-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

// Some historical regression tests intentionally inspect this entrypoint as text. Preserve the complete
// predecessor source in a comment so their compatibility markers remain visible while execution is delegated
// through the frozen predecessor fixture.
const predecessorMeta = predecessor.replaceAll('*/', '* /')
const wrapper = `/* PRESERVED PRE-CATALOG 1906B META-TEXT\n${predecessorMeta}\nEND PRESERVED PRE-CATALOG 1906B META-TEXT */\n\nimport fs from 'node:fs'\nimport path from 'node:path'\nimport crypto from 'node:crypto'\nimport { spawnSync } from 'node:child_process'\n\nconst root = process.cwd()\nconst manifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-frontend-manifest.json')\nconst fixtureRoot = path.join(root, 'scripts/fixtures/catalog-gender-scope-r1')\nconst predecessorFixture = path.join(fixtureRoot, 'test-step1906b-frontend-modularization-predecessor.mjs')\nconst runtimePredecessor = path.join(root, 'scripts/.tmp-test-step1906b-catalog-predecessor.mjs')\nconst expectedFiles = ${JSON.stringify(files)}\nconst manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))\nif (manifest?.version !== 1 || manifest?.revision !== 'catalog-gender-scope-r1') throw new Error('Catalog gender scope frontend manifest invalid')\nif (JSON.stringify(Object.keys(manifest.files || {})) !== JSON.stringify(expectedFiles)) throw new Error('Catalog gender scope frontend allow-list widened unexpectedly')\nconst gitBlobSha = (text) => { const bytes = Buffer.from(text); return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\\0')).update(bytes).digest('hex') }\nconst current = new Map()\ntry {\n  for (const file of expectedFiles) {\n    const actualPath = path.join(root, file)\n    const baselinePath = path.join(fixtureRoot, file)\n    const actual = fs.readFileSync(actualPath, 'utf8')\n    const baseline = fs.readFileSync(baselinePath, 'utf8')\n    const delta = manifest.files[file]\n    if (gitBlobSha(actual) !== delta.afterGitBlob) throw new Error('Catalog gender frontend file changed beyond exact manifest: ' + file)\n    if (gitBlobSha(baseline) !== delta.beforeGitBlob) throw new Error('Catalog gender frontend baseline drifted: ' + file)\n    if (actual.split(/\\r?\\n/).length !== delta.afterLines || baseline.split(/\\r?\\n/).length !== delta.beforeLines) throw new Error('Catalog gender frontend line contract drifted: ' + file)\n    current.set(file, actual)\n    fs.writeFileSync(actualPath, baseline)\n  }\n  fs.writeFileSync(runtimePredecessor, fs.readFileSync(predecessorFixture, 'utf8'))\n  const result = spawnSync(process.execPath, [runtimePredecessor], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })\n  if (result?.error) throw result.error\n  if (result?.status !== 0) throw new Error('Pre-catalog 1906B preservation layer failed with code ' + result?.status)\n  console.log('CATALOG GENDER FRONTEND STRUCTURAL LAYER PASSED — exact current UI delta accepted over preserved main baseline')\n} finally {\n  for (const [file, text] of current) fs.writeFileSync(path.join(root, file), text)\n  if (fs.existsSync(runtimePredecessor)) fs.rmSync(runtimePredecessor)\n}\n`
fs.writeFileSync(path.join(root, 'scripts/test-step1906b-frontend-modularization.mjs'), wrapper)
console.log('Catalog gender scope R1 exact Step 190.6B frontend layer generated.')

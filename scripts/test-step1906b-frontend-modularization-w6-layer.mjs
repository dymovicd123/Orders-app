import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const root = process.cwd()
const panelPath = path.join(root, 'src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const componentPath = path.join(root, 'src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const cssPath = path.join(root, 'src/styles/w6-4-catalog-sku-card.css')
const baselinePanelPath = path.join(root, 'scripts/fixtures/renderInventoryCatalogPanel-w6-3-baseline.tsx')
const legacyTestPath = path.join(root, 'scripts/test-step1906b-frontend-modularization-legacy.mjs')
const manifestPath = path.join(root, 'scripts/w6-4-catalog-sku-card-frontend-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8')
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8')
  return crypto.createHash('sha1').update(header).update(body).digest('hex')
}

function parseFunction(text, fileName, functionName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = null
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) found = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  check(found?.body && ts.isBlock(found.body), `${functionName}: function not found`)
  return { source, fn: found }
}

function returnHash(text, fileName, functionName) {
  const { source, fn } = parseFunction(text, fileName, functionName)
  const returnStatement = [...fn.body.statements].find((statement) => ts.isReturnStatement(statement))
  check(returnStatement?.expression, `${functionName}: return expression missing`)
  let expression = returnStatement.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return sha256(normalize(expression.getText(source)))
}

function directHookTokens(text, fileName, functionName) {
  const { fn } = parseFunction(text, fileName, functionName)
  const result = []
  function visit(node) {
    if (ts.isFunctionLike(node) && node !== fn) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use[A-Z]/.test(node.expression.text)) {
      result.push(node.expression.text)
      return
    }
    ts.forEachChild(node, visit)
  }
  for (const statement of fn.body.statements) visit(statement)
  return result
}

try {
  for (const required of [panelPath, componentPath, cssPath, baselinePanelPath, legacyTestPath, manifestPath]) {
    check(fs.existsSync(required), `W6.4 frontend structural file missing: ${path.relative(root, required)}`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  check(manifest?.version === 1 && manifest?.revision === 'w6-4-catalog-sku-card', 'W6.4 frontend manifest invalid')
  const expectedFiles = [
    'src/features/inventory/views/renderInventoryCatalogPanel.tsx',
    'src/features/inventory/views/catalogPolishExecutionGroups.tsx',
    'src/styles/w6-4-catalog-sku-card.css',
  ]
  check(JSON.stringify(Object.keys(manifest.files || {})) === JSON.stringify(expectedFiles), 'W6.4 frontend file allow-list widened unexpectedly')

  const currentPanel = fs.readFileSync(panelPath, 'utf8')
  const currentComponent = fs.readFileSync(componentPath, 'utf8')
  const currentCss = fs.readFileSync(cssPath, 'utf8')
  const baselinePanel = fs.readFileSync(baselinePanelPath, 'utf8')
  const panelManifest = manifest.files[expectedFiles[0]]
  const componentManifest = manifest.files[expectedFiles[1]]
  const cssManifest = manifest.files[expectedFiles[2]]

  check(gitBlobSha(baselinePanel) === panelManifest.beforeGitBlob, 'W6.4 frozen W6.3 panel fixture changed')
  check(gitBlobSha(currentPanel) === panelManifest.afterGitBlob, 'W6.4 catalog panel changed beyond exact manifest')
  check(gitBlobSha(currentComponent) === componentManifest.afterGitBlob, 'W6.4 SKU-card component changed beyond exact manifest')
  check(gitBlobSha(currentCss) === cssManifest.afterGitBlob, 'W6.4 SKU-card CSS changed beyond exact manifest')
  check(returnHash(baselinePanel, baselinePanelPath, 'renderInventoryCatalogPanel') === manifest.baselineReturnHash, 'W6.4 frozen panel does not match accepted W6.3 return baseline')
  check(directHookTokens(currentPanel, panelPath, 'renderInventoryCatalogPanel').length === 0, 'W6.4 catalog renderer unexpectedly owns React hooks/lifecycle')

  for (const marker of [
    'isAdmin={isAdmin}',
    'loadCatalogData={loadCatalogData}',
    'Исправить ошибку в комбинации',
    'Сохранить исправление',
  ]) check(currentPanel.includes(marker), `W6.4 catalog panel marker missing: ${marker}`)
  for (const marker of [
    'Открыть карточку этой точной позиции',
    'Создать похожий',
    'Исправить ошибку',
    'Вывести из каталога',
    'credentials: \'include\'',
    'повторять вывод не нужно',
    '!selectedVariants.length && isAdmin',
  ]) check(currentComponent.includes(marker), `W6.4 SKU-card marker missing: ${marker}`)
  for (const marker of ['catalog-sku-card', '@media(max-width:760px)', '@media(max-width:460px)']) {
    check(currentCss.includes(marker), `W6.4 SKU-card CSS marker missing: ${marker}`)
  }

  fs.writeFileSync(panelPath, baselinePanel)
  let result
  try {
    result = spawnSync(process.execPath, [legacyTestPath], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  } finally {
    fs.writeFileSync(panelPath, currentPanel)
  }
  if (result?.error) fail(`Legacy 1906B gate could not run: ${result.error.message}`)
  check(result?.status === 0, `Legacy 1906B gate failed with code ${result?.status}`)
  check(fs.readFileSync(panelPath, 'utf8') === currentPanel, 'W6.4 frontend structural gate failed to restore current catalog panel')

  console.log('W6.4 FRONTEND STRUCTURAL LAYER PASSED — W6.3 panel baseline preserved; exact W6.4 panel/component/CSS delta accepted')
} catch (error) {
  console.error(`W6.4 FRONTEND STRUCTURAL LAYER FAILED: ${error?.message || error}`)
  process.exit(1)
}

import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const apiPath = 'src/app/controllers/useApiClient.ts'
const helperPath = 'src/app/controllers/inventoryWriteRetry.ts'
const outputPath = 'scripts/stocktake-lost-response-frontend-manifest.json'
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (value) => value
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')
  .replace(/^export\s+/, '')

function sourceFor(text) {
  return ts.createSourceFile(apiPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function findFunction(source, name) {
  let found = null
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  source.forEachChild(visit)
  if (!found?.body || !ts.isBlock(found.body)) throw new Error(`Function ${name} not found`)
  return found
}

function declarationName(statement) {
  if (ts.isFunctionDeclaration(statement) && statement.name) return statement.name.text
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0]
    if (ts.isIdentifier(declaration.name)) return declaration.name.text
  }
  return ''
}

function statementMap(text, functionName = null) {
  const source = sourceFor(text)
  const statements = functionName ? findFunction(source, functionName).body.statements : source.statements
  return new Map(statements
    .map((statement) => [declarationName(statement), normalize(statement.getText(source))])
    .filter(([name]) => name))
}

const beforeText = execFileSync('git', ['show', `HEAD:${apiPath}`], { encoding: 'utf8' })
const afterText = fs.readFileSync(apiPath, 'utf8')
const beforeHook = statementMap(beforeText, 'useApiClient')
const afterHook = statementMap(afterText, 'useApiClient')

if (!beforeHook.has('apiFetch') || !afterHook.has('apiFetch')) throw new Error('apiFetch statement missing')
const beforeApiFetch = hash(beforeHook.get('apiFetch'))
const afterApiFetch = hash(afterHook.get('apiFetch'))
if (beforeApiFetch === afterApiFetch) throw new Error('Expected apiFetch to change')
if (!fs.existsSync(helperPath)) throw new Error(`${helperPath} missing after modularization`)

fs.writeFileSync(outputPath, JSON.stringify({
  version: 1,
  revision: 'stocktake-lost-response-r1',
  reason: 'Managed browser retry/idempotency transport for audited stocktake and physical-check mutations.',
  frontend: {
    apiHookChanges: {
      apiFetch: { before: beforeApiFetch, after: afterApiFetch },
    },
    modulesAdded: {
      [helperPath]: hash(normalize(fs.readFileSync(helperPath, 'utf8'))),
    },
  },
}, null, 2) + '\n')

console.log(`Generated ${outputPath} for apiFetch + ${helperPath}.`)

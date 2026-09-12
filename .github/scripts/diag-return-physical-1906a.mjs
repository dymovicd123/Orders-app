import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')
function declarationNames(statement) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}
function git(args) { return execFileSync('git', args, { encoding: 'utf8' }) }
function list(ref) {
  return git(['ls-tree', '-r', '--name-only', ref, 'worker']).split(/\r?\n/).filter((p) => p.endsWith('.ts')).sort()
}
function read(ref, file) {
  if (ref === 'HEAD') return fs.readFileSync(file, 'utf8')
  return git(['show', `${ref}:${file}`])
}
function collect(ref) {
  const declarations = new Map()
  let router = ''
  for (const file of list(ref)) {
    const text = read(ref, file)
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of source.statements) {
      for (const name of declarationNames(statement)) {
        if (declarations.has(name)) throw new Error(`duplicate declaration ${name} at ${file}`)
        declarations.set(name, normalizeMovedDeclaration(statement.getText(source)))
      }
      if (file === 'worker/index.ts' && ts.isExportAssignment(statement)) router = statement.getText(source)
    }
  }
  return { declarations, router }
}

const baseRef = 'origin/main'
const before = collect(baseRef)
const after = collect('HEAD')
const changes = {}
const added = {}
const removed = {}
for (const [name, text] of before.declarations) {
  const next = after.declarations.get(name)
  if (next === undefined) removed[name] = sha(text)
  else if (next !== text) changes[name] = { before: sha(text), after: sha(next) }
}
for (const [name, text] of after.declarations) {
  if (!before.declarations.has(name)) added[name] = sha(text)
}
const result = {
  version: 1,
  revision: 'returns-physical-intake-r1',
  baseRef,
  baseCount: before.declarations.size,
  headCount: after.declarations.size,
  changes,
  added,
  removed,
  router: before.router === after.router ? null : { before: sha(before.router), after: sha(after.router) },
}
console.log(JSON.stringify(result, null, 2))

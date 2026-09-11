import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (text) => text.replace(/^export\s+/, '')

function declarations(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map()
  for (const statement of source.statements) {
    const names = []
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names.push(statement.name.text)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
    }
    for (const name of names) out.set(name, sha(normalize(statement.getText(source))))
  }
  return out
}

const currentFiles = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile() && entry.name.endsWith('.ts')) currentFiles.push(path.relative(root, full).replaceAll('\\', '/'))
  }
}
walk(path.join(root, 'worker'))

const baseFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', 'worker'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).filter((file) => file.endsWith('.ts'))
const files = [...new Set([...currentFiles, ...baseFiles])].sort()
const current = new Map()
const base = new Map()

for (const file of files) {
  if (fs.existsSync(path.join(root, file))) {
    for (const [name, hash] of declarations(fs.readFileSync(path.join(root, file), 'utf8'), file)) current.set(name, { hash, file })
  }
  try {
    const text = execFileSync('git', ['show', `origin/main:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    for (const [name, hash] of declarations(text, file)) base.set(name, { hash, file })
  } catch {}
}

const added = {}
const removed = {}
const changed = {}
for (const [name, row] of current) {
  if (!base.has(name)) added[name] = row
  else if (base.get(name).hash !== row.hash) changed[name] = { file: row.file, before: base.get(name).hash, after: row.hash }
}
for (const [name, row] of base) if (!current.has(name)) removed[name] = row

console.log(JSON.stringify({ baseCount: base.size, currentCount: current.size, added, removed, changed }, null, 2))

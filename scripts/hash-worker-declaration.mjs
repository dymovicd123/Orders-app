import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const [file, declarationName] = process.argv.slice(2)
if (!file || !declarationName) throw new Error('Usage: node scripts/hash-worker-declaration.mjs <file> <declaration>')
const text = fs.readFileSync(file, 'utf8')
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const declaration = source.statements.find((statement) => (
  (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement))
  && statement.name?.text === declarationName
))
if (!declaration) throw new Error(`Declaration not found: ${declarationName}`)
const normalized = declaration.getText(source).replace(/^export\s+/, '')
process.stdout.write(crypto.createHash('sha256').update(normalized).digest('hex'))

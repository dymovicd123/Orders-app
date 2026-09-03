import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const ROOTS = ['worker', 'src']
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs'])
const files = []
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (EXTENSIONS.has(path.extname(entry.name))) files.push(full)
    }
  }
  walk(root)
}

const syntaxMarkers = [
  /\)\s*,\s*(?:SELECT|UPDATE|INSERT|DELETE)\b/i,
  /,\s*(?:FROM|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|RETURNING)\b/i,
]
const suspicious = []
const staticSyntax = []
let prepareCount = 0
let dynamicCount = 0
let staticCount = 0
const sqlite = new DatabaseSync(':memory:')
const syntaxFailure = message => /syntax error|incomplete input|unrecognized token|unterminated/i.test(String(message))

for (const file of files) {
  const sourceText = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') || file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS)
  const visit = node => {
    if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'prepare'
        && node.arguments.length) {
      prepareCount++
      const arg = node.arguments[0]
      let sql = null
      let dynamic = false
      if (ts.isNoSubstitutionTemplateLiteral(arg) || ts.isStringLiteral(arg)) {
        sql = arg.text
        staticCount++
      } else if (ts.isTemplateExpression(arg)) {
        dynamic = true
        dynamicCount++
        sql = arg.head.text
        for (const span of arg.templateSpans) sql += '__EXPR__' + span.literal.text
      }
      if (sql !== null) {
        for (const marker of syntaxMarkers) {
if (marker.test(sql)) suspicious.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${marker}`)
        }
        if (!dynamic) {
try { sqlite.prepare(sql) }
catch (error) {
  if (syntaxFailure(error?.message || error)) staticSyntax.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${error.message}`)
}
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// Compile the exact two dynamic handover templates that caused the incident, after substituting only their predicates.
const handoverFile = 'worker/domains/order-reservations.ts'
const handover = fs.readFileSync(handoverFile, 'utf8')
const compactCandidates = [...handover.matchAll(/const compact = await db\.prepare\(\s*`([\s\S]*?)`\s*\)/g)]
const detailedCandidates = [...handover.matchAll(/const result = await db\.prepare\(\s*`([\s\S]*?)`\s*\)/g)]
const dynamicCases = [
  {
    name: 'compact handover flags',
    match: compactCandidates.find(row => row[1].includes('${reservationScope}')),
    replacements: [['${reservationScope}', "r.status = 'active' AND r.variant_id IS NOT NULL"]],
  },
  {
    name: 'detailed handover',
    match: detailedCandidates.find(row => row[1].includes('${orderScope}')),
    replacements: [['${orderScope}', 'oi.order_id IN (?)']],
  },
]
for (const testCase of dynamicCases) {
  if (!testCase.match) throw new Error(`Could not locate runtime SQL template: ${testCase.name}`)
  let sql = testCase.match[1]
  for (const [from, to] of testCase.replacements) sql = sql.split(from).join(to)
  if (/\$\{/.test(sql)) throw new Error(`Unsubstituted SQL interpolation remains in ${testCase.name}`)
  try { sqlite.prepare(sql) }
  catch (error) {
    if (syntaxFailure(error?.message || error)) throw new Error(`${testCase.name} SQL syntax failed: ${error.message}`)
  }
}

if (suspicious.length || staticSyntax.length) {
  console.error('Suspicious SQL shapes:', suspicious)
  console.error('Static SQL syntax errors:', staticSyntax)
  process.exit(1)
}
console.log(`RUNTIME_SQL_SYNTAX_R1 PASSED: prepare=${prepareCount}, static=${staticCount}, dynamic=${dynamicCount}, files=${files.length}`)

import fs from 'node:fs'

const path = 'scripts/tmp-finance-f8-patch.mjs'
const source = fs.readFileSync(path, 'utf8')
const lines = source.split('\n')
let changed = false
const next = lines.map((line) => {
  if (!line.includes('Date/input explanations are not visually separated from real review warnings')) return line
  changed = true
  return `  check(renderer.includes('finance-review-panel ') && renderer.includes("'has-review' : 'is-info'"), 'Date/input explanations are not visually separated from real review warnings')`
})
if (!changed) throw new Error('Temporary F8 helper target line not found')
fs.writeFileSync(path, next.join('\n'))
console.log('Temporary F8 helper quoting fixed in workspace.')

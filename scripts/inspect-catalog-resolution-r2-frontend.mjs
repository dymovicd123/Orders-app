import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const files = [
  'src/features/orders/OrderCatalogResolutionModal.tsx',
  'src/features/orders/OrderCatalogResolutionModal.css',
]
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const info = (text) => ({ gitBlob: gitBlobSha(text), lines: text.split(/\r?\n/).length })
execFileSync('git', ['fetch', 'origin', 'main', '--depth=1'], { stdio: 'ignore' })
const result = {}
for (const file of files) {
  const head = fs.readFileSync(file, 'utf8')
  const main = execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' })
  result[file] = { main: info(main), r2: info(head) }
}
console.log(JSON.stringify(result, null, 2))

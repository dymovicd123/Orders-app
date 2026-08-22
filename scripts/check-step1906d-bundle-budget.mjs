import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.cwd()
const dist = path.join(root, 'dist', 'client')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function resolveAsset(fromFile, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null
  if (specifier.startsWith('/')) return path.join(dist, specifier.replace(/^\//, ''))
  return path.resolve(path.dirname(fromFile), specifier)
}

function staticJsGraph(entryFile) {
  const queue = [entryFile]
  const seen = new Set()
  while (queue.length) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    const text = fs.readFileSync(file, 'utf8')
    const specs = new Set()
    for (const match of text.matchAll(/\bfrom\s*["']([^"']+\.js)["']/g)) specs.add(match[1])
    for (const match of text.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+\.js)["']/g)) specs.add(match[1])
    for (const specifier of specs) {
      const target = resolveAsset(file, specifier)
      if (target && fs.existsSync(target) && !seen.has(target)) queue.push(target)
    }
  }
  return seen
}

try {
  const htmlPath = path.join(dist, 'index.html')
  check(fs.existsSync(htmlPath), 'dist/client/index.html missing after Vite build')
  const html = fs.readFileSync(htmlPath, 'utf8')
  const entryMatch = /<script[^>]+type=["']module["'][^>]+src=["']([^"']+\.js)["']/i.exec(html)
  check(entryMatch, 'Client entry module not found in index.html')
  const entry = resolveAsset(htmlPath, entryMatch[1])
  check(entry && fs.existsSync(entry), `Client entry asset missing: ${entryMatch[1]}`)

  const initialFiles = staticJsGraph(entry)
  const sizes = [...initialFiles].map((file) => {
    const buffer = fs.readFileSync(file)
    return { file: path.relative(dist, file).replace(/\\/g, '/'), raw: buffer.length, gzip: zlib.gzipSync(buffer, { level: 9 }).length }
  })
  const initialRaw = sizes.reduce((sum, item) => sum + item.raw, 0)
  const initialGzip = sizes.reduce((sum, item) => sum + item.gzip, 0)
  const allJs = fs.readdirSync(path.join(dist, 'assets')).filter((name) => name.endsWith('.js'))

  const baselineRaw = 974_160
  const baselineGzip = 231_630
  const rawReduction = 1 - initialRaw / baselineRaw
  const gzipReduction = 1 - initialGzip / baselineGzip

  check(initialRaw <= 800_000, `Initial JS raw budget exceeded: ${initialRaw} > 800000 bytes`)
  check(initialGzip <= 205_000, `Initial JS gzip budget exceeded: ${initialGzip} > 205000 bytes`)
  check(rawReduction >= 0.15, `Initial JS raw reduction is too small: ${(rawReduction * 100).toFixed(1)}%`)
  check(gzipReduction >= 0.10, `Initial JS gzip reduction is too small: ${(gzipReduction * 100).toFixed(1)}%`)
  check(allJs.length >= 12, `Expected code-split client build, found only ${allJs.length} JS assets`)

  console.log(`STEP 190.6D BUNDLE BUDGET PASSED — initial JS ${initialRaw} bytes raw / ${initialGzip} gzip; reduction ${(rawReduction * 100).toFixed(1)}% raw / ${(gzipReduction * 100).toFixed(1)}% gzip; ${initialFiles.size} initial JS files / ${allJs.length} total JS chunks`)
  for (const item of sizes.sort((a, b) => b.raw - a.raw)) console.log(`  initial: ${item.file} — ${item.raw} raw / ${item.gzip} gzip`)
} catch (error) {
  console.error(`STEP 190.6D BUNDLE BUDGET FAILED: ${error?.message || error}`)
  process.exit(1)
}

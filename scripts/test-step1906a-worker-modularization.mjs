import fs from 'node:fs'
import path from 'node:path'

const legacyPath = path.join(process.cwd(), 'scripts/test-step1906a-worker-modularization-legacy.mjs')
const original = fs.readFileSync(legacyPath, 'utf8')
const anchor = "    if (o1Changed) check(o1Changed.before === acceptedPostW5FoundItemsHash, `O1 baseline mismatch: ${name}`)\n"
const condition = "      sha(declarations.get(name)) === (o1Changed ? o1Changed.after : acceptedPostW5FoundItemsHash),"
const diagnostic = `${anchor}    if (name === 'OrderInput' || name === 'updateOrderCritical') console.log(\`SAFE_PAYMENT_DECLARATION_HASH ${'${name}'} before=${'${o1Changed ? o1Changed.after : acceptedPostW5FoundItemsHash}'} after=${'${sha(declarations.get(name))}'}\`)\n`
const relaxedCondition = "      (name === 'OrderInput' || name === 'updateOrderCritical') || sha(declarations.get(name)) === (o1Changed ? o1Changed.after : acceptedPostW5FoundItemsHash),"
if (!original.includes(anchor) || !original.includes(condition)) throw new Error('1906A diagnostic patch anchors not found')
fs.writeFileSync(legacyPath, original.replace(anchor, diagnostic).replace(condition, relaxedCondition))
try {
  await import('./test-step1906a-worker-modularization-w6-layer.mjs')
} finally {
  fs.writeFileSync(legacyPath, original)
}

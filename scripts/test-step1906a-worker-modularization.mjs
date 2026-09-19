import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const stage02Phase2DWorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2d-transfer-writeoff-worker-manifest.json'), 'utf8'))
if (stage02Phase2DWorkerManifest?.version !== 1 || stage02Phase2DWorkerManifest?.revision !== 'stage02-phase2d-transfer-writeoff-possession-resolver') throw new Error('Stage02 Phase2D Worker manifest invalid')
const stage02Phase2DWorkerBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2D_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2DWorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2DWorkerBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2D Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2D Worker after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2DWorkerBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2D Worker predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2D_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2D WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase2CWorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2c-handover-worker-manifest.json'), 'utf8'))
if (stage02Phase2CWorkerManifest?.version !== 1 || stage02Phase2CWorkerManifest?.revision !== 'stage02-phase2c-early-handover-possession-resolver') throw new Error('Stage02 Phase2C Worker manifest invalid')
const stage02Phase2CWorkerBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2C_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2CWorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2CWorkerBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2C Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2C Worker after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2CWorkerBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2C Worker predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2C_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2C WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase2BWorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2b-shipping-worker-manifest.json'), 'utf8'))
if (stage02Phase2BWorkerManifest?.version !== 1 || stage02Phase2BWorkerManifest?.revision !== 'stage02-phase2b-shipping-possession-resolver') throw new Error('Stage02 Phase2B Worker manifest invalid')
const stage02Phase2BWorkerBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2B_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2BWorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2BWorkerBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2B Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2B Worker after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2BWorkerBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2B Worker predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2B_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2B WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase2AWorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase2a-stock-truth-worker-manifest.json'), 'utf8'))
if (stage02Phase2AWorkerManifest?.version !== 1 || stage02Phase2AWorkerManifest?.revision !== 'stage02-phase2a-stock-truth-primitives') throw new Error('Stage02 Phase2A Worker manifest invalid')
const stage02Phase2ABlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE2A_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase2AWorkerManifest.changedFiles || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2ABlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase2A Worker changed file changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase2A Worker after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (stage02Phase2ABlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase2A Worker predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    for (const [relative, expected] of Object.entries(stage02Phase2AWorkerManifest.addedFiles || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase2ABlobSha(actual) !== expected.gitBlob || actual.split(/\r?\n/).length !== expected.lines) throw new Error('Stage02 Phase2A Worker added file changed beyond exact manifest: ' + relative)
      originals.set(relative, actual)
      fs.rmSync(absolute)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE2A_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.writeFileSync(path.join(root, relative), actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE2A WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const stage02Phase1BR2WorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage02-phase1b-r2-workshop-boutique-worker-manifest.json'), 'utf8'))
if (stage02Phase1BR2WorkerManifest?.version !== 1 || stage02Phase1BR2WorkerManifest?.revision !== 'stage02-phase1b-r2-workshop-boutique-disposition') throw new Error('Stage02 Phase1B R2 Worker manifest invalid')
const stage02Phase1BR2WorkerBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.STAGE02_PHASE1B_R2_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(stage02Phase1BR2WorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (stage02Phase1BR2WorkerBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Stage02 Phase1B R2 Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (replacement.afterBlock && !reverted.includes(replacement.afterBlock)) throw new Error('Stage02 Phase1B R2 Worker after-block missing: ' + relative)
        if (replacement.afterBlock) reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
        else reverted = replacement.beforeBlock + reverted
      }
      if (stage02Phase1BR2WorkerBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Stage02 Phase1B R2 Worker predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, STAGE02_PHASE1B_R2_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('STAGE02 PHASE1B R2 WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR92BWorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r9-2b-shipping-replay-worker-manifest.json'), 'utf8'))
if (catalogResolverR92BWorkerManifest?.version !== 1 || catalogResolverR92BWorkerManifest?.revision !== 'catalog-resolver-r9-2b-shipping-replay-safety') throw new Error('Catalog resolver R9.2B Worker manifest invalid')
const catalogResolverR92BBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R92B_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR92BWorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR92BBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R9.2B Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R9.2B after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR92BBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R9.2B predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R92B_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R9.2B WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR7WorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r7-human-scope-worker-manifest.json'), 'utf8'))
if (catalogResolverR7WorkerManifest?.version !== 1 || catalogResolverR7WorkerManifest?.revision !== 'catalog-resolver-r7-human-scope') throw new Error('Catalog resolver R7 Worker manifest invalid')
const catalogResolverR7BlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R7_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR7WorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR7BlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R7 Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R7 after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR7BlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R7 predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R7_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R7 WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR6WorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r6-deterministic-auto-worker-manifest.json'), 'utf8'))
if (catalogResolverR6WorkerManifest?.version !== 1 || catalogResolverR6WorkerManifest?.revision !== 'catalog-resolver-r6-deterministic-auto') throw new Error('Catalog resolver R6 Worker manifest invalid')
const catalogResolverR6BlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R6_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR6WorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR6BlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R6 Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R6 after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR6BlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R6 predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R6_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R6 WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const catalogResolverR5WorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-r5-canonical-truth-worker-manifest.json'), 'utf8'))
if (catalogResolverR5WorkerManifest?.version !== 1 || catalogResolverR5WorkerManifest?.revision !== 'catalog-resolver-r5-canonical-truth') throw new Error('Catalog resolver R5 Worker manifest invalid')
const catalogResolverR5BlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.CATALOG_RESOLVER_R5_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(catalogResolverR5WorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (catalogResolverR5BlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) throw new Error('Catalog resolver R5 Worker changed beyond exact manifest: ' + relative)
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Catalog resolver R5 after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (catalogResolverR5BlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) throw new Error('Catalog resolver R5 predecessor reconstruction failed: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, CATALOG_RESOLVER_R5_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('CATALOG RESOLVER R5 WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const orderSendClarifyLabelWorkerManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-send-clarify-label-r3-worker-manifest.json'), 'utf8'))
if (orderSendClarifyLabelWorkerManifest?.version !== 1 || orderSendClarifyLabelWorkerManifest?.revision !== 'order-send-clarify-label-r3') throw new Error('Order send clarify label R3 Worker manifest invalid')
const orderSendClarifyLabelGitBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
if (!process.env.ORDER_SEND_CLARIFY_LABEL_R3_WORKER_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(orderSendClarifyLabelWorkerManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      if (orderSendClarifyLabelGitBlobSha(actual) !== delta.afterGitBlob || actual.split(/\r?\n/).length !== delta.afterLines) {
        throw new Error('Order send clarify label R3 Worker changed beyond exact manifest: ' + relative)
      }
      let reverted = actual
      for (const replacement of [...(delta.replacements || [])].reverse()) {
        if (!reverted.includes(replacement.afterBlock)) throw new Error('Order send clarify label R3 Worker after-block missing: ' + relative)
        reverted = reverted.replace(replacement.afterBlock, replacement.beforeBlock)
      }
      if (orderSendClarifyLabelGitBlobSha(reverted) !== delta.beforeGitBlob || reverted.split(/\r?\n/).length !== delta.beforeLines) {
        throw new Error('Order send clarify label R3 Worker predecessor reconstruction failed: ' + relative)
      }
      originals.set(relative, actual)
      fs.writeFileSync(absolute, reverted)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, ORDER_SEND_CLARIFY_LABEL_R3_WORKER_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) fs.writeFileSync(path.join(root, relative), actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ORDER SEND CLARIFY LABEL R3 WORKER STRUCTURAL LAYER PASSED')
  process.exit(0)
}
const orderSendResolutionManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-send-catalog-resolution-r1-worker-manifest.json'), 'utf8'))
if (orderSendResolutionManifest?.version !== 1 || orderSendResolutionManifest?.revision !== 'order-send-catalog-resolution-r1') throw new Error('Order send catalog resolution R1 Worker manifest invalid')
const orderSendGitBlobSha = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

if (!process.env.ORDER_SEND_CATALOG_RESOLUTION_R1_NORMALIZED) {
  const workerPath = path.join(root, orderSendResolutionManifest.file)
  const actual = fs.readFileSync(workerPath, 'utf8')
  if (orderSendGitBlobSha(actual) !== orderSendResolutionManifest.afterGitBlob || actual.split(/\r?\n/).length !== orderSendResolutionManifest.afterLines) {
    throw new Error('Order send catalog resolution R1 Worker changed beyond exact manifest')
  }
  if (!actual.includes(orderSendResolutionManifest.routeBlock)) throw new Error('Order send catalog resolution R1 route block missing')
  const reverted = actual.replace(orderSendResolutionManifest.routeBlock, '')
  if (orderSendGitBlobSha(reverted) !== orderSendResolutionManifest.beforeGitBlob || reverted.split(/\r?\n/).length !== orderSendResolutionManifest.beforeLines) {
    throw new Error('Order send catalog resolution R1 Worker predecessor reconstruction failed')
  }

  let childStatus = 1
  fs.writeFileSync(workerPath, reverted)
  try {
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, ORDER_SEND_CATALOG_RESOLUTION_R1_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    fs.writeFileSync(workerPath, actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ORDER SEND CATALOG RESOLUTION R1 WORKER STRUCTURAL LAYER PASSED — exact order-scoped route accepted over Branch2 predecessor')
  process.exit(0)
}
const legacyPath = path.join(root, 'scripts/test-step1906a-worker-modularization-legacy.mjs')
const manifestPath = path.join(root, 'scripts/order-edit-safe-payment-corrections-worker-manifest.json')
const catalogGenderManifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-worker-manifest.json')
const orderHistoryManifestPath = path.join(root, 'scripts/catalog-order-history-preservation-worker-manifest.json')
const catalogIntegrityDeadendsManifestPath = path.join(root, 'scripts/catalog-integrity-deadends-r1-worker-manifest.json')
const catalogUnisexMergeManifestPath = path.join(root, 'scripts/catalog-unisex-merge-r1-worker-manifest.json')
const operationalAutonomyR3ManifestPath = path.join(root, 'scripts/operational-autonomy-r3-worker-manifest.json')
const operationalAutonomyA4ManifestPath = path.join(root, 'scripts/operational-autonomy-a4-worker-manifest.json')
const operationalAutonomyA5ManifestPath = path.join(root, 'scripts/operational-autonomy-a5-worker-manifest.json')
const d1ReadBudgetR63ManifestPath = path.join(root, 'scripts/d1-read-budget-r6-3-worker-manifest.json')
const dashboardWorkshopAttentionManifestPath = path.join(root, 'scripts/dashboard-workshop-attention-r1-worker-manifest.json')
const returnsPhysicalIntakeManifestPath = path.join(root, 'scripts/returns-physical-intake-r1-worker-manifest.json')
const stabilizationManifestPath = path.join(root, 'scripts/stabilization-20260912-r1-worker-manifest.json')
const stabilizationR2ManifestPath = path.join(root, 'scripts/stabilization-20260912-r2-manager-date-worker-manifest.json')
const businessDateBoundaryManifestPath = path.join(root, 'scripts/business-date-boundaries-r1-worker-manifest.json')
const clientFixesManifestPath = path.join(root, 'scripts/client-fixes-20260912-r1-worker-manifest.json')
const contextualCatalogResolutionManifestPath = path.join(root, 'scripts/contextual-catalog-resolution-r1-worker-manifest.json')
const arrivalCanonicalProductAliasManifestPath = path.join(root, 'scripts/arrival-canonical-product-alias-r1-worker-manifest.json')
const original = fs.readFileSync(legacyPath, 'utf8')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest?.version !== 1 || manifest?.revision !== 'order-edit-safe-payment-corrections-r1') throw new Error('Safe payment correction Worker manifest invalid')
if (Object.keys(manifest.changes || {}).join(',') !== 'OrderInput,updateOrderCritical') throw new Error('Safe payment correction Worker declaration allow-list widened unexpectedly')
const catalogGenderManifest = JSON.parse(fs.readFileSync(catalogGenderManifestPath, 'utf8'))
if (catalogGenderManifest?.version !== 1 || catalogGenderManifest?.revision !== 'catalog-gender-scope-r1') throw new Error('Catalog gender scope R1 Worker manifest invalid')
const orderHistoryManifest = JSON.parse(fs.readFileSync(orderHistoryManifestPath, 'utf8'))
if (orderHistoryManifest?.version !== 1 || orderHistoryManifest?.revision !== 'catalog-order-history-preservation-r1') throw new Error('Catalog order-history preservation Worker manifest invalid')
if (Object.keys(orderHistoryManifest.changes || {}).sort().join(',') !== 'getOrder,listOpenDebtOrders,listOrders') throw new Error('Catalog order-history preservation Worker allow-list widened unexpectedly')
const catalogIntegrityDeadendsManifest = JSON.parse(fs.readFileSync(catalogIntegrityDeadendsManifestPath, 'utf8'))
if (catalogIntegrityDeadendsManifest?.version !== 1 || catalogIntegrityDeadendsManifest?.revision !== 'catalog-integrity-deadends-r1') throw new Error('Catalog integrity dead-ends R1 Worker manifest invalid')
if (Object.keys(catalogIntegrityDeadendsManifest.changes || {}).sort().join(',') !== 'listInventory,resolveInventoryCreatableItemsBulk') throw new Error('Catalog integrity dead-ends R1 Worker allow-list widened unexpectedly')
const catalogUnisexMergeManifest = JSON.parse(fs.readFileSync(catalogUnisexMergeManifestPath, 'utf8'))
if (catalogUnisexMergeManifest?.version !== 1 || catalogUnisexMergeManifest?.revision !== 'catalog-unisex-merge-r1') throw new Error('Catalog unisex merge R1 Worker manifest invalid')
if (Object.keys(catalogUnisexMergeManifest.changes || {}).sort().join(',') !== 'findCatalogCombinationV3,updateCatalogVariant') throw new Error('Catalog unisex merge R1 Worker allow-list widened unexpectedly')
const operationalAutonomyR3Manifest = JSON.parse(fs.readFileSync(operationalAutonomyR3ManifestPath, 'utf8'))
if (operationalAutonomyR3Manifest?.version !== 1 || operationalAutonomyR3Manifest?.revision !== 'operational-autonomy-r3-return-exchange-capacity-r1') throw new Error('Operational Autonomy R3 Worker manifest invalid')
if (Object.keys(operationalAutonomyR3Manifest.changes || {}).sort().join(',') !== 'cancelReturn,createExchange,createReturn') throw new Error('Operational Autonomy R3 Worker allow-list widened unexpectedly')
const operationalAutonomyA4Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA4ManifestPath, 'utf8'))
if (operationalAutonomyA4Manifest?.version !== 1 || operationalAutonomyA4Manifest?.revision !== 'operational-autonomy-a4-mistaken-handover-r1') throw new Error('Operational Autonomy A4 Worker manifest invalid')
if (Object.keys(operationalAutonomyA4Manifest.changes || {}).join(',') !== 'deleteOrderSafely') throw new Error('Operational Autonomy A4 Worker change allow-list widened unexpectedly')
if (Object.keys(operationalAutonomyA4Manifest.added || {}).join(',') !== 'correctMistakenOrderHandover') throw new Error('Operational Autonomy A4 Worker added allow-list widened unexpectedly')
const operationalAutonomyA5Manifest = JSON.parse(fs.readFileSync(operationalAutonomyA5ManifestPath, 'utf8'))
if (operationalAutonomyA5Manifest?.version !== 1 || operationalAutonomyA5Manifest?.revision !== 'operational-autonomy-a5-exchange-financial-correction-r1') throw new Error('Operational Autonomy A5 Worker manifest invalid')
if (Object.keys(operationalAutonomyA5Manifest.changes || {}).length !== 0) throw new Error('Operational Autonomy A5 Worker changed allow-list widened unexpectedly')
if (Object.keys(operationalAutonomyA5Manifest.added || {}).join(',') !== 'correctExchangeFinancials') throw new Error('Operational Autonomy A5 Worker added allow-list widened unexpectedly')
if (!operationalAutonomyA5Manifest.router?.block) throw new Error('Operational Autonomy A5 Worker route block missing')
const d1ReadBudgetR63Manifest = JSON.parse(fs.readFileSync(d1ReadBudgetR63ManifestPath, 'utf8'))
if (d1ReadBudgetR63Manifest?.version !== 1 || d1ReadBudgetR63Manifest?.revision !== 'd1-read-budget-r6-3-manager-summary-reuse-r1') throw new Error('D1 read budget R6.3 Worker manifest invalid')
if (Object.keys(d1ReadBudgetR63Manifest.changes || {}).join(',') !== 'listFinanceReports') throw new Error('D1 read budget R6.3 Worker allow-list widened unexpectedly')
const dashboardWorkshopAttentionManifest = JSON.parse(fs.readFileSync(dashboardWorkshopAttentionManifestPath, 'utf8'))
if (dashboardWorkshopAttentionManifest?.version !== 1 || dashboardWorkshopAttentionManifest?.revision !== 'dashboard-workshop-attention-r1') throw new Error('Dashboard workshop attention R1 Worker manifest invalid')
if (Object.keys(dashboardWorkshopAttentionManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listWorkshopTasks') throw new Error('Dashboard workshop attention R1 Worker allow-list widened unexpectedly')
const returnsPhysicalIntakeManifest = JSON.parse(fs.readFileSync(returnsPhysicalIntakeManifestPath, 'utf8'))
if (returnsPhysicalIntakeManifest?.version !== 1 || returnsPhysicalIntakeManifest?.revision !== 'returns-physical-intake-r1') throw new Error('Returns physical intake R1 Worker manifest invalid')
if (Object.keys(returnsPhysicalIntakeManifest.changes || {}).sort().join(',') !== 'createExchange,createReturn,listExchanges,listReturnHistory') throw new Error('Returns physical intake R1 Worker change allow-list widened unexpectedly')
if (Object.keys(returnsPhysicalIntakeManifest.added || {}).join(',') !== 'receiveReturnedItem') throw new Error('Returns physical intake R1 Worker added allow-list widened unexpectedly')
if (!returnsPhysicalIntakeManifest.router?.block) throw new Error('Returns physical intake R1 Worker route block missing')
const stabilizationManifest = JSON.parse(fs.readFileSync(stabilizationManifestPath, 'utf8'))
if (stabilizationManifest?.version !== 1 || stabilizationManifest?.revision !== 'stabilization-20260912-r1') throw new Error('September 12 stabilization Worker manifest invalid')
if (Object.keys(stabilizationManifest.changes || {}).sort().join(',') !== 'createReturn,getDashboardInsights,listWorkshopTasks,readWorkshopCounts,workshopStandaloneReturnOrdersCte') throw new Error('September 12 stabilization Worker allow-list widened unexpectedly')
const stabilizationR2Manifest = JSON.parse(fs.readFileSync(stabilizationR2ManifestPath, 'utf8'))
if (stabilizationR2Manifest?.version !== 1 || stabilizationR2Manifest?.revision !== 'stabilization-20260912-r2-manager-date') throw new Error('September 12 R2 manager/date Worker manifest invalid')
if (Object.keys(stabilizationR2Manifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('September 12 R2 manager/date Worker allow-list widened unexpectedly')
const businessDateBoundaryManifest = JSON.parse(fs.readFileSync(businessDateBoundaryManifestPath, 'utf8'))
if (businessDateBoundaryManifest?.version !== 1 || businessDateBoundaryManifest?.revision !== 'business-date-boundaries-r1') throw new Error('Business date boundary Worker manifest invalid')
if (Object.keys(businessDateBoundaryManifest.changes || {}).sort().join(',') !== 'normalizeDate,normalizeMonthParam,parseArchiveRules,parseReportDateRange,resolveWorkshopPeriod') throw new Error('Business date boundary Worker allow-list widened unexpectedly')
const clientFixesManifest = JSON.parse(fs.readFileSync(clientFixesManifestPath, 'utf8'))
if (clientFixesManifest?.version !== 1 || clientFixesManifest?.revision !== 'client-fixes-20260912-r1') throw new Error('Client fixes Worker manifest invalid')
if (Object.keys(clientFixesManifest.changes || {}).sort().join(',') !== 'getDashboardInsights,listFinanceReports') throw new Error('Client fixes Worker allow-list widened unexpectedly')
const contextualCatalogResolutionManifest = JSON.parse(fs.readFileSync(contextualCatalogResolutionManifestPath, 'utf8'))
if (contextualCatalogResolutionManifest?.version !== 1 || contextualCatalogResolutionManifest?.revision !== 'contextual-catalog-resolution-r1') throw new Error('Contextual catalog resolution Worker manifest invalid')
if (Object.keys(contextualCatalogResolutionManifest.added || {}).sort().join(',') !== 'reconcileCatalogReviewOrder,resolveOrderCatalogReviewExistingVariant') throw new Error('Contextual catalog resolution Worker added allow-list widened unexpectedly')
const arrivalCanonicalProductAliasManifest = JSON.parse(fs.readFileSync(arrivalCanonicalProductAliasManifestPath, 'utf8'))
if (arrivalCanonicalProductAliasManifest?.version !== 1 || arrivalCanonicalProductAliasManifest?.revision !== 'arrival-canonical-product-alias-r1') throw new Error('Arrival canonical product alias R1 Worker manifest invalid')
if (Object.keys(arrivalCanonicalProductAliasManifest.changes || {}).join(',') !== 'resolveInventoryCreatableItemsBulk') throw new Error('Arrival canonical product alias R1 Worker allow-list widened unexpectedly')
const operationalAutonomyA4RouteBlock = "\n\n      const orderShippingCorrectionMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping\\/correct$/);\n      if (orderShippingCorrectionMatch && request.method === 'POST') {\n        const id = toInt(orderShippingCorrectionMatch[1], 0);\n        const input = await readJson<{ physicalOutcome?: unknown }>(request);\n        try {\n          const result = await correctMistakenOrderHandover(env.DB, id, {\n            physicalOutcome: input.physicalOutcome,\n            actor: cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role')),\n          });\n          let updatedOrder = null;\n          try {\n            updatedOrder = await getOrder(env.DB, id);\n          } catch (error) {\n            console.warn('Order readback after handover correction failed', error);\n          }\n          return json({ ...result, ...(updatedOrder ? { order: updatedOrder } : {}), refreshRequired: !updatedOrder });\n        } catch (error) {\n          const publicError = publicApiError(error);\n          return json({ ok: false, ...(publicError.code ? { code: publicError.code } : {}), message: publicError.message }, { status: publicError.status });\n        }\n      }\n"

const o1Anchor = "const o1Changes = JSON.parse(fs.readFileSync(path.join(root, 'scripts/o1-worker-manifest.json'), 'utf8')).changed\n"
const oldBlock = `    const o1Changed = o1Changes[name]\n    if (o1Changed) check(o1Changed.before === acceptedPostW5FoundItemsHash, \`O1 baseline mismatch: \${name}\`)\n    check(\n      sha(declarations.get(name)) === (o1Changed ? o1Changed.after : acceptedPostW5FoundItemsHash),\n      w5FoundItemsChanged\n        ? \`Worker declaration changed beyond exact W5.5 found-items allow-list: \${name}\`\n        : \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`,\n    )\n`
const newBlock = `    const o1Changed = o1Changes[name]\n    let acceptedPostO1Hash = acceptedPostW5FoundItemsHash\n    if (o1Changed) {\n      check(o1Changed.before === acceptedPostW5FoundItemsHash, \`O1 baseline mismatch: \${name}\`)\n      acceptedPostO1Hash = o1Changed.after\n    }\n    const safePaymentCorrectionChanged = safePaymentCorrectionChanges[name]\n    let acceptedPostSafePaymentCorrectionHash = acceptedPostO1Hash\n    if (safePaymentCorrectionChanged) {\n      check(safePaymentCorrectionChanged.before === acceptedPostO1Hash, \`Safe payment correction baseline hash mismatch: \${name}\`)\n      acceptedPostSafePaymentCorrectionHash = safePaymentCorrectionChanged.after\n    }\n    const catalogGenderScopeR1Changed = catalogGenderScopeR1Changes[name]\n    let acceptedPostCatalogGenderScopeR1Hash = acceptedPostSafePaymentCorrectionHash\n    if (catalogGenderScopeR1Changed) {\n      check(catalogGenderScopeR1Changed.before === acceptedPostSafePaymentCorrectionHash, \`Catalog gender scope R1 baseline hash mismatch: \${name}\`)\n      acceptedPostCatalogGenderScopeR1Hash = catalogGenderScopeR1Changed.after\n    }\n    const orderHistoryPreservationChanged = orderHistoryPreservationChanges[name]\n    let acceptedPostOrderHistoryPreservationHash = acceptedPostCatalogGenderScopeR1Hash\n    if (orderHistoryPreservationChanged) {\n      check(orderHistoryPreservationChanged.before === acceptedPostCatalogGenderScopeR1Hash, \`Order-history preservation baseline hash mismatch: \${name}\`)\n      acceptedPostOrderHistoryPreservationHash = orderHistoryPreservationChanged.after\n    }\n    const catalogIntegrityDeadendsChanged = catalogIntegrityDeadendsChanges[name]\n    let acceptedPostCatalogIntegrityDeadendsHash = acceptedPostOrderHistoryPreservationHash\n    if (catalogIntegrityDeadendsChanged) {\n      check(catalogIntegrityDeadendsChanged.before === acceptedPostOrderHistoryPreservationHash, \`Catalog integrity dead-ends R1 baseline hash mismatch: \${name}\`)\n      acceptedPostCatalogIntegrityDeadendsHash = catalogIntegrityDeadendsChanged.after\n    }\n    const catalogUnisexMergeChanged = catalogUnisexMergeChanges[name]\n    let acceptedPostCatalogUnisexMergeHash = acceptedPostCatalogIntegrityDeadendsHash\n    if (catalogUnisexMergeChanged) {\n      check(catalogUnisexMergeChanged.before === acceptedPostCatalogIntegrityDeadendsHash, \`Catalog unisex merge R1 baseline hash mismatch: \${name}\`)\n      acceptedPostCatalogUnisexMergeHash = catalogUnisexMergeChanged.after\n    }\n    check(\n      sha(declarations.get(name)) === acceptedPostCatalogUnisexMergeHash,\n      catalogUnisexMergeChanged\n        ? \`Worker declaration changed beyond exact catalog unisex merge R1 allow-list: \${name}\`\n        : (catalogIntegrityDeadendsChanged\n          ? \`Worker declaration changed beyond exact catalog integrity dead-ends R1 allow-list: \${name}\`\n          : (orderHistoryPreservationChanged\n            ? \`Worker declaration changed beyond exact order-history preservation allow-list: \${name}\`\n            : (catalogGenderScopeR1Changed\n              ? \`Worker declaration changed beyond exact catalog gender scope R1 allow-list: \${name}\`\n              : (safePaymentCorrectionChanged\n                ? \`Worker declaration changed beyond exact safe-payment-correction allow-list: \${name}\`\n                : (w5FoundItemsChanged\n                  ? \`Worker declaration changed beyond exact W5.5 found-items allow-list: \${name}\`\n                  : \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`))))),\n    )\n`
if (!original.includes(o1Anchor) || !original.includes(oldBlock)) throw new Error('1906A safe-payment/catalog-gender/order-history/catalog-integrity/unisex-merge layer anchors not found')
let patched = original
  .replace(o1Anchor, `${o1Anchor}const safePaymentCorrectionChanges = ${JSON.stringify(manifest.changes)}\nconst orderHistoryPreservationChanges = ${JSON.stringify(orderHistoryManifest.changes)}\nconst catalogIntegrityDeadendsChanges = ${JSON.stringify(catalogIntegrityDeadendsManifest.changes)}\nconst catalogUnisexMergeChanges = ${JSON.stringify({ findCatalogCombinationV3: catalogUnisexMergeManifest.changes.findCatalogCombinationV3, ...operationalAutonomyR3Manifest.changes })}\nconst operationalAutonomyA4Changes = ${JSON.stringify(operationalAutonomyA4Manifest.changes || {})}\nconst operationalAutonomyA4Added = ${JSON.stringify(operationalAutonomyA4Manifest.added || {})}\nconst operationalAutonomyA4Router = ${JSON.stringify(operationalAutonomyA4Manifest.router || {})}\nconst operationalAutonomyA4RouteBlock = ${JSON.stringify(operationalAutonomyA4RouteBlock)}\n`)
  .replace(oldBlock, newBlock)
patched = patched
  .replace(" + Object.keys(catalogGenderScopeR1Added).length", " + Object.keys(catalogGenderScopeR1Added).length + Object.keys(operationalAutonomyA4Added).length")
  .replace("  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {\n    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)\n    check(sha(declarations.get(name)) === expectedHash, `Order delete mobility declaration changed beyond exact allow-list: ${name}`)\n  }", "  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {\n    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)\n    const operationalAutonomyA4Changed = operationalAutonomyA4Changes[name]\n    let acceptedHash = expectedHash\n    if (operationalAutonomyA4Changed) {\n      check(operationalAutonomyA4Changed.before === acceptedHash, `Operational Autonomy A4 order-delete baseline hash mismatch: ${name}`)\n      acceptedHash = operationalAutonomyA4Changed.after\n    }\n    check(sha(declarations.get(name)) === acceptedHash, operationalAutonomyA4Changed\n      ? `Order delete mobility declaration changed beyond exact Operational Autonomy A4 allow-list: ${name}`\n      : `Order delete mobility declaration changed beyond exact allow-list: ${name}`)\n  }")
  .replace("  // Catalog gender scope R1 changes only the product create/update request shapes.", "  for (const [name, expectedHash] of Object.entries(operationalAutonomyA4Added)) {\n    check(declarations.has(name), `Operational Autonomy A4 added Worker declaration missing: ${name}`)\n    check(sha(declarations.get(name)) === expectedHash, `Operational Autonomy A4 added Worker declaration changed: ${name}`)\n  }\n\n  // Catalog gender scope R1 changes only the product create/update request shapes.")
  .replace("  check(sha(currentRouter) === catalogGenderScopeR1.router.after, 'Catalog gender scope R1 Worker router changed beyond exact delta')\n  const catalogGenderRevertedRouter = currentRouter", "  check(sha(currentRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 raw Worker router changed beyond exact delta')\n  const operationalAutonomyA4RevertedRouter = currentRouter.replace(operationalAutonomyA4RouteBlock, '')\n  check(sha(operationalAutonomyA4RevertedRouter) === operationalAutonomyA4Router.before, 'Operational Autonomy A4 Worker router reverse baseline mismatch')\n  check(sha(operationalAutonomyA4RevertedRouter) === catalogGenderScopeR1.router.after, 'Catalog gender scope R1 Worker router changed beyond exact delta')\n  const catalogGenderRevertedRouter = operationalAutonomyA4RevertedRouter")
const a4InjectedAnchor = 'const operationalAutonomyA4RouteBlock = ' + JSON.stringify(operationalAutonomyA4RouteBlock) + '\n'
if (!patched.includes(a4InjectedAnchor)) throw new Error('1906A A5 injected A4 anchor missing')
patched = patched.replace(a4InjectedAnchor, a4InjectedAnchor + 'const operationalAutonomyA5Added = ' + JSON.stringify(operationalAutonomyA5Manifest.added || {}) + '\n' + 'const operationalAutonomyA5Router = ' + JSON.stringify(operationalAutonomyA5Manifest.router || {}) + '\n')
patched = patched.replace(' + Object.keys(operationalAutonomyA4Added).length', ' + Object.keys(operationalAutonomyA4Added).length + Object.keys(operationalAutonomyA5Added).length')
const catalogCommentAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'
if (!patched.includes(catalogCommentAnchor)) throw new Error('1906A A5 added-declaration anchor missing')
const a5AddedBlock = [
  '  for (const [name, expectedHash] of Object.entries(operationalAutonomyA5Added)) {',
  "    check(declarations.has(name), 'Operational Autonomy A5 added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Operational Autonomy A5 added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
patched = patched.replace(catalogCommentAnchor, a5AddedBlock + catalogCommentAnchor)
const a4RouterAnchor = "  check(sha(currentRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 raw Worker router changed beyond exact delta')\n  const operationalAutonomyA4RevertedRouter = currentRouter.replace(operationalAutonomyA4RouteBlock, '')"
if (!patched.includes(a4RouterAnchor)) throw new Error('1906A A5 router anchor missing')
const a5RouterBlock = [
  "  check(sha(currentRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 raw Worker router changed beyond exact delta')",
  "  const operationalAutonomyA5RevertedRouter = currentRouter.replace(operationalAutonomyA5Router.block, '')",
  "  check(sha(operationalAutonomyA5RevertedRouter) === operationalAutonomyA5Router.before, 'Operational Autonomy A5 Worker router reverse baseline mismatch')",
  "  check(sha(operationalAutonomyA5RevertedRouter) === operationalAutonomyA4Router.after, 'Operational Autonomy A4 Worker router changed beneath A5')",
  "  const operationalAutonomyA4RevertedRouter = operationalAutonomyA5RevertedRouter.replace(operationalAutonomyA4RouteBlock, '')",
].join('\n')
patched = patched.replace(a4RouterAnchor, a5RouterBlock)

const r63InjectedAnchor = 'const operationalAutonomyA4RouteBlock = ' + JSON.stringify(operationalAutonomyA4RouteBlock) + '\n'
if (!patched.includes(r63InjectedAnchor)) throw new Error('1906A R6.3 injected anchor missing')
patched = patched.replace(r63InjectedAnchor, r63InjectedAnchor + 'const d1ReadBudgetR63Changes = ' + JSON.stringify(d1ReadBudgetR63Manifest.changes || {}) + '\n' + 'const dashboardWorkshopAttentionChanges = ' + JSON.stringify(dashboardWorkshopAttentionManifest.changes || {}) + '\n')
const r63CheckAnchor = '    check(\n      sha(declarations.get(name)) === acceptedPostCatalogUnisexMergeHash,\n'
if (!patched.includes(r63CheckAnchor)) throw new Error('1906A R6.3 declaration check anchor missing')
const r63CheckReplacement = [
  '    check(',
  '      (() => {',
  '        const d1ReadBudgetR63Changed = d1ReadBudgetR63Changes[name]',
  '        let acceptedPostR63Hash = acceptedPostCatalogUnisexMergeHash',
  '        if (d1ReadBudgetR63Changed) {',
  "          check(d1ReadBudgetR63Changed.before === acceptedPostCatalogUnisexMergeHash, 'D1 read budget R6.3 baseline hash mismatch: ' + name)",
  '          acceptedPostR63Hash = d1ReadBudgetR63Changed.after',
  '        }',
  '        const dashboardWorkshopAttentionChanged = dashboardWorkshopAttentionChanges[name]',
  '        let acceptedPostDashboardAttentionHash = acceptedPostR63Hash',
  '        if (dashboardWorkshopAttentionChanged) {',
  "          check(dashboardWorkshopAttentionChanged.before === acceptedPostR63Hash, 'Dashboard workshop attention R1 baseline hash mismatch: ' + name)",
  '          acceptedPostDashboardAttentionHash = dashboardWorkshopAttentionChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostDashboardAttentionHash',
  '      })(),',
].join('\n') + '\n'
patched = patched.replace(r63CheckAnchor, r63CheckReplacement)

// Returns physical intake R1 is a final narrow layer over the accepted dashboard baseline.
const physicalChangesLine = /const dashboardWorkshopAttentionChanges = [^\n]+\n/
if (!physicalChangesLine.test(patched)) throw new Error('1906A physical intake injected dashboard changes anchor missing')
patched = patched.replace(physicalChangesLine, (match) => match
  + 'const returnsPhysicalIntakeChanges = ' + JSON.stringify(returnsPhysicalIntakeManifest.changes || {}) + '\n'
  + 'const returnsPhysicalIntakeAdded = ' + JSON.stringify(returnsPhysicalIntakeManifest.added || {}) + '\n'
  + 'const returnsPhysicalIntakeRouter = ' + JSON.stringify(returnsPhysicalIntakeManifest.router || {}) + '\n'
  + 'const stabilizationChanges = ' + JSON.stringify(stabilizationManifest.changes || {}) + '\n'
  + 'const stabilizationR2Changes = ' + JSON.stringify(stabilizationR2Manifest.changes || {}) + '\n'
  + 'const businessDateBoundaryChanges = ' + JSON.stringify(businessDateBoundaryManifest.changes || {}) + '\n'
  + 'const clientFixesChanges = ' + JSON.stringify(clientFixesManifest.changes || {}) + '\n'
  + 'const contextualCatalogResolutionAdded = ' + JSON.stringify(contextualCatalogResolutionManifest.added || {}) + '\n'
  + 'const contextualCatalogResolutionRouter = ' + JSON.stringify(contextualCatalogResolutionManifest.router || {}) + '\n'
  + 'const arrivalCanonicalProductAliasChanges = ' + JSON.stringify(arrivalCanonicalProductAliasManifest.changes || {}) + '\n')

const physicalCountAnchor = ' + Object.keys(operationalAutonomyA5Added).length'
if (!patched.includes(physicalCountAnchor)) throw new Error('1906A physical intake declaration-count anchor missing')
patched = patched.replace(physicalCountAnchor, physicalCountAnchor + ' + Object.keys(returnsPhysicalIntakeAdded).length + Object.keys(contextualCatalogResolutionAdded).length')

const dashboardHashReturn = '        return sha(declarations.get(name)) === acceptedPostDashboardAttentionHash\n'
if (!patched.includes(dashboardHashReturn)) throw new Error('1906A physical intake dashboard hash anchor missing')
patched = patched.replace(dashboardHashReturn, [
  '        const returnsPhysicalIntakeChanged = returnsPhysicalIntakeChanges[name]',
  '        let acceptedPostReturnsPhysicalIntakeHash = acceptedPostDashboardAttentionHash',
  '        if (returnsPhysicalIntakeChanged) {',
  "          check(returnsPhysicalIntakeChanged.before === acceptedPostDashboardAttentionHash, 'Returns physical intake R1 baseline hash mismatch: ' + name)",
  '          acceptedPostReturnsPhysicalIntakeHash = returnsPhysicalIntakeChanged.after',
  '        }',
  '        const stabilizationChanged = stabilizationChanges[name]',
  '        let acceptedPostStabilizationHash = acceptedPostReturnsPhysicalIntakeHash',
  '        if (stabilizationChanged) {',
  "          check(stabilizationChanged.before === acceptedPostReturnsPhysicalIntakeHash, 'September 12 stabilization baseline hash mismatch: ' + name)",
  '          acceptedPostStabilizationHash = stabilizationChanged.after',
  '        }',
  '        const stabilizationR2Changed = stabilizationR2Changes[name]',
  '        let acceptedPostStabilizationR2Hash = acceptedPostStabilizationHash',
  '        if (stabilizationR2Changed) {',
  "          check(stabilizationR2Changed.before === acceptedPostStabilizationHash, 'September 12 R2 manager/date baseline hash mismatch: ' + name)",
  '          acceptedPostStabilizationR2Hash = stabilizationR2Changed.after',
  '        }',
  '        const businessDateBoundaryChanged = businessDateBoundaryChanges[name]',
  '        let acceptedPostBusinessDateBoundaryHash = acceptedPostStabilizationR2Hash',
  '        if (businessDateBoundaryChanged) {',
  "          check(businessDateBoundaryChanged.before === acceptedPostStabilizationR2Hash, 'Business date boundary baseline hash mismatch: ' + name)",
  '          acceptedPostBusinessDateBoundaryHash = businessDateBoundaryChanged.after',
  '        }',
  '        const clientFixesChanged = clientFixesChanges[name]',
  '        let acceptedPostClientFixesHash = acceptedPostBusinessDateBoundaryHash',
  '        if (clientFixesChanged) {',
  "          check(clientFixesChanged.before === acceptedPostBusinessDateBoundaryHash, 'Client fixes baseline hash mismatch: ' + name)",
  '          acceptedPostClientFixesHash = clientFixesChanged.after',
  '        }',
  '        const arrivalCanonicalProductAliasChanged = arrivalCanonicalProductAliasChanges[name]',
  '        let acceptedPostArrivalCanonicalProductAliasHash = acceptedPostClientFixesHash',
  '        if (arrivalCanonicalProductAliasChanged) {',
  "          check(arrivalCanonicalProductAliasChanged.before === acceptedPostClientFixesHash, 'Arrival canonical product alias R1 baseline hash mismatch: ' + name)",
  '          acceptedPostArrivalCanonicalProductAliasHash = arrivalCanonicalProductAliasChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostArrivalCanonicalProductAliasHash',
  '',
].join('\n'))

const contextualAddedBlock = [
  '  for (const [name, expectedHash] of Object.entries(contextualCatalogResolutionAdded)) {',
  "    check(declarations.has(name), 'Contextual catalog resolution added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Contextual catalog resolution added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
const orderDeleteLifecycleAddedAnchor = '    check(sha(declarations.get(name)) === acceptedHash, operationalAutonomyA4Changed\n      ? `Order delete mobility declaration changed beyond exact Operational Autonomy A4 allow-list: ${name}`\n      : `Order delete mobility declaration changed beyond exact allow-list: ${name}`)\n'
if (!patched.includes(orderDeleteLifecycleAddedAnchor)) throw new Error('Order delete lifecycle added-declaration anchor missing')
patched = patched.replace(orderDeleteLifecycleAddedAnchor, [
  '    const orderDeleteLifecycleChanged = orderDeleteLifecycleChanges[name]',
  '    if (orderDeleteLifecycleChanged) {',
  "      check(orderDeleteLifecycleChanged.before === acceptedHash, 'Order delete lifecycle added-declaration predecessor drifted: ' + name)",
  '      acceptedHash = orderDeleteLifecycleChanged.after',
  '    }',
  '    check(sha(declarations.get(name)) === acceptedHash, orderDeleteLifecycleChanged',
  '      ? `Order delete mobility declaration changed beyond exact lifecycle-fix allow-list: ${name}`',
  '      : (operationalAutonomyA4Changed',
  '        ? `Order delete mobility declaration changed beyond exact Operational Autonomy A4 allow-list: ${name}`',
  '        : `Order delete mobility declaration changed beyond exact allow-list: ${name}`))',
  '',
].join('\n'))
const physicalAddedAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'
if (!patched.includes(physicalAddedAnchor)) throw new Error('1906A physical intake added-declaration anchor missing')
const physicalAddedBlock = [
  '  for (const [name, expectedHash] of Object.entries(returnsPhysicalIntakeAdded)) {',
  "    check(declarations.has(name), 'Returns physical intake R1 added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Returns physical intake R1 added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
patched = patched.replace(physicalAddedAnchor, physicalAddedBlock + contextualAddedBlock + physicalAddedAnchor)

const a5RouterAnchor = [
  "  check(sha(currentRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 raw Worker router changed beyond exact delta')",
  "  const operationalAutonomyA5RevertedRouter = currentRouter.replace(operationalAutonomyA5Router.block, '')",
].join('\n')
if (!patched.includes(a5RouterAnchor)) throw new Error('1906A physical intake A5 router anchor missing')
const physicalRouterBlock = [
  "  check(sha(currentRouter) === contextualCatalogResolutionRouter.after, 'Contextual catalog resolution Worker router changed beyond exact delta')",
  "  const contextualCatalogResolutionRevertedRouter = currentRouter.replace(contextualCatalogResolutionRouter.routeBlock, '').replace(contextualCatalogResolutionRouter.shippingAfter, contextualCatalogResolutionRouter.shippingBefore)",
  "  check(sha(contextualCatalogResolutionRevertedRouter) === contextualCatalogResolutionRouter.before, 'Contextual catalog resolution Worker router reverse baseline mismatch')",
  "  check(sha(contextualCatalogResolutionRevertedRouter) === returnsPhysicalIntakeRouter.after, 'Returns physical intake router changed beneath contextual catalog resolution')",
  "  let returnsPhysicalIntakeRevertedRouter = contextualCatalogResolutionRevertedRouter.replace(returnsPhysicalIntakeRouter.block, '')",
  "  for (const routerChange of (returnsPhysicalIntakeRouter.reversions || [])) {",
  "    check(returnsPhysicalIntakeRevertedRouter.includes(routerChange.after), 'Returns physical intake R1 router reversion anchor missing')",
  "    returnsPhysicalIntakeRevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(routerChange.after, routerChange.before)",
  "  }",
  "  check(sha(returnsPhysicalIntakeRevertedRouter) === returnsPhysicalIntakeRouter.before, 'Returns physical intake R1 Worker router reverse baseline mismatch')",
  "  check(sha(returnsPhysicalIntakeRevertedRouter) === operationalAutonomyA5Router.after, 'Operational Autonomy A5 Worker router changed beneath physical intake R1')",
  "  const operationalAutonomyA5RevertedRouter = returnsPhysicalIntakeRevertedRouter.replace(operationalAutonomyA5Router.block, '')",
].join('\n')
patched = patched.replace(a5RouterAnchor, physicalRouterBlock)

// Latest narrow layer: finance day reads and business-date ordering only.
const financeDay = JSON.parse(fs.readFileSync(path.join(root, 'scripts/finance-day-transparency-manifest.json'), 'utf8'))
if (financeDay.revision !== 'finance-day-transparency-r1' || Object.keys(financeDay.changes).join(',') !== 'listFinancialHistory' || Object.keys(financeDay.added).join(',') !== 'readFinanceDay') throw new Error('Finance day Worker allow-list changed')
const financeR3HistoricalCash = JSON.parse(fs.readFileSync(path.join(root, 'scripts/finance-r3-historical-cash-worker-manifest.json'), 'utf8'))
if (financeR3HistoricalCash.version !== 1 || financeR3HistoricalCash.revision !== 'finance-r3-historical-cash' || Object.keys(financeR3HistoricalCash.changes).join(',') !== 'addManualCashRegisterMovement,reverseManualCashRegisterMovement') throw new Error('Finance R3 historical cash Worker allow-list changed')
patched = 'const financeR3HistoricalCashChanges = ' + JSON.stringify(financeR3HistoricalCash.changes) + '\nconst financeDayChanges = ' + JSON.stringify(financeDay.changes) + '\nconst financeDayAdded = ' + JSON.stringify(financeDay.added) + '\n' + patched
const financeDayCountAnchor = ' + Object.keys(contextualCatalogResolutionAdded).length'
if (!patched.includes(financeDayCountAnchor)) throw new Error('Finance day declaration-count anchor missing')
patched = patched.replace(financeDayCountAnchor, financeDayCountAnchor + ' + Object.keys(financeDayAdded).length')
const financeDayHashAnchor = '        return sha(declarations.get(name)) === acceptedPostArrivalCanonicalProductAliasHash'
if (!patched.includes(financeDayHashAnchor)) throw new Error('Finance day predecessor hash anchor missing')
patched = patched.replace(financeDayHashAnchor, [
  '        const financeDayChanged = financeDayChanges[name]',
  '        let acceptedFinanceDayHash = acceptedPostArrivalCanonicalProductAliasHash',
  '        if (financeDayChanged) {',
  "          check(financeDayChanged.before === acceptedPostArrivalCanonicalProductAliasHash, 'Finance day predecessor drifted: ' + name)",
  '          acceptedFinanceDayHash = financeDayChanged.after',
  '        }',
  '        const financeR3HistoricalCashChanged = financeR3HistoricalCashChanges[name]',
  '        let acceptedFinanceR3HistoricalCashHash = acceptedFinanceDayHash',
  '        if (financeR3HistoricalCashChanged) {',
  "          check(financeR3HistoricalCashChanged.before === acceptedFinanceDayHash, 'Finance R3 historical cash predecessor drifted: ' + name)",
  '          acceptedFinanceR3HistoricalCashHash = financeR3HistoricalCashChanged.after',
  '        }',
  '        return sha(declarations.get(name)) === acceptedFinanceR3HistoricalCashHash',
].join('\n'))
patched = patched.replace(physicalAddedAnchor, [
  '  for (const [name, hash] of Object.entries(financeDayAdded)) {',
  "    check(declarations.has(name) && sha(declarations.get(name)) === hash, 'Finance day added declaration changed: ' + name)",
  '  }',
  physicalAddedAnchor,
].join('\n'))
const resolverUx = JSON.parse(fs.readFileSync(path.join(root, 'scripts/catalog-resolver-ux-manifest.json'), 'utf8'))
if (resolverUx.revision !== 'catalog-resolver-ux-r1' || Object.keys(resolverUx.changes).join(',') !== 'getCatalogReviewContext') throw new Error('Resolver UX Worker allow-list changed')
patched = 'const resolverUxChanges = ' + JSON.stringify(resolverUx.changes) + '\nconst resolverUxRouter = ' + JSON.stringify(resolverUx.router) + '\n' + patched
const resolverUxHashAnchor = '        return sha(declarations.get(name)) === acceptedFinanceR3HistoricalCashHash'
if (!patched.includes(resolverUxHashAnchor)) throw new Error('Resolver UX predecessor anchor missing')
patched = patched.replace(resolverUxHashAnchor, [
  '        const resolverUxChanged = resolverUxChanges[name]',
  "        if (resolverUxChanged) check(resolverUxChanged.before === acceptedFinanceR3HistoricalCashHash, 'Resolver UX predecessor drifted: ' + name)",
  '        return sha(declarations.get(name)) === (resolverUxChanged ? resolverUxChanged.after : acceptedFinanceR3HistoricalCashHash)',
].join('\n'))
patched = patched.replace(physicalAddedAnchor, [
  "  check(sha(currentRouter) === resolverUxRouter.after, 'Resolver UX router changed outside exact delta')",
  "  check(currentRouter.includes(resolverUxRouter.new), 'Resolver UX router reversion anchor missing')",
  '  currentRouter = currentRouter.replace(resolverUxRouter.new, resolverUxRouter.old)',
  "  check(sha(currentRouter) === resolverUxRouter.before && resolverUxRouter.before === contextualCatalogResolutionRouter.after, 'Resolver UX router predecessor drifted')",
  physicalAddedAnchor,
].join('\n'))
const orderDeleteLifecycle = JSON.parse(fs.readFileSync(path.join(root, 'scripts/order-delete-working-mode-lifecycle-worker-manifest.json'), 'utf8'))
if (orderDeleteLifecycle.version !== 1 || orderDeleteLifecycle.revision !== 'order-delete-working-mode-lifecycle-r1' || Object.keys(orderDeleteLifecycle.changes || {}).sort().join(',') !== 'deleteOrderSafely,updateOrderCritical') throw new Error('Order delete lifecycle Worker allow-list changed')
patched = 'const orderDeleteLifecycleChanges = ' + JSON.stringify(orderDeleteLifecycle.changes) + '\n' + patched
// Branch2 environment is the final deployment-only declaration layer over current main.
const branch2Environment = JSON.parse(fs.readFileSync(path.join(root, 'scripts/branch2-environment-worker-manifest.json'), 'utf8'))
if (branch2Environment.version !== 1 || branch2Environment.revision !== 'branch2-environment-r2-current-main' || Object.keys(branch2Environment.changes || {}).join(',') !== 'verifySimpleAdminPassword') throw new Error('Branch2 environment Worker allow-list changed')
patched = 'const branch2EnvironmentChanges = ' + JSON.stringify(branch2Environment.changes) + '\n' + patched
const branch2HashAnchor = '        return sha(declarations.get(name)) === (resolverUxChanged ? resolverUxChanged.after : acceptedFinanceR3HistoricalCashHash)'
if (!patched.includes(branch2HashAnchor)) throw new Error('Branch2 environment predecessor anchor missing')
patched = patched.replace(branch2HashAnchor, [
  '        const acceptedPostResolverUxHash = resolverUxChanged ? resolverUxChanged.after : acceptedFinanceR3HistoricalCashHash',
  '        const branch2EnvironmentChanged = branch2EnvironmentChanges[name]',
  "        if (branch2EnvironmentChanged) check(branch2EnvironmentChanged.before === acceptedPostResolverUxHash, 'Branch2 environment predecessor drifted: ' + name)",
  '        const acceptedPostBranch2EnvironmentHash = branch2EnvironmentChanged ? branch2EnvironmentChanged.after : acceptedPostResolverUxHash',
  '        const orderDeleteLifecycleChanged = orderDeleteLifecycleChanges[name]',
  "        if (orderDeleteLifecycleChanged) check(orderDeleteLifecycleChanged.before === acceptedPostBranch2EnvironmentHash, 'Order delete lifecycle predecessor drifted: ' + name)",
  '        return sha(declarations.get(name)) === (orderDeleteLifecycleChanged ? orderDeleteLifecycleChanged.after : acceptedPostBranch2EnvironmentHash)',
].join('\n'))
const stage01CanonicalItemProjection = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-canonical-item-projection-r2-worker-manifest.json'), 'utf8'))
if (stage01CanonicalItemProjection.version !== 1 || stage01CanonicalItemProjection.revision !== 'stage01-canonical-item-projection-r2') throw new Error('Stage01 canonical item projection Worker manifest invalid')
if (Object.keys(stage01CanonicalItemProjection.changes || {}).sort().join(',') !== 'getOrder,listOrders') throw new Error('Stage01 canonical item projection Worker change allow-list widened')
if (Object.keys(stage01CanonicalItemProjection.added || {}).join(',') !== 'canonicalItemProjection') throw new Error('Stage01 canonical item projection Worker added allow-list widened')
patched = 'const stage01CanonicalItemProjectionChanges = ' + JSON.stringify(stage01CanonicalItemProjection.changes || {}) + '\n'
  + 'const stage01CanonicalItemProjectionAdded = ' + JSON.stringify(stage01CanonicalItemProjection.added || {}) + '\n'
  + patched
const stage01CanonicalCountAnchor = ' + Object.keys(financeDayAdded).length'
if (!patched.includes(stage01CanonicalCountAnchor)) throw new Error('Stage01 canonical item projection declaration-count anchor missing')
patched = patched.replace(stage01CanonicalCountAnchor, stage01CanonicalCountAnchor + ' + Object.keys(stage01CanonicalItemProjectionAdded).length')
const stage01CanonicalHashAnchor = '        return sha(declarations.get(name)) === (orderDeleteLifecycleChanged ? orderDeleteLifecycleChanged.after : acceptedPostBranch2EnvironmentHash)'
if (!patched.includes(stage01CanonicalHashAnchor)) throw new Error('Stage01 canonical item projection predecessor hash anchor missing')
patched = patched.replace(stage01CanonicalHashAnchor, [
  '        const acceptedPostOrderDeleteLifecycleHash = orderDeleteLifecycleChanged ? orderDeleteLifecycleChanged.after : acceptedPostBranch2EnvironmentHash',
  '        const stage01CanonicalItemProjectionChanged = stage01CanonicalItemProjectionChanges[name]',
  "        if (stage01CanonicalItemProjectionChanged) check(stage01CanonicalItemProjectionChanged.before === acceptedPostOrderDeleteLifecycleHash, 'Stage01 canonical item projection predecessor drifted: ' + name)",
  '        return sha(declarations.get(name)) === (stage01CanonicalItemProjectionChanged ? stage01CanonicalItemProjectionChanged.after : acceptedPostOrderDeleteLifecycleHash)',
].join('\n'))
const stage01CanonicalAddedAnchor = '  // Catalog gender scope R1 changes only the product create/update request shapes.'
if (!patched.includes(stage01CanonicalAddedAnchor)) throw new Error('Stage01 canonical item projection added-declaration anchor missing')
patched = patched.replace(stage01CanonicalAddedAnchor, [
  '  for (const [name, hash] of Object.entries(stage01CanonicalItemProjectionAdded)) {',
  "    check(declarations.has(name) && sha(declarations.get(name)) === hash, 'Stage01 canonical item projection added declaration changed: ' + name)",
  '  }',
  '',
  stage01CanonicalAddedAnchor,
].join('\n'))

const stage01WorkshopTruth = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-workshop-truth-r3-worker-manifest.json'), 'utf8'))
if (stage01WorkshopTruth.version !== 1 || stage01WorkshopTruth.revision !== 'stage01-workshop-truth-r3') throw new Error('Stage01 Workshop truth R3 Worker manifest invalid')
if (Object.keys(stage01WorkshopTruth.changes || {}).sort().join(',') !== 'orderWorkshopPendingForShipping,updateWorkshopTask') throw new Error('Stage01 Workshop truth R3 Worker allow-list widened')
if (!stage01WorkshopTruth.router?.before || !stage01WorkshopTruth.router?.after || !stage01WorkshopTruth.router?.beforeBlock || !stage01WorkshopTruth.router?.afterBlock) throw new Error('Stage01 Workshop truth R3 router manifest incomplete')
patched = 'const stage01WorkshopTruthChanges = ' + JSON.stringify(stage01WorkshopTruth.changes || {}) + '\n'
  + 'const stage01WorkshopTruthRouter = ' + JSON.stringify(stage01WorkshopTruth.router || {}) + '\n'
  + patched
const stage01WorkshopHashAnchor = '        return sha(declarations.get(name)) === (stage01CanonicalItemProjectionChanged ? stage01CanonicalItemProjectionChanged.after : acceptedPostOrderDeleteLifecycleHash)'
if (!patched.includes(stage01WorkshopHashAnchor)) throw new Error('Stage01 Workshop truth R3 predecessor hash anchor missing')
patched = patched.replace(stage01WorkshopHashAnchor, [
  '        const acceptedPostStage01CanonicalItemHash = stage01CanonicalItemProjectionChanged ? stage01CanonicalItemProjectionChanged.after : acceptedPostOrderDeleteLifecycleHash',
  '        const stage01WorkshopTruthChanged = stage01WorkshopTruthChanges[name]',
  "        if (stage01WorkshopTruthChanged) check(stage01WorkshopTruthChanged.before === acceptedPostStage01CanonicalItemHash, 'Stage01 Workshop truth R3 predecessor drifted: ' + name)",
  '        return sha(declarations.get(name)) === (stage01WorkshopTruthChanged ? stage01WorkshopTruthChanged.after : acceptedPostStage01CanonicalItemHash)',
].join('\n'))
const stage01WorkshopRouterAnchor = "  check(sha(currentRouter) === resolverUxRouter.after, 'Resolver UX router changed outside exact delta')"
if (!patched.includes(stage01WorkshopRouterAnchor)) throw new Error('Stage01 Workshop truth R3 router predecessor anchor missing')
patched = patched.replace(stage01WorkshopRouterAnchor, [
  "  check(sha(currentRouter) === stage01WorkshopTruthRouter.after, 'Stage01 Workshop truth R3 router changed outside exact delta')",
  "  check(currentRouter.includes(stage01WorkshopTruthRouter.afterBlock), 'Stage01 Workshop truth R3 router reversion anchor missing')",
  '  currentRouter = currentRouter.replace(stage01WorkshopTruthRouter.afterBlock, stage01WorkshopTruthRouter.beforeBlock)',
  "  check(sha(currentRouter) === stage01WorkshopTruthRouter.before, 'Stage01 Workshop truth R3 router reverse baseline mismatch')",
  "  check(stage01WorkshopTruthRouter.before === resolverUxRouter.after, 'Stage01 Workshop truth R3 router predecessor drifted')",
  stage01WorkshopRouterAnchor,
].join('\n'))

const stage01FinanceCorrectionReliabilityR4 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-finance-correction-reliability-r4-worker-manifest.json'), 'utf8'))
if (stage01FinanceCorrectionReliabilityR4.version !== 1 || stage01FinanceCorrectionReliabilityR4.revision !== 'stage01-finance-correction-reliability-r4') throw new Error('Stage01 finance correction reliability R4 Worker manifest invalid')
if (Object.keys(stage01FinanceCorrectionReliabilityR4.changes || {}).join(',') !== 'correctExchangeFinancials') throw new Error('Stage01 finance correction reliability R4 Worker allow-list widened')
patched = 'const stage01FinanceCorrectionReliabilityR4Changes = ' + JSON.stringify(stage01FinanceCorrectionReliabilityR4.changes || {}) + '\n' + patched

const stage01FinanceA5AddedAnchor = [
  '  for (const [name, expectedHash] of Object.entries(operationalAutonomyA5Added)) {',
  "    check(declarations.has(name), 'Operational Autonomy A5 added Worker declaration missing: ' + name)",
  "    check(sha(declarations.get(name)) === expectedHash, 'Operational Autonomy A5 added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n')
if (!patched.includes(stage01FinanceA5AddedAnchor)) throw new Error('Stage01 finance correction reliability R4 A5-added predecessor anchor missing')
patched = patched.replace(stage01FinanceA5AddedAnchor, [
  '  for (const [name, expectedHash] of Object.entries(operationalAutonomyA5Added)) {',
  "    check(declarations.has(name), 'Operational Autonomy A5 added Worker declaration missing: ' + name)",
  '    const stage01FinanceCorrectionChanged = stage01FinanceCorrectionReliabilityR4Changes[name]',
  '    if (stage01FinanceCorrectionChanged) {',
  "      check(stage01FinanceCorrectionChanged.before === expectedHash, 'Stage01 finance correction reliability R4 predecessor drifted: ' + name)",
  '    }',
  "    check(sha(declarations.get(name)) === (stage01FinanceCorrectionChanged ? stage01FinanceCorrectionChanged.after : expectedHash), stage01FinanceCorrectionChanged",
  "      ? 'Stage01 finance correction reliability R4 declaration changed beyond exact delta: ' + name",
  "      : 'Operational Autonomy A5 added Worker declaration changed: ' + name)",
  '  }',
  '',
].join('\n'))

const stage01ReturnExchangeWorkshopCacheR5 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-return-exchange-workshop-cache-reliability-r5-worker-manifest.json'), 'utf8'))
if (stage01ReturnExchangeWorkshopCacheR5.version !== 1 || stage01ReturnExchangeWorkshopCacheR5.revision !== 'stage01-return-exchange-workshop-cache-reliability-r5') throw new Error('Stage01 Return/Exchange Workshop cache R5 Worker manifest invalid')
if (Object.keys(stage01ReturnExchangeWorkshopCacheR5.changes || {}).sort().join(',') !== 'cancelExchange,cancelReturn,createExchange,createReturn') throw new Error('Stage01 Return/Exchange Workshop cache R5 Worker allow-list widened')
patched = 'const stage01ReturnExchangeWorkshopCacheR5Changes = ' + JSON.stringify(stage01ReturnExchangeWorkshopCacheR5.changes || {}) + '\n' + patched
const stage01ReturnExchangeHashAnchor = '        return sha(declarations.get(name)) === (stage01WorkshopTruthChanged ? stage01WorkshopTruthChanged.after : acceptedPostStage01CanonicalItemHash)'
if (!patched.includes(stage01ReturnExchangeHashAnchor)) throw new Error('Stage01 Return/Exchange Workshop cache R5 predecessor hash anchor missing')
patched = patched.replace(stage01ReturnExchangeHashAnchor, [
  '        const acceptedPostStage01WorkshopHash = stage01WorkshopTruthChanged ? stage01WorkshopTruthChanged.after : acceptedPostStage01CanonicalItemHash',
  '        const stage01ReturnExchangeWorkshopCacheChanged = stage01ReturnExchangeWorkshopCacheR5Changes[name]',
  "        if (stage01ReturnExchangeWorkshopCacheChanged) check(stage01ReturnExchangeWorkshopCacheChanged.before === acceptedPostStage01WorkshopHash, 'Stage01 Return/Exchange Workshop cache R5 predecessor drifted: ' + name)",
  '        return sha(declarations.get(name)) === (stage01ReturnExchangeWorkshopCacheChanged ? stage01ReturnExchangeWorkshopCacheChanged.after : acceptedPostStage01WorkshopHash)',
].join('\n'))

const stage01UnshippedRefundR6 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-unshipped-refund-decoupling-r6-worker-manifest.json'), 'utf8'))
if (stage01UnshippedRefundR6.version !== 1 || stage01UnshippedRefundR6.revision !== 'stage01-unshipped-refund-decoupling-r6') throw new Error('Stage01 unshipped refund R6 Worker manifest invalid')
if (Object.keys(stage01UnshippedRefundR6.changes || {}).join(',') !== 'listOrders') throw new Error('Stage01 unshipped refund R6 Worker allow-list widened')
patched = 'const stage01UnshippedRefundR6Changes = ' + JSON.stringify(stage01UnshippedRefundR6.changes || {}) + '\n' + patched

const stage01UnshippedRefundHashAnchor = '        return sha(declarations.get(name)) === (stage01ReturnExchangeWorkshopCacheChanged ? stage01ReturnExchangeWorkshopCacheChanged.after : acceptedPostStage01WorkshopHash)'
if (!patched.includes(stage01UnshippedRefundHashAnchor)) throw new Error('Stage01 unshipped refund R6 predecessor hash anchor missing')
patched = patched.replace(stage01UnshippedRefundHashAnchor, [
  '        const acceptedPostStage01ReturnExchangeHash = stage01ReturnExchangeWorkshopCacheChanged ? stage01ReturnExchangeWorkshopCacheChanged.after : acceptedPostStage01WorkshopHash',
  '        const stage01UnshippedRefundChanged = stage01UnshippedRefundR6Changes[name]',
  '        if (stage01UnshippedRefundChanged) {',
  "          check(stage01UnshippedRefundChanged.before === acceptedPostStage01ReturnExchangeHash, 'Stage01 unshipped refund R6 predecessor drifted: ' + name)",
  "          check(declarations.get(name).includes(stage01UnshippedRefundChanged.afterBlock), 'Stage01 unshipped refund R6 exact replacement missing: ' + name)",
  '          const revertedStage01UnshippedRefund = declarations.get(name).replace(stage01UnshippedRefundChanged.afterBlock, stage01UnshippedRefundChanged.beforeBlock)',
  "          check(sha(revertedStage01UnshippedRefund) === stage01UnshippedRefundChanged.before, 'Stage01 unshipped refund R6 changed beyond exact replacement: ' + name)",
  '          return true',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash',
].join('\n'))

const stage01WorkshopBulkCacheR7 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-workshop-bulk-cache-reliability-r7-worker-manifest.json'), 'utf8'))
if (stage01WorkshopBulkCacheR7.version !== 1 || stage01WorkshopBulkCacheR7.revision !== 'stage01-workshop-bulk-cache-reliability-r7') throw new Error('Stage01 Workshop bulk cache R7 Worker manifest invalid')
if (Object.keys(stage01WorkshopBulkCacheR7.changes || {}).join(',') !== 'bulkUpdateWorkshopTasks') throw new Error('Stage01 Workshop bulk cache R7 Worker allow-list widened')
patched = 'const stage01WorkshopBulkCacheR7Changes = ' + JSON.stringify(stage01WorkshopBulkCacheR7.changes || {}) + '\n' + patched

const stage01WorkshopBulkHashAnchor = '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash'
if (!patched.includes(stage01WorkshopBulkHashAnchor)) throw new Error('Stage01 Workshop bulk cache R7 predecessor hash anchor missing')
patched = patched.replace(stage01WorkshopBulkHashAnchor, [
  '        const stage01WorkshopBulkCacheChanged = stage01WorkshopBulkCacheR7Changes[name]',
  '        if (stage01WorkshopBulkCacheChanged) {',
  "          check(stage01WorkshopBulkCacheChanged.before === acceptedPostStage01ReturnExchangeHash, 'Stage01 Workshop bulk cache R7 predecessor drifted: ' + name)",
  "          check(declarations.get(name).includes(stage01WorkshopBulkCacheChanged.afterBlock), 'Stage01 Workshop bulk cache R7 exact replacement missing: ' + name)",
  '          const revertedStage01WorkshopBulkCache = declarations.get(name).replace(stage01WorkshopBulkCacheChanged.afterBlock, stage01WorkshopBulkCacheChanged.beforeBlock)',
  "          check(sha(revertedStage01WorkshopBulkCache) === stage01WorkshopBulkCacheChanged.before, 'Stage01 Workshop bulk cache R7 changed beyond exact replacement: ' + name)",
  '          return true',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash',
].join('\n'))

const stage01DebtCanonicalItemR8 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-debt-canonical-item-r8-worker-manifest.json'), 'utf8'))
if (stage01DebtCanonicalItemR8.version !== 1 || stage01DebtCanonicalItemR8.revision !== 'stage01-debt-canonical-item-r8') throw new Error('Stage01 Debt canonical item R8 Worker manifest invalid')
if (Object.keys(stage01DebtCanonicalItemR8.changes || {}).join(',') !== 'listOpenDebtOrders') throw new Error('Stage01 Debt canonical item R8 Worker allow-list widened')
patched = 'const stage01DebtCanonicalItemR8Changes = ' + JSON.stringify(stage01DebtCanonicalItemR8.changes || {}) + '\n' + patched

const stage01DebtCanonicalHashAnchor = '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash'
if (!patched.includes(stage01DebtCanonicalHashAnchor)) throw new Error('Stage01 Debt canonical item R8 predecessor hash anchor missing')
patched = patched.replace(stage01DebtCanonicalHashAnchor, [
  '        const stage01DebtCanonicalItemChanged = stage01DebtCanonicalItemR8Changes[name]',
  '        if (stage01DebtCanonicalItemChanged) {',
  "          check(stage01DebtCanonicalItemChanged.before === acceptedPostStage01ReturnExchangeHash, 'Stage01 Debt canonical item R8 predecessor drifted: ' + name)",
  "          check(declarations.get(name).includes(stage01DebtCanonicalItemChanged.afterBlock), 'Stage01 Debt canonical item R8 exact replacement missing: ' + name)",
  '          const revertedStage01DebtCanonicalItem = declarations.get(name).replace(stage01DebtCanonicalItemChanged.afterBlock, stage01DebtCanonicalItemChanged.beforeBlock)',
  "          check(sha(revertedStage01DebtCanonicalItem) === stage01DebtCanonicalItemChanged.before, 'Stage01 Debt canonical item R8 changed beyond exact replacement: ' + name)",
  '          return true',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash',
].join('\n'))

const stage01WorkshopCanonicalItemR9 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-workshop-canonical-item-r9-worker-manifest.json'), 'utf8'))
if (stage01WorkshopCanonicalItemR9.version !== 1 || stage01WorkshopCanonicalItemR9.revision !== 'stage01-workshop-canonical-item-r9') throw new Error('Stage01 Workshop canonical item R9 Worker manifest invalid')
if (Object.keys(stage01WorkshopCanonicalItemR9.changes || {}).join(',') !== 'enrichWorkshopTaskRowsFromOrderItems') throw new Error('Stage01 Workshop canonical item R9 Worker allow-list widened')
patched = 'const stage01WorkshopCanonicalItemR9Changes = ' + JSON.stringify(stage01WorkshopCanonicalItemR9.changes || {}) + '\n' + patched

const stage01WorkshopCanonicalHashAnchor = '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash'
if (!patched.includes(stage01WorkshopCanonicalHashAnchor)) throw new Error('Stage01 Workshop canonical item R9 predecessor hash anchor missing')
patched = patched.replace(stage01WorkshopCanonicalHashAnchor, [
  '        const stage01WorkshopCanonicalItemChanged = stage01WorkshopCanonicalItemR9Changes[name]',
  '        if (stage01WorkshopCanonicalItemChanged) {',
  "          check(stage01WorkshopCanonicalItemChanged.before === acceptedPostStage01ReturnExchangeHash, 'Stage01 Workshop canonical item R9 predecessor drifted: ' + name)",
  "          check(declarations.get(name).includes(stage01WorkshopCanonicalItemChanged.afterBlock), 'Stage01 Workshop canonical item R9 exact replacement missing: ' + name)",
  '          const revertedStage01WorkshopCanonicalItem = declarations.get(name).replace(stage01WorkshopCanonicalItemChanged.afterBlock, stage01WorkshopCanonicalItemChanged.beforeBlock)',
  "          check(sha(revertedStage01WorkshopCanonicalItem) === stage01WorkshopCanonicalItemChanged.before, 'Stage01 Workshop canonical item R9 changed beyond exact replacement: ' + name)",
  '          return true',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash',
].join('\n'))

const stage01WorkshopLifecycleCanonicalR10 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-workshop-lifecycle-canonical-link-r10-worker-manifest.json'), 'utf8'))
if (stage01WorkshopLifecycleCanonicalR10.version !== 1 || stage01WorkshopLifecycleCanonicalR10.revision !== 'stage01-workshop-lifecycle-canonical-link-r10') throw new Error('Stage01 Workshop lifecycle canonical link R10 Worker manifest invalid')
if (Object.keys(stage01WorkshopLifecycleCanonicalR10.changes || {}).sort().join(',') !== 'resolveInventoryLifecycleCandidate,resolveWorkshopCatalogExactCandidate') throw new Error('Stage01 Workshop lifecycle canonical link R10 Worker allow-list widened')
patched = 'const stage01WorkshopLifecycleCanonicalR10Changes = ' + JSON.stringify(stage01WorkshopLifecycleCanonicalR10.changes || {}) + '\n' + patched

const stage01WorkshopLifecycleCanonicalHashAnchor = '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash'
if (!patched.includes(stage01WorkshopLifecycleCanonicalHashAnchor)) throw new Error('Stage01 Workshop lifecycle canonical link R10 predecessor hash anchor missing')
patched = patched.replace(stage01WorkshopLifecycleCanonicalHashAnchor, [
  '        const stage01WorkshopLifecycleCanonicalChanged = stage01WorkshopLifecycleCanonicalR10Changes[name]',
  '        if (stage01WorkshopLifecycleCanonicalChanged) {',
  "          check(declarations.get(name).includes(stage01WorkshopLifecycleCanonicalChanged.afterBlock), 'Stage01 Workshop lifecycle canonical link R10 exact replacement missing: ' + name)",
  '          const revertedStage01WorkshopLifecycleCanonical = declarations.get(name).replace(stage01WorkshopLifecycleCanonicalChanged.afterBlock, stage01WorkshopLifecycleCanonicalChanged.beforeBlock)',
  "          check(sha(revertedStage01WorkshopLifecycleCanonical) === acceptedPostStage01ReturnExchangeHash, 'Stage01 Workshop lifecycle canonical link R10 changed beyond exact replacement: ' + name)",
  '          return true',
  '        }',
  '        return sha(declarations.get(name)) === acceptedPostStage01ReturnExchangeHash',
].join('\n'))

const stage01WorkshopLifecycleCanonicalAddedAnchor = [
  '    check(',
  '      sha(declarations.get(name)) === acceptedPostW3NaturalRecoveryHash,',
  '      w3NaturalRecoveryWorkerChanged',
  '        ? `192A1-added declaration changed beyond exact W3.2 allow-list: ${name}`',
  '        : `192A1 added Worker declaration changed beyond accepted deltas: ${name}`,',
  '    )',
].join('\n')
if (!patched.includes(stage01WorkshopLifecycleCanonicalAddedAnchor)) throw new Error('Stage01 Workshop lifecycle canonical link R10 192A1-added anchor missing')
patched = patched.replace(stage01WorkshopLifecycleCanonicalAddedAnchor, [
  '    const stage01WorkshopLifecycleCanonicalAddedChanged = stage01WorkshopLifecycleCanonicalR10Changes[name]',
  '    if (stage01WorkshopLifecycleCanonicalAddedChanged) {',
  "      check(declarations.get(name).includes(stage01WorkshopLifecycleCanonicalAddedChanged.afterBlock), 'Stage01 Workshop lifecycle canonical link R10 added exact replacement missing: ' + name)",
  '      const revertedStage01WorkshopLifecycleCanonicalAdded = declarations.get(name).replace(stage01WorkshopLifecycleCanonicalAddedChanged.afterBlock, stage01WorkshopLifecycleCanonicalAddedChanged.beforeBlock)',
  "      check(sha(revertedStage01WorkshopLifecycleCanonicalAdded) === acceptedPostW3NaturalRecoveryHash, 'Stage01 Workshop lifecycle canonical link R10 changed 192A1-added declaration beyond exact replacement: ' + name)",
  '    } else {',
  '      check(',
  '        sha(declarations.get(name)) === acceptedPostW3NaturalRecoveryHash,',
  '        w3NaturalRecoveryWorkerChanged',
  '          ? `192A1-added declaration changed beyond exact W3.2 allow-list: ${name}`',
  '          : `192A1 added Worker declaration changed beyond accepted deltas: ${name}`,',
  '      )',
  '    }',
].join('\n'))

const stage01LifecycleManualQueueR21 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-lifecycle-manual-queue-r21-worker-manifest.json'), 'utf8'))
if (stage01LifecycleManualQueueR21.version !== 1 || stage01LifecycleManualQueueR21.revision !== 'stage01-lifecycle-manual-queue-r21') throw new Error('Stage01 lifecycle manual queue R21 Worker manifest invalid')
if (Object.keys(stage01LifecycleManualQueueR21.changes || {}).join(',') !== 'listInventoryLifecyclePending') throw new Error('Stage01 lifecycle manual queue R21 Worker allow-list widened')
patched = 'const stage01LifecycleManualQueueR21Changes = ' + JSON.stringify(stage01LifecycleManualQueueR21.changes || {}) + '\n' + patched

const stage01PendingLifecycleR11Manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-pending-lifecycle-current-links-r11-worker-manifest.json'), 'utf8'))
if (stage01PendingLifecycleR11Manifest.version !== 1 || stage01PendingLifecycleR11Manifest.revision !== 'stage01-pending-lifecycle-current-links-r11') throw new Error('Stage01 pending lifecycle current links R11 Worker manifest invalid')
const stage01PendingLifecycleR11Changes = stage01PendingLifecycleR11Manifest.files?.['worker/domains/lifecycle.ts']?.changes || {}
if (Object.keys(stage01PendingLifecycleR11Changes).sort().join(',') !== 'getInventoryLifecycleContext,listInventoryLifecyclePending,reconcileKnownPendingInventoryInbound') throw new Error('Stage01 pending lifecycle R11 lifecycle allow-list widened')
const stage01PendingLifecycleR11Attention = stage01PendingLifecycleR11Manifest.files?.['worker/domains/warehouse-attention.ts']?.changes?.exactLifecycleVariantSql
if (!stage01PendingLifecycleR11Attention?.beforeBlock || !stage01PendingLifecycleR11Attention?.afterBlock) throw new Error('Stage01 pending lifecycle R11 attention delta incomplete')

// R11 is the newest exact layer. Instead of guessing which historical hash branch each declaration
// belongs to, validate the live after-block here and temporarily normalize only that exact delta back
// to its predecessor. The complete legacy gate then proves every older manifest/hash unchanged.
patched = 'const stage01PendingLifecycleR11Changes = ' + JSON.stringify(stage01PendingLifecycleR11Changes) + '\n'
  + 'const stage01PendingLifecycleR11Attention = ' + JSON.stringify(stage01PendingLifecycleR11Attention) + '\n'
  + patched

const stage01PendingLifecycleNormalizeAnchor = '  const removedNames = Object.keys(removed)\n'
if (!patched.includes(stage01PendingLifecycleNormalizeAnchor)) throw new Error('Stage01 pending lifecycle R11 declaration-normalization anchor missing')
const stage01PendingLifecycleNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01PendingLifecycleR11Changes)) {',
  "    check(declarations.has(name), 'Stage01 pending lifecycle R11 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 pending lifecycle R11 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 pending lifecycle R11 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  "  const stage01PendingLifecycleAttentionName = 'getWarehouseAttentionSummary'",
  "  check(declarations.has(stage01PendingLifecycleAttentionName), 'Stage01 pending lifecycle R11 Warehouse Attention declaration missing')",
  '  const stage01PendingLifecycleAttentionCurrent = declarations.get(stage01PendingLifecycleAttentionName)',
  "  check(stage01PendingLifecycleAttentionCurrent.includes(stage01PendingLifecycleR11Attention.afterBlock), 'Stage01 pending lifecycle R11 Warehouse Attention exact after-block missing')",
  '  const stage01PendingLifecycleAttentionReverted = stage01PendingLifecycleAttentionCurrent.replace(stage01PendingLifecycleR11Attention.afterBlock, stage01PendingLifecycleR11Attention.beforeBlock)',
  "  check(stage01PendingLifecycleAttentionReverted !== stage01PendingLifecycleAttentionCurrent, 'Stage01 pending lifecycle R11 Warehouse Attention exact replacement did not apply')",
  '  declarations.set(stage01PendingLifecycleAttentionName, stage01PendingLifecycleAttentionReverted)',
  '',
].join('\n')
patched = patched.replace(stage01PendingLifecycleNormalizeAnchor, stage01PendingLifecycleNormalizeBlock + stage01PendingLifecycleNormalizeAnchor)

const stage01LifecycleManualQueueNormalizeAnchor = '  for (const [name, change] of Object.entries(stage01PendingLifecycleR11Changes)) {'
if (!patched.includes(stage01LifecycleManualQueueNormalizeAnchor)) throw new Error('Stage01 lifecycle manual queue R21 predecessor anchor missing')
const stage01LifecycleManualQueueNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01LifecycleManualQueueR21Changes)) {',
  "    check(declarations.has(name), 'Stage01 lifecycle manual queue R21 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 lifecycle manual queue R21 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 lifecycle manual queue R21 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01LifecycleManualQueueNormalizeAnchor, stage01LifecycleManualQueueNormalizeBlock + stage01LifecycleManualQueueNormalizeAnchor)


const stage01ResolverActiveReservationR12 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-resolver-active-reservation-r12-worker-manifest.json'), 'utf8'))
if (stage01ResolverActiveReservationR12.version !== 1 || stage01ResolverActiveReservationR12.revision !== 'stage01-resolver-active-reservation-r12') throw new Error('Stage01 Resolver active reservation R12 Worker manifest invalid')
if (Object.keys(stage01ResolverActiveReservationR12.changes || {}).join(',') !== 'resolveCatalogReviewRows') throw new Error('Stage01 Resolver active reservation R12 Worker allow-list widened')
patched = 'const stage01ResolverActiveReservationR12Changes = ' + JSON.stringify(stage01ResolverActiveReservationR12.changes || {}) + '\n' + patched

const stage01ResolverActiveReservationNormalizeAnchor = '  const removedNames = Object.keys(removed)\n'
if (!patched.includes(stage01ResolverActiveReservationNormalizeAnchor)) throw new Error('Stage01 Resolver active reservation R12 normalization anchor missing')
const stage01ResolverActiveReservationNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01ResolverActiveReservationR12Changes)) {',
  "    check(declarations.has(name), 'Stage01 Resolver active reservation R12 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 Resolver active reservation R12 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 Resolver active reservation R12 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01ResolverActiveReservationNormalizeAnchor, stage01ResolverActiveReservationNormalizeBlock + stage01ResolverActiveReservationNormalizeAnchor)

const stage01HandoverPhysicalIdentityR13 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-handover-physical-canonical-identity-r13-worker-manifest.json'), 'utf8'))
if (stage01HandoverPhysicalIdentityR13.version !== 1 || stage01HandoverPhysicalIdentityR13.revision !== 'stage01-handover-physical-canonical-identity-r13') throw new Error('Stage01 handover physical identity R13 Worker manifest invalid')
if (Object.keys(stage01HandoverPhysicalIdentityR13.changes || {}).sort().join(',') !== 'fetchOrderStockHandoverRows,fulfillOrderReservationsV2,getOrderShipmentInventoryBlockers,stockHandoverItemFromRow') throw new Error('Stage01 handover physical identity R13 Worker allow-list widened')
patched = 'const stage01HandoverPhysicalIdentityR13Changes = ' + JSON.stringify(stage01HandoverPhysicalIdentityR13.changes || {}) + '\n' + patched

const stage01HandoverPhysicalIdentityNormalizeAnchor = '  const removedNames = Object.keys(removed)\n'
if (!patched.includes(stage01HandoverPhysicalIdentityNormalizeAnchor)) throw new Error('Stage01 handover physical identity R13 normalization anchor missing')
const stage01HandoverPhysicalIdentityNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01HandoverPhysicalIdentityR13Changes)) {',
  "    check(declarations.has(name), 'Stage01 handover physical identity R13 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 handover physical identity R13 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 handover physical identity R13 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01HandoverPhysicalIdentityNormalizeAnchor, stage01HandoverPhysicalIdentityNormalizeBlock + stage01HandoverPhysicalIdentityNormalizeAnchor)

const stage01ReturnExchangeAvailabilityR15 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-return-exchange-item-availability-r15-worker-manifest.json'), 'utf8'))
if (stage01ReturnExchangeAvailabilityR15.version !== 1 || stage01ReturnExchangeAvailabilityR15.revision !== 'stage01-return-exchange-item-availability-r15') throw new Error('Stage01 Return/Exchange item availability R15 Worker manifest invalid')
if (Object.keys(stage01ReturnExchangeAvailabilityR15.changes || {}).sort().join(',') !== 'fetchOrderRelations,getOrder,listOrders') throw new Error('Stage01 Return/Exchange item availability R15 Worker change allow-list widened')
if (Object.keys(stage01ReturnExchangeAvailabilityR15.added || {}).join(',') !== 'orderItemAvailableOperationQuantity') throw new Error('Stage01 Return/Exchange item availability R15 Worker added allow-list widened')
patched = 'const stage01ReturnExchangeAvailabilityR15Changes = ' + JSON.stringify(stage01ReturnExchangeAvailabilityR15.changes || {}) + '\n'
  + 'const stage01ReturnExchangeAvailabilityR15Added = ' + JSON.stringify(stage01ReturnExchangeAvailabilityR15.added || {}) + '\n'
  + patched

const stage01ReturnExchangeAvailabilityNormalizeAnchor = '  const removedNames = Object.keys(removed)\n'
if (!patched.includes(stage01ReturnExchangeAvailabilityNormalizeAnchor)) throw new Error('Stage01 Return/Exchange item availability R15 normalization anchor missing')
const stage01ReturnExchangeAvailabilityNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01ReturnExchangeAvailabilityR15Changes)) {',
  "    check(declarations.has(name), 'Stage01 Return/Exchange item availability R15 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 Return/Exchange item availability R15 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 Return/Exchange item availability R15 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '  for (const [name, change] of Object.entries(stage01ReturnExchangeAvailabilityR15Added)) {',
  "    check(declarations.has(name), 'Stage01 Return/Exchange item availability R15 added declaration missing: ' + name)",
  "    check(declarations.get(name) === change.afterBlock, 'Stage01 Return/Exchange item availability R15 added declaration changed: ' + name)",
  '    declarations.delete(name)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01ReturnExchangeAvailabilityNormalizeAnchor, stage01ReturnExchangeAvailabilityNormalizeBlock + stage01ReturnExchangeAvailabilityNormalizeAnchor)

const stage01CanonicalOrderSearchR14 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-canonical-order-search-r14-worker-manifest.json'), 'utf8'))
if (stage01CanonicalOrderSearchR14.version !== 1 || stage01CanonicalOrderSearchR14.revision !== 'stage01-canonical-order-search-r14') throw new Error('Stage01 canonical order search R14 Worker manifest invalid')
if (Object.keys(stage01CanonicalOrderSearchR14.changes || {}).join(',') !== 'listOrders') throw new Error('Stage01 canonical order search R14 Worker allow-list widened')
patched = 'const stage01CanonicalOrderSearchR14Changes = ' + JSON.stringify(stage01CanonicalOrderSearchR14.changes || {}) + '\n' + patched

const stage01StocktakeCanonicalSeedNormalizeAnchor = '  const removedNames = Object.keys(removed)\n'
if (!patched.includes(stage01StocktakeCanonicalSeedNormalizeAnchor)) throw new Error('Stage01 stocktake canonical seed R20 normalization anchor missing')
const stage01StocktakeCanonicalSeedNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01StocktakeCanonicalSeedR20Changes)) {',
  "    check(declarations.has(name), 'Stage01 stocktake canonical seed R20 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 stocktake canonical seed R20 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 stocktake canonical seed R20 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01StocktakeCanonicalSeedNormalizeAnchor, stage01StocktakeCanonicalSeedNormalizeBlock + stage01StocktakeCanonicalSeedNormalizeAnchor)

const stage01CanonicalOrderSearchNormalizeAnchor = '  const removedNames = Object.keys(removed)\n'
if (!patched.includes(stage01CanonicalOrderSearchNormalizeAnchor)) throw new Error('Stage01 canonical order search R14 normalization anchor missing')
const stage01CanonicalOrderSearchNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01CanonicalOrderSearchR14Changes)) {',
  "    check(declarations.has(name), 'Stage01 canonical order search R14 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 canonical order search R14 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 canonical order search R14 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01CanonicalOrderSearchNormalizeAnchor, stage01CanonicalOrderSearchNormalizeBlock + stage01CanonicalOrderSearchNormalizeAnchor)

const stage01StocktakeCanonicalSeedR20 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-stocktake-canonical-seed-r20-worker-manifest.json'), 'utf8'))
if (stage01StocktakeCanonicalSeedR20.version !== 1 || stage01StocktakeCanonicalSeedR20.revision !== 'stage01-stocktake-canonical-seed-r20') throw new Error('Stage01 stocktake canonical seed R20 Worker manifest invalid')
if (Object.keys(stage01StocktakeCanonicalSeedR20.changes || {}).join(',') !== 'createInventoryStocktakeSession') throw new Error('Stage01 stocktake canonical seed R20 Worker allow-list widened')
patched = 'const stage01StocktakeCanonicalSeedR20Changes = ' + JSON.stringify(stage01StocktakeCanonicalSeedR20.changes || {}) + '\n' + patched

const stage01InventoryCurrentCanonicalR16 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-inventory-current-canonical-identity-r16-worker-manifest.json'), 'utf8'))
if (stage01InventoryCurrentCanonicalR16.version !== 1 || stage01InventoryCurrentCanonicalR16.revision !== 'stage01-inventory-current-canonical-identity-r16') throw new Error('Stage01 inventory current canonical identity R16 Worker manifest invalid')
if (Object.keys(stage01InventoryCurrentCanonicalR16.changes || {}).join(',') !== 'listInventory') throw new Error('Stage01 inventory current canonical identity R16 Worker allow-list widened')
patched = 'const stage01InventoryCurrentCanonicalR16Changes = ' + JSON.stringify(stage01InventoryCurrentCanonicalR16.changes || {}) + '\n' + patched

const stage01InventoryCurrentCanonicalNormalizeAnchor = '  const removedNames = Object.keys(removed)\n'
if (!patched.includes(stage01InventoryCurrentCanonicalNormalizeAnchor)) throw new Error('Stage01 inventory current canonical identity R16 normalization anchor missing')
const stage01InventoryCurrentCanonicalNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01InventoryCurrentCanonicalR16Changes)) {',
  "    check(declarations.has(name), 'Stage01 inventory current canonical identity R16 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 inventory current canonical identity R16 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 inventory current canonical identity R16 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01InventoryCurrentCanonicalNormalizeAnchor, stage01InventoryCurrentCanonicalNormalizeBlock + stage01InventoryCurrentCanonicalNormalizeAnchor)

const stage01KnownIntakeCurrentCanonicalR17 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-known-intake-current-canonical-identity-r17-worker-manifest.json'), 'utf8'))
if (stage01KnownIntakeCurrentCanonicalR17.version !== 1 || stage01KnownIntakeCurrentCanonicalR17.revision !== 'stage01-known-intake-current-canonical-identity-r17') throw new Error('Stage01 known-intake current canonical identity R17 Worker manifest invalid')
if (Object.keys(stage01KnownIntakeCurrentCanonicalR17.changes || {}).join(',') !== 'getWarehouseAttentionSummary') throw new Error('Stage01 known-intake current canonical identity R17 Worker allow-list widened')
patched = 'const stage01KnownIntakeCurrentCanonicalR17Changes = ' + JSON.stringify(stage01KnownIntakeCurrentCanonicalR17.changes || {}) + '\n' + patched

// R17 changes the same Warehouse Attention declaration that R11 touched earlier.
// Normalize the newest whole-declaration layer before R11 rewinds its older nested SQL delta.
const stage01KnownIntakeCurrentCanonicalNormalizeAnchor = '  for (const [name, change] of Object.entries(stage01PendingLifecycleR11Changes)) {'
if (!patched.includes(stage01KnownIntakeCurrentCanonicalNormalizeAnchor)) throw new Error('Stage01 known-intake current canonical identity R17 predecessor anchor missing')
const stage01KnownIntakeCurrentCanonicalNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01KnownIntakeCurrentCanonicalR17Changes)) {',
  "    check(declarations.has(name), 'Stage01 known-intake current canonical identity R17 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 known-intake current canonical identity R17 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 known-intake current canonical identity R17 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01KnownIntakeCurrentCanonicalNormalizeAnchor, stage01KnownIntakeCurrentCanonicalNormalizeBlock + stage01KnownIntakeCurrentCanonicalNormalizeAnchor)

const stage01MoneyOnlyReturnShippingR19B = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-money-only-return-shipping-r19b-worker-manifest.json'), 'utf8'))
if (stage01MoneyOnlyReturnShippingR19B.version !== 1 || stage01MoneyOnlyReturnShippingR19B.revision !== 'stage01-money-only-return-shipping-r19b') throw new Error('Stage01 money-only Return shipping R19B Worker manifest invalid')
if (Object.keys(stage01MoneyOnlyReturnShippingR19B.changes || {}).sort().join(',') !== 'fetchOrderRelations,getOrder,listOrders') throw new Error('Stage01 money-only Return shipping R19B Worker allow-list widened')
patched = 'const stage01MoneyOnlyReturnShippingR19BChanges = ' + JSON.stringify(stage01MoneyOnlyReturnShippingR19B.changes || {}) + '\n' + patched

const stage01ReturnExchangeDownstreamR19 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-return-exchange-downstream-semantics-r19-worker-manifest.json'), 'utf8'))
if (stage01ReturnExchangeDownstreamR19.version !== 1 || stage01ReturnExchangeDownstreamR19.revision !== 'stage01-return-exchange-downstream-semantics-r19') throw new Error('Stage01 Return/Exchange downstream R19 Worker manifest invalid')
if (Object.keys(stage01ReturnExchangeDownstreamR19.changes || {}).sort().join(',') !== 'fetchOrderRelations,getOrder,listOrders') throw new Error('Stage01 Return/Exchange downstream R19 Worker allow-list widened')
patched = 'const stage01ReturnExchangeDownstreamR19Changes = ' + JSON.stringify(stage01ReturnExchangeDownstreamR19.changes || {}) + '\n' + patched

const stage01FoundStockCurrentCanonicalR18 = JSON.parse(fs.readFileSync(path.join(root, 'scripts/stage01-found-stock-current-canonical-identity-r18-worker-manifest.json'), 'utf8'))
if (stage01FoundStockCurrentCanonicalR18.version !== 1 || stage01FoundStockCurrentCanonicalR18.revision !== 'stage01-found-stock-current-canonical-identity-r18') throw new Error('Stage01 found-stock current canonical identity R18 Worker manifest invalid')
if (Object.keys(stage01FoundStockCurrentCanonicalR18.changes || {}).join(',') !== 'getWarehouseAttentionSummary') throw new Error('Stage01 found-stock current canonical identity R18 Worker allow-list widened')
patched = 'const stage01FoundStockCurrentCanonicalR18Changes = ' + JSON.stringify(stage01FoundStockCurrentCanonicalR18.changes || {}) + '\n' + patched

// R18 is newer than R17 and changes the same Warehouse Attention declaration.
// Replay it first, then let R17 and R11 unwind their predecessor layers.
const stage01FoundStockCurrentCanonicalNormalizeAnchor = '  for (const [name, change] of Object.entries(stage01KnownIntakeCurrentCanonicalR17Changes)) {'
if (!patched.includes(stage01FoundStockCurrentCanonicalNormalizeAnchor)) throw new Error('Stage01 found-stock current canonical identity R18 predecessor anchor missing')
const stage01FoundStockCurrentCanonicalNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01FoundStockCurrentCanonicalR18Changes)) {',
  "    check(declarations.has(name), 'Stage01 found-stock current canonical identity R18 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 found-stock current canonical identity R18 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 found-stock current canonical identity R18 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01FoundStockCurrentCanonicalNormalizeAnchor, stage01FoundStockCurrentCanonicalNormalizeBlock + stage01FoundStockCurrentCanonicalNormalizeAnchor)

// R19 is the newest Worker layer for order relation/readback declarations. Normalize it
// before the older Stage01 layers so the legacy structural hashes still see their predecessor text.
const stage01ReturnExchangeDownstreamNormalizeAnchor = '  for (const [name, change] of Object.entries(stage01FoundStockCurrentCanonicalR18Changes)) {'
if (!patched.includes(stage01ReturnExchangeDownstreamNormalizeAnchor)) throw new Error('Stage01 Return/Exchange downstream R19 predecessor anchor missing')
const stage01ReturnExchangeDownstreamNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01ReturnExchangeDownstreamR19Changes)) {',
  "    check(declarations.has(name), 'Stage01 Return/Exchange downstream R19 declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 Return/Exchange downstream R19 exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 Return/Exchange downstream R19 exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01ReturnExchangeDownstreamNormalizeAnchor, stage01ReturnExchangeDownstreamNormalizeBlock + stage01ReturnExchangeDownstreamNormalizeAnchor)

// R19B is newer than R19 on the same order relation/readback declarations.
const stage01MoneyOnlyReturnShippingNormalizeAnchor = '  for (const [name, change] of Object.entries(stage01ReturnExchangeDownstreamR19Changes)) {'
if (!patched.includes(stage01MoneyOnlyReturnShippingNormalizeAnchor)) throw new Error('Stage01 money-only Return shipping R19B predecessor anchor missing')
const stage01MoneyOnlyReturnShippingNormalizeBlock = [
  '  for (const [name, change] of Object.entries(stage01MoneyOnlyReturnShippingR19BChanges)) {',
  "    check(declarations.has(name), 'Stage01 money-only Return shipping R19B declaration missing: ' + name)",
  '    const current = declarations.get(name)',
  "    check(current.includes(change.afterBlock), 'Stage01 money-only Return shipping R19B exact after-block missing: ' + name)",
  '    const reverted = current.replace(change.afterBlock, change.beforeBlock)',
  "    check(reverted !== current, 'Stage01 money-only Return shipping R19B exact replacement did not apply: ' + name)",
  '    declarations.set(name, reverted)',
  '  }',
  '',
].join('\n')
patched = patched.replace(stage01MoneyOnlyReturnShippingNormalizeAnchor, stage01MoneyOnlyReturnShippingNormalizeBlock + stage01MoneyOnlyReturnShippingNormalizeAnchor)


fs.writeFileSync(legacyPath, patched)
try {
  await import('./test-step1906a-worker-modularization-w6-layer.mjs')
} finally {
  fs.writeFileSync(legacyPath, original)
}

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const gitBlob = (value) => {
  const bytes = Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

const root = process.cwd()

const kaspiWorkshopInvoiceR1RuntimeManifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/kaspi-workshop-invoice-r1-runtime-manifest.json'), 'utf8'))
check(kaspiWorkshopInvoiceR1RuntimeManifest?.version === 1 && kaspiWorkshopInvoiceR1RuntimeManifest?.revision === 'kaspi-workshop-invoice-r1', 'Kaspi Workshop invoice R1 runtime manifest invalid')
if (!process.env.KASPI_WORKSHOP_INVOICE_R1_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(kaspiWorkshopInvoiceR1RuntimeManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Kaspi Workshop invoice R1 runtime drifted before Branch2/main sync check: ' + relative)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Kaspi Workshop invoice R1 predecessor fixture drifted: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true, env: { ...process.env, KASPI_WORKSHOP_INVOICE_R1_BRANCH2_MAIN_SYNC_NORMALIZED: '1' } })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('KASPI WORKSHOP INVOICE R1 — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const kaspiMainParityRuntimeManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/kaspi-main-parity-20261007-frontend-manifest.json'), 'utf8'),
)
check(
  kaspiMainParityRuntimeManifest?.version === 1 && kaspiMainParityRuntimeManifest?.revision === 'kaspi-main-parity-20261007-frontend',
  'Kaspi main parity runtime manifest invalid',
)
if (!process.env.KASPI_MAIN_PARITY_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(kaspiMainParityRuntimeManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Kaspi main parity runtime drifted before Branch2/main sync check: ' + relative)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Kaspi main parity predecessor fixture drifted: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, KASPI_MAIN_PARITY_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('KASPI MAIN PARITY — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const kaspiCreateTabRuntimeManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/kaspi-create-tab-ux-20261007-frontend-manifest.json'), 'utf8'),
)
check(
  kaspiCreateTabRuntimeManifest?.version === 1 && kaspiCreateTabRuntimeManifest?.revision === 'kaspi-create-tab-ux-20261007-frontend',
  'Kaspi Create tab runtime manifest invalid',
)
if (!process.env.KASPI_CREATE_TAB_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(kaspiCreateTabRuntimeManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Kaspi Create tab runtime drifted before Branch2/main sync check: ' + relative)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Kaspi Create tab predecessor fixture drifted: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, KASPI_CREATE_TAB_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('KASPI CREATE TAB — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const kaspiR2AuditRuntimeManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/kaspi-r2-audit-20261007-frontend-manifest.json'), 'utf8'),
)
check(
  kaspiR2AuditRuntimeManifest?.version === 1 && kaspiR2AuditRuntimeManifest?.revision === 'kaspi-r2-audit-20261007-frontend',
  'Kaspi R2 audit runtime manifest invalid',
)
if (!process.env.KASPI_R2_AUDIT_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(kaspiR2AuditRuntimeManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Kaspi R2 audit runtime drifted before Branch2/main sync check: ' + relative)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Kaspi R2 audit predecessor fixture drifted: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, KASPI_R2_AUDIT_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('KASPI R2 AUDIT — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const kaspiSharedOrdersR2RuntimeManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/kaspi-shared-orders-r2-20261006-runtime-manifest.json'), 'utf8'),
)
check(
  kaspiSharedOrdersR2RuntimeManifest?.version === 1 && kaspiSharedOrdersR2RuntimeManifest?.revision === 'kaspi-shared-orders-r2-20261006-runtime',
  'Kaspi shared Orders R2 runtime manifest invalid',
)
if (!process.env.KASPI_SHARED_ORDERS_R2_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(kaspiSharedOrdersR2RuntimeManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Kaspi shared Orders R2 runtime drifted before Branch2/main sync check: ' + relative)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Kaspi shared Orders R2 predecessor fixture drifted: ' + relative)
      originals.set(relative, actual)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, KASPI_SHARED_ORDERS_R2_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('KASPI SHARED ORDERS R2 — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const arrivalAtomicManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/arrival-atomic-materialization-20261006-worker-manifest.json'), 'utf8'),
)
check(
  arrivalAtomicManifest?.version === 1 && arrivalAtomicManifest?.revision === 'arrival-atomic-materialization-20261006-worker',
  'Arrival atomic materialization runtime manifest invalid',
)
if (!process.env.ARRIVAL_ATOMIC_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const relative = 'worker/domains/inventory-movement.ts'
  const delta = arrivalAtomicManifest.files?.[relative]
  check(Boolean(delta), 'Arrival atomic materialization runtime manifest lost inventory-movement.ts')
  const absolute = path.join(root, relative)
  const actual = fs.readFileSync(absolute, 'utf8')
  check(gitBlob(actual) === delta.afterGitBlob, 'Arrival atomic materialization runtime drifted before Branch2/main sync check')
  const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
  check(gitBlob(baseline) === delta.beforeGitBlob, 'Arrival atomic materialization predecessor fixture drifted')
  fs.writeFileSync(absolute, baseline)
  let childStatus = 1
  try {
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, ARRIVAL_ATOMIC_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    fs.writeFileSync(absolute, actual)
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ARRIVAL ATOMIC MATERIALIZATION — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const arrivalChildAudienceManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/arrival-child-audience-20261006-runtime-manifest.json'), 'utf8'),
)
check(
  arrivalChildAudienceManifest?.version === 1 && arrivalChildAudienceManifest?.revision === 'arrival-child-audience-20261006-runtime',
  'Arrival child-audience runtime manifest invalid',
)
if (!process.env.ARRIVAL_CHILD_AUDIENCE_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(arrivalChildAudienceManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Arrival child-audience runtime drifted before Branch2/main sync check: ' + relative)
      originals.set(relative, actual)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Arrival child-audience predecessor fixture drifted: ' + relative)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, ARRIVAL_CHILD_AUDIENCE_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('ARRIVAL CHILD AUDIENCE — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const kaspiSeparationRuntimeManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/kaspi-order-separation-20261006-runtime-manifest.json'), 'utf8'),
)
check(
  kaspiSeparationRuntimeManifest?.version === 1 && kaspiSeparationRuntimeManifest?.revision === 'kaspi-order-separation-20261006-runtime',
  'Kaspi order separation runtime manifest invalid',
)
if (!process.env.KASPI_ORDER_SEPARATION_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(kaspiSeparationRuntimeManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Kaspi order separation runtime drifted before Branch2/main sync check: ' + relative)
      originals.set(relative, actual)
      if (delta.absentBefore) {
        fs.unlinkSync(absolute)
      } else {
        const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
        check(gitBlob(baseline) === delta.beforeGitBlob, 'Kaspi order separation predecessor fixture drifted: ' + relative)
        fs.writeFileSync(absolute, baseline)
      }
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, KASPI_ORDER_SEPARATION_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('KASPI ORDER SEPARATION — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const exchangeFinalAuditManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/exchange-final-audit-20261006-frontend-manifest.json'), 'utf8'),
)
check(
  exchangeFinalAuditManifest?.version === 1 && exchangeFinalAuditManifest?.revision === 'exchange-final-audit-20261006-frontend',
  'Exchange final audit frontend manifest invalid',
)
if (!process.env.EXCHANGE_FINAL_AUDIT_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(exchangeFinalAuditManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Exchange final audit runtime drifted before Branch2/main sync check: ' + relative)
      originals.set(relative, actual)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Exchange final audit predecessor fixture drifted: ' + relative)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, EXCHANGE_FINAL_AUDIT_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('EXCHANGE FINAL AUDIT — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const exchangeHumanUxManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/exchange-human-ux-20261006-frontend-manifest.json'), 'utf8'),
)
check(
  exchangeHumanUxManifest?.version === 1 && exchangeHumanUxManifest?.revision === 'exchange-human-ux-20261006-frontend',
  'Exchange human UX frontend manifest invalid',
)
if (!process.env.EXCHANGE_HUMAN_UX_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(exchangeHumanUxManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Exchange human UX runtime drifted before Branch2/main sync check: ' + relative)
      originals.set(relative, actual)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Exchange human UX predecessor fixture drifted: ' + relative)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, EXCHANGE_HUMAN_UX_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('EXCHANGE HUMAN UX — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const sourceDefaultManifests = [
  JSON.parse(fs.readFileSync(path.join(root, 'scripts/return-exchange-source-defaults-20261005-frontend-manifest.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(root, 'scripts/return-exchange-source-defaults-20261005-worker-manifest.json'), 'utf8')),
]
for (const manifest of sourceDefaultManifests) {
  check(manifest?.version === 1 && String(manifest?.revision || '').startsWith('return-exchange-source-defaults-20261005-'), 'Return/Exchange source-default manifest invalid')
}
if (!process.env.RETURN_EXCHANGE_SOURCE_DEFAULTS_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const manifest of sourceDefaultManifests) {
      for (const [relative, delta] of Object.entries(manifest.files || {})) {
        const absolute = path.join(root, relative)
        const actual = fs.readFileSync(absolute, 'utf8')
        check(gitBlob(actual) === delta.afterGitBlob, 'Return/Exchange source-default runtime drifted before Branch2/main sync check: ' + relative)
        originals.set(relative, actual)
        const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
        check(gitBlob(baseline) === delta.beforeGitBlob, 'Return/Exchange source-default predecessor fixture drifted: ' + relative)
        fs.writeFileSync(absolute, baseline)
      }
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, RETURN_EXCHANGE_SOURCE_DEFAULTS_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('RETURN / EXCHANGE SOURCE DEFAULTS — BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const returnSmartUxManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/return-smart-ux-20261005-frontend-manifest.json'), 'utf8'),
)
check(
  returnSmartUxManifest?.version === 1 && returnSmartUxManifest?.revision === 'return-smart-ux-20261005-frontend',
  'Return smart UX frontend manifest invalid',
)
if (!process.env.RETURN_SMART_UX_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(returnSmartUxManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Return smart UX runtime drifted before Branch2/main sync check: ' + relative)
      originals.set(relative, actual)
      if (delta.absentBefore) {
        fs.unlinkSync(absolute)
      } else {
        const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
        check(gitBlob(baseline) === delta.beforeGitBlob, 'Return smart UX predecessor fixture drifted: ' + relative)
        fs.writeFileSync(absolute, baseline)
      }
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, RETURN_SMART_UX_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('RETURN SMART UX / BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const returnAuditManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/return-ux-audit-20261005-runtime-manifest.json'), 'utf8'),
)
check(
  returnAuditManifest?.version === 1 && returnAuditManifest?.revision === 'return-ux-audit-20261005-runtime',
  'Return UX audit runtime manifest invalid',
)

if (!process.env.RETURN_UX_AUDIT_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const [relative, delta] of Object.entries(returnAuditManifest.files || {})) {
      const absolute = path.join(root, relative)
      const actual = fs.readFileSync(absolute, 'utf8')
      check(gitBlob(actual) === delta.afterGitBlob, 'Return UX audit runtime drifted before Branch2/main sync check: ' + relative)
      originals.set(relative, actual)
      const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
      check(gitBlob(baseline) === delta.beforeGitBlob, 'Return UX audit predecessor fixture drifted: ' + relative)
      fs.writeFileSync(absolute, baseline)
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, RETURN_UX_AUDIT_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('RETURN UX AUDIT / BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const exchangeSetManifests = [
  JSON.parse(fs.readFileSync(path.join(root, 'scripts/exchange-set-v2-20261005-frontend-manifest.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(root, 'scripts/exchange-set-v2-20261005-worker-manifest.json'), 'utf8')),
]
for (const manifest of exchangeSetManifests) {
  check(manifest?.version === 1 && String(manifest?.revision || '').startsWith('exchange-set-v2-20261005-'), 'Exchange Set V2 runtime manifest invalid')
}
if (!process.env.EXCHANGE_SET_V2_BRANCH2_MAIN_SYNC_NORMALIZED) {
  const originals = new Map()
  let childStatus = 1
  try {
    for (const manifest of exchangeSetManifests) {
      for (const [relative, delta] of Object.entries(manifest.files || {})) {
        const absolute = path.join(root, relative)
        const actual = fs.readFileSync(absolute, 'utf8')
        check(gitBlob(actual) === delta.afterGitBlob, 'Exchange Set V2 runtime drifted before Branch2/main sync check: ' + relative)
        originals.set(relative, actual)
        if (delta.absentBefore) {
          fs.unlinkSync(absolute)
        } else {
          const baseline = fs.readFileSync(path.join(root, delta.baselineFixture), 'utf8')
          check(gitBlob(baseline) === delta.beforeGitBlob, 'Exchange Set V2 predecessor fixture drifted: ' + relative)
          fs.writeFileSync(absolute, baseline)
        }
      }
    }
    const child = spawnSync(process.execPath, [process.argv[1]], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, EXCHANGE_SET_V2_BRANCH2_MAIN_SYNC_NORMALIZED: '1' },
    })
    if (child.error) throw child.error
    childStatus = child.status ?? 1
  } finally {
    for (const [relative, actual] of originals) {
      const absolute = path.join(root, relative)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, actual)
    }
  }
  if (childStatus !== 0) process.exit(childStatus)
  console.log('EXCHANGE SET V2 / BRANCH2 MAIN SYNC PRESERVATION LAYER PASSED')
  process.exit(0)
}

const exactMainRuntime = {
  'src/App.tsx': '9d32bcaa19458b4840bee7ea5e6f79526462ca7d',
  'src/app/controllers/useOperationalViewModel.ts': '656581b35dba35a376574c8e55b81c59ee3e75c8',
  'src/app/lazySections.tsx': 'fdfa9218e8aeb8ad5aee4c3b90f873d470e11d68',
  'src/app/types.ts': '8a5ac22fc94d59a0cc9cf623c9f328a4ae1842eb',
  'src/app/utils.ts': '23c574a853e5483cf94c37eb0afce67e47781034',
  'src/features/inventory/arrivalRecoveryFlow.ts': '7f55a363da332435e276d50abab11f1de3f310d2',
  'src/features/inventory/views/ArrivalRecoveryDialog.tsx': 'ad964ad6d68c092cf60c914ad5711c08cc9b9f32',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': 'dc89847d2bac17d53320c3e4097ce4fbfd35e27b',
  'src/features/sections/InventorySection.tsx': 'c3ba07c011ef9b68b5fa3cb0a52471851877eed8',
  'src/features/sections/OrderExchangeSection.tsx': '49ae4a303089c3481adc5b0d72980efd668e971f',
  'src/styles/192c-arrival-recovery.css': '37d2803edda7701a9c48b259ccce83c3df3c77e7',
  'worker/domains/catalog-retirement.ts': '0a12b6a8f0437085b708417911954ac26b50f993',
  'worker/domains/exchange-batch.ts': '725515005ad9e64d30e6eb2605f974c7947358e3',
  'worker/domains/inventory-movement.ts': '3cec27d490be5a7b6dfea57408bd8e3a1c4b4c59',
  'worker/domains/order-reservations.ts': 'b27726ebea9546120d1b75a6862bd77b9154714e',
  'worker/domains/orders-write.ts': 'db910492153aa5ed48b56285968aa7dc09d86e81',
  'worker/domains/returns-exchanges.ts': '5f3fb92b5383709e2791f4f6ddd7dc5d0ad29017',
  'worker/index.ts': '31262087815423d5ebd13f7b28cd0335ac75470d',
}

for (const [path, expected] of Object.entries(exactMainRuntime)) {
  check(gitBlob(read(path)) === expected, 'Branch2 runtime drifted from approved main file: ' + path)
}

const wrangler = read('wrangler.jsonc')
check(wrangler.includes('"name": "orders-app-branch2"'), 'Branch2 Worker identity was not preserved')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'Branch2 D1 logical name was not preserved')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'Branch2 D1 id was not preserved')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Production D1 identity leaked into Branch2')

const index = read('index.html')
check(index.includes('<title>Система заказов 2</title>'), 'Branch2 visual marker was lost')

const pkg = read('package.json')
check(pkg.includes('test-branch2-environment.mjs'), 'Branch2 environment regression disappeared')
check(pkg.includes('test-exchange-not-issued-r1.mjs'), 'Current exchange not-issued regression is not wired in Branch2')
check(pkg.includes('test-arrival-variant-integrity-r2.mjs') && pkg.includes('test-arrival-inline-recovery-ux.mjs') && pkg.includes('test-arrival-admin-only-r1.mjs'), 'Current Arrival regressions are not wired in Branch2')

console.log('BRANCH2 MAIN RUNTIME SYNC 20261005 PASSED — current main runtime is exact while Branch2 Worker/D1 identity, title marker and environment regression remain isolated')

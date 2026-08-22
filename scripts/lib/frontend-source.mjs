import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readIfExists(relative) {
  const file = path.join(root, relative)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function readTree(relativeDir) {
  const dir = path.join(root, relativeDir)
  if (!fs.existsSync(dir)) return ''
  const files = []
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  walk(dir)
  return files.sort().map((file) => fs.readFileSync(file, 'utf8')).join('\n\n')
}

export function readAppControllerSource() {
  return [
    readIfExists('src/App.tsx'),
    readTree('src/app/controllers'),
    readIfExists('src/features/export/documentExport.ts'),
    readIfExists('src/features/inventory/inventoryDraftFactories.ts'),
  ].join('\n\n')
}

export function readInventorySource() {
  return [
    readIfExists('src/features/sections/InventorySection.tsx'),
    readTree('src/features/inventory/views'),
  ].join('\n\n')
}

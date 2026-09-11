import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()
const testPath = path.join(root, 'scripts/test-step1906c-dead-code-cleanup.mjs')
const migrationRelative = 'migrations/0068_v72_catalog_product_gender_scope.sql'
const migrationPath = path.join(root, migrationRelative)
const manifestPath = path.join(root, 'scripts/catalog-gender-scope-r1-migration-manifest.json')
const gitBlobSha = (text) => {
  const bytes = Buffer.from(text)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}

const migration = fs.readFileSync(migrationPath, 'utf8')
fs.writeFileSync(manifestPath, JSON.stringify({
  version: 1,
  revision: 'catalog-gender-scope-r1',
  file: migrationRelative,
  gitBlob: gitBlobSha(migration),
}, null, 2) + '\n')

let source = fs.readFileSync(testPath, 'utf8')
const anchor = "  acceptedAdditiveMigrations.push('0067_v72_o1_read_budget_indexes.sql')\n"
if (!source.includes(anchor)) throw new Error('1906C accepted-migration anchor missing')
if (!source.includes("0068_v72_catalog_product_gender_scope.sql")) {
  source = source.replace(anchor, anchor + "  acceptedAdditiveMigrations.push('0068_v72_catalog_product_gender_scope.sql')\n")
}
const checkAnchor = "  for (const name of acceptedAdditiveMigrations) check(migrationFiles.includes(name), `Accepted additive migration missing: ${name}`)\n"
if (!source.includes(checkAnchor)) throw new Error('1906C migration-check anchor missing')
const exactCheck = `  const catalogGenderMigrationManifest = JSON.parse(read('scripts/catalog-gender-scope-r1-migration-manifest.json'))\n  check(catalogGenderMigrationManifest?.version === 1 && catalogGenderMigrationManifest?.revision === 'catalog-gender-scope-r1', 'Catalog gender migration manifest invalid')\n  check(catalogGenderMigrationManifest.file === 'migrations/0068_v72_catalog_product_gender_scope.sql', 'Catalog gender migration manifest file widened unexpectedly')\n  const catalogGenderMigrationBytes = Buffer.from(read(catalogGenderMigrationManifest.file))\n  const catalogGenderMigrationGitBlob = crypto.createHash('sha1').update(Buffer.from('blob ' + catalogGenderMigrationBytes.length + '\\0')).update(catalogGenderMigrationBytes).digest('hex')\n  check(catalogGenderMigrationGitBlob === catalogGenderMigrationManifest.gitBlob, 'Accepted catalog gender migration changed beyond exact manifest')\n`
if (!source.includes('Catalog gender migration manifest invalid')) source = source.replace(checkAnchor, checkAnchor + exactCheck)
fs.writeFileSync(testPath, source)
console.log('1906C migration history layered for exact 0068 catalog gender migration.')

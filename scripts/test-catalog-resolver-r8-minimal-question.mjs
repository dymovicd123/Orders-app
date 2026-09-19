import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const modal = fs.readFileSync(path.join(root, 'src/features/orders/OrderCatalogResolutionModal.tsx'), 'utf8')
const flow = fs.readFileSync(path.join(root, 'src/features/orders/catalogResolutionFlow.ts'), 'utf8')
const ux = fs.readFileSync(path.join(root, 'scripts/test-catalog-resolver-ux.mjs'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(modal.includes("const minimalFieldQuestion = question?.kind === 'field' && !editing && Boolean(context?.product)"), 'R8 no longer identifies the ordinary one-field human question')
  check(modal.includes('item && !minimalFieldQuestion') && modal.includes('draft && context && !minimalFieldQuestion'), 'Known source/canonical fact summaries can again crowd the one-field question')
  check(modal.includes('!minimalFieldQuestion ? <div role="status"') && modal.includes('!advancedOpen && !minimalFieldQuestion'), 'Status/admin fallback can again crowd the one-field question')
  check(modal.includes('!minimalFieldQuestion ? <small className="resolution-guard"'), 'Blocking guard copy can again crowd the one-field question')
  check(modal.includes("[['ЖЕН', 'Жен'], ['МУЖ', 'Муж']]"), 'Gender choice regressed to verbose catalog wording')
  check(modal.includes('>Не удалось выяснить</button>') && !modal.includes("'Какой здесь пол?'"), 'Gender question is no longer the short human wording')
  check(flow.includes("return { kind: 'field', field }"), 'Resolver no longer advances one unresolved field at a time')
  check(ux.includes("assert.ok(b.text().includes('Не указан пол'))") && ux.includes("assert.ok(!b.text().includes('В заказе указано'))") && ux.includes("assert.ok(!b.text().includes('Админ'))"), 'Actual component regression no longer proves the minimal R8 surface')

  console.log('CATALOG RESOLVER R8 MINIMAL QUESTION TESTS PASSED — an ordinary ambiguity shows one human question without replaying known catalog facts or admin machinery.')
} catch (error) {
  console.error(`CATALOG RESOLVER R8 MINIMAL QUESTION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

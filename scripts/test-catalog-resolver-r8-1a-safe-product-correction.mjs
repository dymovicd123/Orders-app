import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const modal = fs.readFileSync(path.join(root, 'src/features/orders/OrderCatalogResolutionModal.tsx'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(modal.includes('>Весь каталог</button>'), 'Unknown product lost the existing-catalog fallback')
  check(modal.includes('onClick={() => void openAdvanced()}>Весь каталог</button>'), 'Existing-catalog review accidentally enters create-product mode')
  check(modal.includes('onClick={() => void openAdvanced(true)}>Новый товар</button>'), 'Explicit direct create-new-product action disappeared')
  check(modal.includes("{draft.createProduct ? <>"), 'New-product path is no longer a separate focused branch')
  check(modal.includes('Название нового товара') && modal.includes('Для кого'), 'New-product branch lost its minimal editable identity fields')
  check(modal.includes('Характеристики из заказа'), 'Known order characteristics are not shown as context in new-product branch')
  check(modal.includes('Нет, это существующий товар'), 'New-product branch lost its escape back to existing catalog')
  check(modal.includes('>Другой вариант</button>'), 'Unknown reference values no longer lead with choosing an existing dictionary value before accepting a new one')

  console.log('CATALOG RESOLVER R8.1A SAFE PRODUCT CORRECTION TESTS PASSED — existing suggestions stay available, while explicit new-product creation is focused and non-redundant.')
} catch (error) {
  console.error(`CATALOG RESOLVER R8.1A SAFE PRODUCT CORRECTION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

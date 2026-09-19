import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const modal = fs.readFileSync(path.join(root, 'src/features/orders/OrderCatalogResolutionModal.tsx'), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  check(modal.includes('>Проверить весь каталог</button>'), 'Unknown product no longer leads with existing-catalog review')
  check(modal.includes('onClick={() => void openAdvanced()}>Проверить весь каталог</button>'), 'Existing-catalog review accidentally enters create-product mode')
  check(!modal.includes('openAdvanced(true)}>Такого товара нет</button>'), 'Unknown product still defaults directly to product creation')
  check(modal.includes("{draft.createProduct ? 'Выбрать существующий товар' : 'Создать новый товар'}"), 'Explicit create-new-product action disappeared from advanced correction')
  check(modal.includes('>Исправить / выбрать существующее</button>'), 'Unknown reference values no longer lead with correction before accepting a new dictionary value')

  console.log('CATALOG RESOLVER R8.1A SAFE PRODUCT CORRECTION TESTS PASSED — existing catalog review is the default admin path; new product creation stays explicit.')
} catch (error) {
  console.error(`CATALOG RESOLVER R8.1A SAFE PRODUCT CORRECTION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}

from pathlib import Path
import hashlib
import json

modal_path = Path('src/features/orders/OrderCatalogResolutionModal.tsx')
modal = modal_path.read_text(encoding='utf-8')

old_load = "  const load = async () => {"
new_load = "  const load = async (completeWhenEmpty = false) => {"
if modal.count(old_load) != 1:
    raise SystemExit(f'Expected exactly one load anchor, got {modal.count(old_load)}')
modal = modal.replace(old_load, new_load, 1)

old_empty = """      if (!first) {
        setContext(null)
        setDraft(null)
        setSelectedVariantId(0)
        await onCompleted(order)
        return
      }"""
new_empty = """      if (!first) {
        setContext(null)
        setDraft(null)
        setSelectedVariantId(0)
        if (completeWhenEmpty) {
          await onCompleted(order)
        } else {
          setError('Список позиций для разбора вернулся пустым. Окно оставлено открытым: автоматическое закрытие до действия пользователя запрещено. Закройте его вручную и повторите отправку, если позиция всё ещё блокирует заказ.')
        }
        return
      }"""
if modal.count(old_empty) != 1:
    raise SystemExit(f'Expected exactly one empty-review anchor, got {modal.count(old_empty)}')
modal = modal.replace(old_empty, new_empty, 1)

old_after_resolve = "      await load()"
resolve_count = modal.count(old_after_resolve)
if resolve_count != 2:
    raise SystemExit(f'Expected exactly two post-resolution reloads, got {resolve_count}')
modal = modal.replace(old_after_resolve, "      await load(true)")
modal_path.write_text(modal, encoding='utf-8')

# Extend the permanent regression test with the lifecycle invariant.
test_path = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
test = test_path.read_text(encoding='utf-8')
anchor = "  check(modal.includes('Отправить заказ в обход этой проверки нельзя'), 'Resolver must not add a send-anyway bypass')\n"
addition = anchor + "  check(modal.includes('const load = async (completeWhenEmpty = false)'), 'Resolver initial load must distinguish passive open from post-resolution completion')\n  check(modal.includes('if (completeWhenEmpty)'), 'Resolver must never auto-complete from an empty initial review response')\n  check((modal.match(/await load\\(true\\)/g) || []).length === 2, 'Resolver may auto-complete only after the two explicit successful resolution actions')\n  check(modal.includes('void load()'), 'Resolver initial open must remain a non-completing load')\n"
if test.count(anchor) != 1:
    raise SystemExit(f'Expected exactly one regression anchor, got {test.count(anchor)}')
test = test.replace(anchor, addition, 1)
test_path.write_text(test, encoding='utf-8')

# Update the exact frontend preservation manifest only for the modal blob/line count.
manifest_path = Path('scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
entry = manifest['files']['src/features/orders/OrderCatalogResolutionModal.tsx']
raw = modal_path.read_bytes()
header = f'blob {len(raw)}\0'.encode('utf-8')
entry['afterGitBlob'] = hashlib.sha1(header + raw).hexdigest()
entry['afterLines'] = modal.count('\n') + 1
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('catalog resolution modal lifecycle patch applied')
print(entry)

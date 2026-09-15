from pathlib import Path
import json
import subprocess


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, got {count}')
    return text.replace(old, new, 1)

modal_path = Path('src/features/orders/OrderCatalogResolutionModal.tsx')
modal = modal_path.read_text(encoding='utf-8')
modal = replace_once(
    modal,
    "function itemLabel(item: CatalogReviewItem) {\n  return [item.gender, item.color, item.material, item.length, item.size]\n    .map(clean)\n    .filter(Boolean)\n    .join(' · ')\n}\n\n",
    "",
    'unused itemLabel helper',
)
modal = replace_once(
    modal,
    "  const issueText = context?.issueType === 'exact_existing'\n    ? 'Точная комбинация уже существует — можно связать её одним действием.'\n    : context?.issueType === 'unknown_product'\n      ? 'Базовый товар не определён. Система может предложить совпадение, но окончательное решение остаётся за человеком.'\n      : context?.issueType === 'unknown_attribute'\n        ? 'Товар известен, но хотя бы одна характеристика неоднозначна. Все поля ниже можно исправить.'\n        : 'Существующей точной комбинации нет. Проверьте каждый факт и при необходимости создайте новую комбинацию.'\n\n",
    "",
    'unused issueText copy',
)
modal_path.write_text(modal, encoding='utf-8')

manifest_path = Path('scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
path = 'src/features/orders/OrderCatalogResolutionModal.tsx'
text = modal_path.read_text(encoding='utf-8')
manifest['files'][path]['afterGitBlob'] = subprocess.check_output(['git', 'hash-object', path], text=True).strip()
manifest['files'][path]['afterLines'] = len(text.split('\n'))
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('unused resolver declarations removed and frontend manifest refreshed')

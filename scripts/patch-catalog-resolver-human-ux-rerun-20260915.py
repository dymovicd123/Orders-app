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
    "            </details>\n          </>\n        ) : null}\n",
    "            </details>\n            <div className=\"order-catalog-resolution-guard\">Без уточнения отправить заказ нельзя.</div>\n          </>\n        ) : null}\n",
    'human safety note',
)
modal_path.write_text(modal, encoding='utf-8')

css_path = Path('src/features/orders/OrderCatalogResolutionModal.css')
css = css_path.read_text(encoding='utf-8')
css = replace_once(
    css,
    ".order-catalog-resolution-done {\n  display: grid;\n  gap: 4px;\n}\n",
    ".order-catalog-resolution-guard {\n  margin-top: 9px;\n  color: var(--muted-color, #667085);\n  font-size: 11px;\n  text-align: center;\n}\n\n.order-catalog-resolution-done {\n  display: grid;\n  gap: 4px;\n}\n",
    'safety note style',
)
css_path.write_text(css, encoding='utf-8')

test_path = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
test = test_path.read_text(encoding='utf-8')
test = replace_once(
    test,
    "  check(modal.includes('Отправить заказ в обход этой проверки нельзя'), 'Resolver must not add a send-anyway bypass')\n",
    "  check(modal.includes('Без уточнения отправить заказ нельзя'), 'Resolver must keep the no-bypass safety rule in human language')\n",
    'no bypass regression copy',
)
test_path.write_text(test, encoding='utf-8')

manifest_path = Path('scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for path in ['src/features/orders/OrderCatalogResolutionModal.tsx', 'src/features/orders/OrderCatalogResolutionModal.css']:
    text = Path(path).read_text(encoding='utf-8')
    manifest['files'][path]['afterGitBlob'] = subprocess.check_output(['git', 'hash-object', path], text=True).strip()
    # Match JS actual.split(/\r?\n/).length exactly, including the final empty segment after a trailing newline.
    manifest['files'][path]['afterLines'] = len(text.replace('\r\n', '\n').split('\n'))
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('human resolver safety copy aligned')

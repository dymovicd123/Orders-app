from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
overview_path = ROOT / 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
manifest_path = ROOT / 'scripts/w8-1-stock-overview-frontend-manifest.json'
text = overview_path.read_text(encoding='utf-8')
old = """                                                  <strong>{colorPhysical < 0 ? 'Сверить' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>\n                                                  <span>свободно</span>"""
new = """                                                  <strong>{colorPhysical < 0 ? 'Сверить' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>\n                                                  <span>свободно · на месте {formatMoney(colorPhysical)}{colorReserved > 0 ? ` · в заказах ${formatMoney(colorReserved)}` : ''}</span>"""
if text.count(old) != 1:
    raise RuntimeError(f'expected one color summary anchor, found {text.count(old)}')
text = text.replace(old, new, 1)
overview_path.write_text(text, encoding='utf-8')
body = text.encode('utf-8')
after = hashlib.sha1(f'blob {len(body)}\0'.encode('utf-8') + body).hexdigest()
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['files']['src/features/inventory/views/renderInventoryOverviewPanel.tsx']['afterGitBlob'] = after
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('W8.1 color summary fixed; overview after blob:', after)

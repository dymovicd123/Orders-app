from pathlib import Path

path = Path('worker/domains/order-delete.ts')
text = path.read_text()
old = "    actor,\n    checkedBy,\n"
new = "    actor ?? null,\n    checkedBy,\n"
if text.count(old) != 1:
    raise SystemExit(f'actor anchor changed: {text.count(old)}')
path.write_text(text.replace(old, new, 1))
print('order delete actor normalized to null')

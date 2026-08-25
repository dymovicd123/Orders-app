from pathlib import Path

path = Path('scripts/release-check.mjs')
text = path.read_text(encoding='utf-8')

old = "    'scripts/test-finance-f5-adjacent-regression.mjs',\n"
new = old + "    'scripts/test-finance-f6-release-audit.mjs',\n"
if text.count(old) != 1:
    raise SystemExit(f'F6 source-list marker count={text.count(old)}')
text = text.replace(old, new, 1)

old = "  run('Finance F5 adjacent finance/cash regression', process.execPath, [path.join(root, 'scripts/test-finance-f5-adjacent-regression.mjs')])\n"
new = old + "  run('Finance F6 aggregate release audit', process.execPath, [path.join(root, 'scripts/test-finance-f6-release-audit.mjs')])\n"
if text.count(old) != 1:
    raise SystemExit(f'F6 run marker count={text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Finance F6 release gate wired')

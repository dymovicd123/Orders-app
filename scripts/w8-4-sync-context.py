from pathlib import Path

path = Path('docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md')
text = path.read_text(encoding='utf-8')
title = '## Checkpoint 2026-09-06 — W8.4 final mobile acceptance / W8 closure'
marker = '## Checkpoint 2026-09-06 — W8.3 remaining daily Warehouse surfaces polish'
checkpoint = '''## Checkpoint 2026-09-06 — W8.4 final mobile acceptance / W8 closure

W8.4 closes the W8 interface work unless a concrete Production defect appears. The final mobile gap was in `Операции`: transfer already used phone cards, while `Списание` and `Исправить количество` still inherited a 660px desktop table. W8.4 makes those two rare modes readable/touch-safe on <=760px without changing their mutation logic, and keeps Arrival outside the new selectors.

The final audit also found one integration defect from W8.3: `w8-3-daily-surfaces.css` existed but was not imported by the Warehouse bundle. W8.4 fixes that import chain and adds a regression check so W8.3 History/Attention styling cannot silently become dead CSS again.

No Worker/API/D1/migration/stock-math/Arrival/Branch2 change is part of W8.4. Dedicated validation passed cumulative release checks, database safety, production build, lint and Wrangler dry-run. After merge/deploy, the next Warehouse phase is **W9 — full read-only Warehouse audit and discussion before another broad implementation wave**.

---

'''

if title not in text:
    if marker not in text:
        raise SystemExit('W8.3 checkpoint marker not found')
    path.write_text(text.replace(marker, checkpoint + marker, 1), encoding='utf-8')

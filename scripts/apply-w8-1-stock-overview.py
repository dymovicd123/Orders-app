from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = "ed889662e9d6dc0fc5fdfdd95943bb5641a8db5b"
OVERVIEW_REL = "src/features/inventory/views/renderInventoryOverviewPanel.tsx"
CSS_REL = "src/styles/w8-1-stock-overview.css"
FIXTURE_REL = "scripts/fixtures/renderInventoryOverviewPanel-w7-baseline.tsx"
MANIFEST_REL = "scripts/w8-1-stock-overview-frontend-manifest.json"
LAYER_REL = "scripts/test-step1906b-frontend-modularization-w8-layer.mjs"
TEST_REL = "scripts/test-w8-1-stock-overview-completion.mjs"
DOC_REL = "docs/continuation/W8_1_STOCK_OVERVIEW_COMPLETION_20260906.md"


def blob_sha(text: str) -> str:
    body = text.encode("utf-8")
    return hashlib.sha1(f"blob {len(body)}\0".encode("utf-8") + body).hexdigest()


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected exactly one occurrence, found {count}: {old[:120]!r}")
    return text.replace(old, new, 1)


subprocess.run(["git", "fetch", "origin", BASE_SHA, "--depth=1"], cwd=ROOT, check=True)
baseline = subprocess.check_output(["git", "show", f"{BASE_SHA}:{OVERVIEW_REL}"], cwd=ROOT).decode("utf-8")
current = (ROOT / OVERVIEW_REL).read_text(encoding="utf-8")
if current != baseline:
    raise RuntimeError("W8.1 helper expected untouched W7 overview baseline")

# Keep the W8 visual layer owned by the overview module so InventorySection and its hook/preservation
# boundary do not need to change for a presentation-only completion pass.
current = replace_once(
    current,
    "import type { InventoryRenderContext } from './types'\n",
    "import type { InventoryRenderContext } from './types'\nimport '../../../styles/w8-1-stock-overview.css'\n",
)

helpers = r'''

const w8Text = (value: unknown) => String(value || '').trim()
const w8Key = (value: unknown) => w8Text(value).toLocaleUpperCase('ru-RU') || 'СТАНДАРТ'
const w8Plural = (value: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(value)
  const lastTwo = absolute % 100
  const last = absolute % 10
  if (lastTwo >= 11 && lastTwo <= 19) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

function buildStockBrowseHierarchy(rows: any[], getCategory: (row: any) => string) {
  const executions = new Map<string, any>()
  for (const row of rows) {
    const material = w8Text(row.material) || 'СТАНДАРТ'
    const length = w8Text(row.length) || 'СТАНДАРТ'
    const executionKey = `${w8Key(material)}¦${w8Key(length)}`
    const executionLabel = w8Key(material) === 'СТАНДАРТ' && w8Key(length) === 'СТАНДАРТ'
      ? 'Основное исполнение'
      : [material !== 'СТАНДАРТ' ? material : '', length !== 'СТАНДАРТ' ? length : ''].filter(Boolean).join(' · ') || 'Основное исполнение'
    if (!executions.has(executionKey)) executions.set(executionKey, { key: executionKey, label: executionLabel, rows: [], colors: new Map<string, any>() })
    const execution = executions.get(executionKey)!
    execution.rows.push(row)

    const color = w8Text(row.color) || 'Цвет не указан'
    const colorKey = w8Key(color)
    if (!execution.colors.has(colorKey)) execution.colors.set(colorKey, { key: colorKey, label: color, rows: [], subgroups: new Map<string, any>() })
    const colorGroup = execution.colors.get(colorKey)!
    colorGroup.rows.push(row)

    const category = getCategory(row) || 'adult'
    const gender = w8Text(row.gender) || 'Пол не указан'
    const subgroupKey = `${category}¦${w8Key(gender)}`
    if (!colorGroup.subgroups.has(subgroupKey)) colorGroup.subgroups.set(subgroupKey, { key: subgroupKey, category, gender, rows: [] })
    colorGroup.subgroups.get(subgroupKey)!.rows.push(row)
  }

  return Array.from(executions.values()).map((execution: any) => ({
    ...execution,
    colors: Array.from(execution.colors.values()).map((color: any) => ({
      ...color,
      subgroups: Array.from(color.subgroups.values()).map((subgroup: any) => ({
        ...subgroup,
        rows: [...subgroup.rows].sort((a: any, b: any) => w8Text(a.size).localeCompare(w8Text(b.size), 'ru', { numeric: true })),
      })).sort((a: any, b: any) => a.category.localeCompare(b.category) || a.gender.localeCompare(b.gender, 'ru')),
    })).sort((a: any, b: any) => a.label.localeCompare(b.label, 'ru', { numeric: true })),
  })).sort((a: any, b: any) => (a.label === 'Основное исполнение' ? -1 : b.label === 'Основное исполнение' ? 1 : a.label.localeCompare(b.label, 'ru', { numeric: true })))
}
'''
current = replace_once(current, ">\n\n\nfunction renderRoutineCycleCountCue", ">" + helpers + "\nfunction renderRoutineCycleCountCue")

metrics = r'''

  const visibleVariantCount = simpleStockGroups.reduce((sum: number, group: any) => sum + Number((group.rows || []).length), 0)
  const resultScopeLabel = inventoryQuery.trim()
    ? `Поиск: «${inventoryQuery.trim()}»`
    : simpleStockAvailabilityFilter === 'free'
      ? 'Только позиции со свободным остатком'
      : simpleStockAvailabilityFilter === 'reserved'
        ? 'Только позиции в заказах'
        : simpleStockAvailabilityFilter === 'attention'
          ? 'Только позиции, требующие сверки'
          : 'Все позиции с остатком'
'''
current = replace_once(current, "  const microCheckDetailRow = (detail: any) => ({\n", "  const microCheckDetailRow = (detail: any) => ({\n")
anchor = "  })\n\n  return (\n    <div className=\"inventory-overview-panel inventory-calm-stock\""
if current.count(anchor) != 1:
    raise RuntimeError("W8.1 metrics insertion anchor not unique")
current = current.replace(anchor, "  })" + metrics + "\n  return (\n    <div className=\"inventory-overview-panel inventory-calm-stock\"", 1)

result_meta = r'''
                    <div className="inventory-stock-result-meta" aria-live="polite">
                      <div>
                        <strong>{simpleStockGroups.length} {w8Plural(simpleStockGroups.length, 'товар', 'товара', 'товаров')}</strong>
                        <span>{visibleVariantCount} {w8Plural(visibleVariantCount, 'позиция', 'позиции', 'позиций')} в текущей выборке</span>
                      </div>
                      <small>{resultScopeLabel}</small>
                    </div>
    
'''
current = replace_once(
    current,
    "                    <div className=\"inventory-calm-list\">\n",
    result_meta + "                    <div className=\"inventory-calm-list\">\n",
)

start_marker = "                            {!single && isOpen ? (\n"
end_marker = "                          </article>"
start = current.index(start_marker)
end = current.index(end_marker, start)
old_block = current[start:end]
new_block = r'''                            {!single && isOpen ? (
                              <div className="inventory-stock-hierarchy" data-w8-stock-hierarchy="execution-color-size">
                                {buildStockBrowseHierarchy(rows, (row: any) => row.category || 'adult').map((execution: any) => {
                                  const executionFree = execution.rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                                  const executionPhysical = execution.rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                                  const executionReserved = execution.rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                                  const executionSizeCount = new Set(execution.rows.map((row: any) => w8Text(row.size)).filter(Boolean)).size
                                  return (
                                    <section className="inventory-stock-execution" key={`stock-execution-${group.key}-${execution.key}`}>
                                      <div className="inventory-stock-execution-head">
                                        <div>
                                          <span>Исполнение</span>
                                          <strong>{execution.label}</strong>
                                          <small>{execution.colors.length} {w8Plural(execution.colors.length, 'цвет', 'цвета', 'цветов')} · {executionSizeCount} {w8Plural(executionSizeCount, 'размер/возраст', 'размера/возраста', 'размеров/возрастов')}</small>
                                        </div>
                                        <div className={`inventory-stock-execution-numbers ${executionFree < 0 || executionPhysical < 0 ? 'needs-attention' : ''}`}>
                                          <strong>{executionPhysical < 0 ? 'Сверить' : executionFree < 0 ? `−${formatMoney(Math.abs(executionFree))}` : formatMoney(executionFree)}</strong>
                                          <span>{executionPhysical < 0 ? 'учёт ниже нуля' : executionFree < 0 ? 'не хватает' : 'свободно'}</span>
                                          <small>На месте {formatMoney(executionPhysical)}{executionReserved > 0 ? ` · В заказах ${formatMoney(executionReserved)}` : ''}</small>
                                        </div>
                                      </div>
                                      <div className="inventory-stock-color-list">
                                        {execution.colors.map((colorGroup: any) => {
                                          const colorFree = colorGroup.rows.reduce((sum: number, row: any) => sum + simpleStockQuantity(row), 0)
                                          const colorPhysical = colorGroup.rows.reduce((sum: number, row: any) => sum + simpleStockPhysical(row), 0)
                                          const colorReserved = colorGroup.rows.reduce((sum: number, row: any) => sum + simpleStockReserved(row), 0)
                                          return (
                                            <section className="inventory-stock-color" key={`stock-color-${group.key}-${execution.key}-${colorGroup.key}`}>
                                              <div className="inventory-stock-color-head">
                                                <div><strong>{colorGroup.label}</strong><span>{colorGroup.rows.length} {w8Plural(colorGroup.rows.length, 'позиция', 'позиции', 'позиций')}</span></div>
                                                <div className={colorFree < 0 || colorPhysical < 0 ? 'needs-attention' : ''}>
                                                  <strong>{colorPhysical < 0 ? 'Сверить' : colorFree < 0 ? `−${formatMoney(Math.abs(colorFree))}` : formatMoney(colorFree)}</strong>
                                                  <span>свободно</span>
                                                </div>
                                              </div>
                                              <div className="inventory-stock-subgroups">
                                                {colorGroup.subgroups.map((subgroup: any) => (
                                                  <div className="inventory-stock-subgroup" key={`stock-subgroup-${group.key}-${execution.key}-${colorGroup.key}-${subgroup.key}`}>
                                                    <div className="inventory-stock-subgroup-label">
                                                      <strong>{subgroup.gender}</strong>
                                                      <span>{productCategoryLabel(subgroup.category)} · {subgroup.category === 'child' ? 'возраст' : 'размер'}</span>
                                                    </div>
                                                    <div className="inventory-stock-size-grid">
                                                      {subgroup.rows.map((row: any) => {
                                                        const rowFree = simpleStockQuantity(row)
                                                        const rowPhysical = simpleStockPhysical(row)
                                                        const rowReserved = simpleStockReserved(row)
                                                        const sizeLabel = w8Text(row.size) || (subgroup.category === 'child' ? '— возраст' : '— размер')
                                                        const primary = [colorGroup.label, w8Text(row.size)].filter(Boolean).join(' · ') || 'Стандартный вариант'
                                                        return (
                                                          <button
                                                            className={`inventory-stock-size-tile warehouse-w3-micro-check-open ${rowFree < 0 || rowPhysical < 0 ? 'needs-attention' : ''} ${rowFree > 0 ? 'has-free' : 'is-zero-free'}`}
                                                            key={`stock-size-${row.key}`}
                                                            type="button"
                                                            data-variant-id={row.variantId}
                                                            aria-label={`${group.productName}, ${colorGroup.label}, ${subgroup.category === 'child' ? 'возраст' : 'размер'} ${sizeLabel}: свободно ${rowFree}, на месте ${rowPhysical}${rowReserved > 0 ? `, в заказах ${rowReserved}` : ''}. Открыть проверку.`}
                                                            onClick={() => openConcreteStockCheck(row, primary)}
                                                          >
                                                            <span className="inventory-stock-size-value">{sizeLabel}</span>
                                                            <span className="inventory-stock-size-free">{rowPhysical < 0 ? 'Сверить' : rowFree < 0 ? `−${formatMoney(Math.abs(rowFree))}` : formatMoney(rowFree)} <small>свободно</small></span>
                                                            <span className="inventory-stock-size-meta">На месте {formatMoney(rowPhysical)}{rowReserved > 0 ? ` · В заказах ${formatMoney(rowReserved)}` : ''}</span>
                                                          </button>
                                                        )
                                                      })}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </section>
                                          )
                                        })}
                                      </div>
                                    </section>
                                  )
                                })}
                              </div>
                            ) : null}
'''
current = current[:start] + new_block + current[end:]

# Make multi-variant product summary grammatical and explicitly scoped to the current result.
current = replace_once(
    current,
    "{single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{rows.length} вариантов в текущей выборке</span>}",
    "{single ? <span>{[singlePrimary, singleSecondary].filter(Boolean).join(' · ')}</span> : <span>{rows.length} {w8Plural(rows.length, 'позиция', 'позиции', 'позиций')} в текущей выборке</span>}",
)
current = replace_once(
    current,
    "{isOpen ? 'Скрыть варианты' : `Показать варианты (${rows.length})`}",
    "{isOpen ? 'Скрыть позиции' : `Показать позиции (${rows.length})`}",
)

(ROOT / OVERVIEW_REL).write_text(current, encoding="utf-8")

css = r'''/* W8.1 — daily Warehouse stock overview completion.
   Presentation only: exact SKU identity, stock math and mutation paths stay unchanged. */

.inventory-stock-result-meta {
  margin: 0 20px 9px;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid #edf1f6;
  border-bottom: 1px solid #edf1f6;
  color: #64748b;
}
.inventory-stock-result-meta > div { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.inventory-stock-result-meta strong { color: #334155; font-size: 13px; }
.inventory-stock-result-meta span,
.inventory-stock-result-meta small { font-size: 11px; }
.inventory-stock-result-meta small { text-align: right; }

.inventory-stock-hierarchy {
  display: grid;
  gap: 10px;
  padding: 10px 12px 12px;
  border-top: 1px solid #edf1f7;
  background: #f7f9fc;
}
.inventory-stock-execution {
  overflow: hidden;
  border: 1px solid #dfe7f0;
  border-radius: 14px;
  background: #fff;
}
.inventory-stock-execution-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 13px;
  background: #fbfcfe;
  border-bottom: 1px solid #e9eef4;
}
.inventory-stock-execution-head > div:first-child { min-width: 0; display: grid; gap: 2px; }
.inventory-stock-execution-head > div:first-child > span {
  color: #8793a2;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.inventory-stock-execution-head > div:first-child > strong { color: #172033; font-size: 14px; }
.inventory-stock-execution-head > div:first-child > small { color: #7c8898; font-size: 10px; }
.inventory-stock-execution-numbers {
  min-width: 128px;
  display: grid;
  justify-items: end;
  line-height: 1.15;
}
.inventory-stock-execution-numbers > strong { color: #172033; font-size: 16px; }
.inventory-stock-execution-numbers > span { color: #66758a; font-size: 10px; font-weight: 700; }
.inventory-stock-execution-numbers > small { margin-top: 3px; color: #8a95a3; font-size: 9px; white-space: nowrap; }
.inventory-stock-execution-numbers.needs-attention > strong { color: #9a5b13; }

.inventory-stock-color-list { display: grid; }
.inventory-stock-color { border-top: 1px solid #edf1f5; }
.inventory-stock-color:first-child { border-top: 0; }
.inventory-stock-color-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 13px 6px;
}
.inventory-stock-color-head > div:first-child { min-width: 0; display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
.inventory-stock-color-head > div:first-child strong { color: #26364d; font-size: 13px; overflow-wrap: anywhere; }
.inventory-stock-color-head > div:first-child span { color: #8a95a3; font-size: 9px; }
.inventory-stock-color-head > div:last-child { display: flex; align-items: baseline; gap: 4px; flex: 0 0 auto; }
.inventory-stock-color-head > div:last-child strong { color: #334155; font-size: 13px; }
.inventory-stock-color-head > div:last-child span { color: #8793a2; font-size: 9px; }
.inventory-stock-color-head > div:last-child.needs-attention strong { color: #9a5b13; }

.inventory-stock-subgroups { display: grid; gap: 6px; padding: 0 13px 11px; }
.inventory-stock-subgroup {
  display: grid;
  grid-template-columns: minmax(105px, 132px) minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}
.inventory-stock-subgroup-label { display: grid; gap: 1px; padding-top: 8px; }
.inventory-stock-subgroup-label strong { color: #526176; font-size: 10px; font-weight: 850; }
.inventory-stock-subgroup-label span { color: #929cab; font-size: 9px; }

.inventory-stock-size-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 6px;
}
.inventory-stock-size-tile {
  appearance: none;
  min-width: 0;
  min-height: 72px;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: 'size free' 'meta meta';
  align-content: center;
  gap: 4px 7px;
  padding: 9px 10px;
  border: 1px solid #dbe3ed;
  border-radius: 11px;
  background: #fbfcfe;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color .14s ease, background .14s ease, box-shadow .14s ease, transform .14s ease;
}
.inventory-stock-size-tile:hover {
  border-color: #9db5d5;
  background: #f5f9ff;
  box-shadow: 0 4px 11px rgba(45, 79, 122, .08);
  transform: translateY(-1px);
}
.inventory-stock-size-tile.has-free { border-color: #bfd0e6; background: #f8fbff; }
.inventory-stock-size-tile.is-zero-free { background: #fafbfc; border-color: #e3e8ee; }
.inventory-stock-size-tile.needs-attention { border-color: #e3b777; background: #fffaf2; box-shadow: inset 3px 0 0 #d49a44; }
.inventory-stock-size-value {
  grid-area: size;
  align-self: center;
  color: #172033;
  font-size: 17px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -.02em;
}
.inventory-stock-size-free {
  grid-area: free;
  align-self: center;
  justify-self: end;
  display: grid;
  justify-items: end;
  color: #294f85;
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
}
.inventory-stock-size-free small { margin-top: 3px; color: #8090a4; font-size: 8px; font-weight: 750; }
.inventory-stock-size-tile.is-zero-free .inventory-stock-size-free { color: #687589; }
.inventory-stock-size-tile.needs-attention .inventory-stock-size-free { color: #985c19; }
.inventory-stock-size-meta {
  grid-area: meta;
  overflow: hidden;
  color: #8793a2;
  font-size: 9px;
  font-weight: 650;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 980px) {
  .inventory-stock-subgroup { grid-template-columns: 95px minmax(0, 1fr); }
  .inventory-stock-size-grid { grid-template-columns: repeat(auto-fill, minmax(105px, 1fr)); }
}

@media (max-width: 720px) {
  .inventory-stock-result-meta { margin-inline: 12px; align-items: flex-start; }
  .inventory-stock-result-meta small { max-width: 45%; }
  .inventory-stock-hierarchy { padding-inline: 8px; }
  .inventory-stock-execution-head { padding-inline: 10px; }
  .inventory-stock-subgroup { grid-template-columns: 1fr; gap: 5px; }
  .inventory-stock-subgroup-label { display: flex; align-items: baseline; gap: 6px; padding-top: 2px; }
  .inventory-stock-color-head,
  .inventory-stock-subgroups { padding-inline: 10px; }
  .inventory-stock-size-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
  .inventory-stock-size-tile { min-height: 76px; }
}

@media (max-width: 460px) {
  .inventory-stock-result-meta { display: grid; gap: 3px; }
  .inventory-stock-result-meta small { max-width: none; text-align: left; }
  .inventory-stock-execution-head { align-items: flex-start; }
  .inventory-stock-execution-numbers { min-width: 105px; }
  .inventory-stock-execution-numbers > small { white-space: normal; text-align: right; }
  .inventory-stock-size-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .inventory-stock-size-tile { min-height: 78px; padding: 9px 8px; }
  .inventory-stock-size-value { font-size: 18px; }
  .inventory-stock-size-free { font-size: 13px; }
  .inventory-stock-size-meta { white-space: normal; }
}
'''
(ROOT / CSS_REL).write_text(css, encoding="utf-8")

fixture_path = ROOT / FIXTURE_REL
fixture_path.parent.mkdir(parents=True, exist_ok=True)
fixture_path.write_text(baseline, encoding="utf-8")

manifest = {
    "version": 1,
    "revision": "w8-1-stock-overview-completion",
    "files": {
        OVERVIEW_REL: {
            "beforeGitBlob": blob_sha(baseline),
            "afterGitBlob": blob_sha(current),
        }
    },
}
(ROOT / MANIFEST_REL).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

layer = r'''import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const overviewPath = path.join(root, 'src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const baselineOverviewPath = path.join(root, 'scripts/fixtures/renderInventoryOverviewPanel-w7-baseline.tsx')
const w7LayerPath = path.join(root, 'scripts/test-step1906b-frontend-modularization-w7-layer.mjs')
const manifestPath = path.join(root, 'scripts/w8-1-stock-overview-frontend-manifest.json')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const gitBlobSha = (text) => {
  const body = Buffer.from(text, 'utf8')
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8')
  return crypto.createHash('sha1').update(header).update(body).digest('hex')
}

try {
  for (const required of [overviewPath, baselineOverviewPath, w7LayerPath, manifestPath]) {
    check(fs.existsSync(required), `W8.1 frontend structural file missing: ${path.relative(root, required)}`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const overviewRel = 'src/features/inventory/views/renderInventoryOverviewPanel.tsx'
  check(manifest?.version === 1 && manifest?.revision === 'w8-1-stock-overview-completion', 'W8.1 frontend manifest invalid')
  check(JSON.stringify(Object.keys(manifest.files || {})) === JSON.stringify([overviewRel]), 'W8.1 frontend file allow-list widened unexpectedly')
  const currentOverview = fs.readFileSync(overviewPath, 'utf8')
  const baselineOverview = fs.readFileSync(baselineOverviewPath, 'utf8')
  check(gitBlobSha(baselineOverview) === manifest.files[overviewRel].beforeGitBlob, 'W8.1 frozen overview is not exact W7 baseline')
  check(gitBlobSha(currentOverview) === manifest.files[overviewRel].afterGitBlob, 'W8.1 overview changed beyond exact manifest')
  check(currentOverview.includes('data-w8-stock-hierarchy="execution-color-size"'), 'W8.1 hierarchy marker missing')
  check(currentOverview.includes('buildStockBrowseHierarchy(rows'), 'W8.1 exact rows are not grouped for human browsing')
  check(currentOverview.includes('inventory-stock-size-tile warehouse-w3-micro-check-open'), 'W8.1 exact SKU tile lost existing quick-check path')
  check(currentOverview.includes('onClick={() => openConcreteStockCheck(row, primary)}'), 'W8.1 SKU tiles do not open exact physical check')
  check(currentOverview.includes('inventory-stock-result-meta'), 'W8.1 current-result count is missing')
  check(!currentOverview.includes('useState(') && !currentOverview.includes('useEffect('), 'W8.1 renderer unexpectedly owns React lifecycle')

  fs.writeFileSync(overviewPath, baselineOverview)
  let result
  try {
    result = spawnSync(process.execPath, [w7LayerPath], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
  } finally {
    fs.writeFileSync(overviewPath, currentOverview)
  }
  if (result?.error) fail(`W7 preservation layer could not run under W8.1 baseline: ${result.error.message}`)
  check(result?.status === 0, `W7 preservation layer failed with code ${result?.status}`)
  check(fs.readFileSync(overviewPath, 'utf8') === currentOverview, 'W8.1 structural gate failed to restore current overview')
  console.log('W8.1 FRONTEND STRUCTURAL LAYER PASSED — W7 baseline preserved; exact Overview presentation delta accepted')
} catch (error) {
  console.error(`W8.1 FRONTEND STRUCTURAL LAYER FAILED: ${error?.message || error}`)
  process.exit(1)
}
'''
(ROOT / LAYER_REL).write_text(layer, encoding="utf-8")

test = r'''import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const pkg = JSON.parse(read('package.json'))
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const css = read('src/styles/w8-1-stock-overview.css')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const arrivalStart = inventory.indexOf('<div className="inventory-arrival-legacy-workspace">')
  const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'

  check(String(pkg.scripts?.['release:check'] || '').includes('test-w8-1-stock-overview-completion.mjs'), 'W8.1 regression is not chained into release:check')
  check(overview.includes("import '../../../styles/w8-1-stock-overview.css'"), 'W8.1 visual layer is not owned by Overview')
  check(overview.includes('data-w8-stock-hierarchy="execution-color-size"'), 'Execution -> color -> size hierarchy missing')
  for (const marker of ['Основное исполнение', 'inventory-stock-execution', 'inventory-stock-color', 'inventory-stock-size-grid', 'inventory-stock-size-tile']) {
    check(overview.includes(marker), `W8.1 Overview marker missing: ${marker}`)
  }
  check(overview.includes('inventory-stock-size-value') && overview.includes("subgroup.category === 'child' ? '— возраст' : '— размер'"), 'Size/age is not the primary tile discriminator')
  check(overview.includes('inventory-stock-size-free') && overview.includes('inventory-stock-size-meta'), 'Exact SKU tile lost free/physical/reserved hierarchy')
  check(overview.includes('onClick={() => openConcreteStockCheck(row, primary)}'), 'Exact SKU tile does not reuse safe quick check')
  check(overview.includes('data-variant-id={row.variantId}'), 'Exact variant identity disappeared from stock tile')
  check(overview.includes('inventory-stock-result-meta') && overview.includes('в текущей выборке'), 'Filtered-result scope is not explicit')
  check(overview.includes('Да, на месте {row.physical}') && overview.includes('Нет, другое количество'), 'Routine one-tap confirmation changed')
  check(overview.includes('needsIndependentCount') && overview.includes('Сначала посчитайте физически'), 'Blind-first risky count changed')
  check(!overview.includes('loadInventoryData(') && !overview.includes('loadInventoryCycleCounts('), 'W8.1 renderer introduced a new read path')
  check(!overview.includes('saveInventoryMovement') && !overview.includes('quickInventoryStocktake'), 'W8.1 renderer introduced a new write path')
  check(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))') && css.includes('min-height: 78px'), 'Phone size tiles are not large/readable enough')
  check(css.includes('.inventory-stock-size-tile.needs-attention') && css.includes('.inventory-stock-size-tile.has-free'), 'Stock tile states are not visually differentiated')
  check(arrivalStart >= 0 && inventory.indexOf(arrivalButton, arrivalStart) > arrivalStart, 'Frozen Arrival structure changed')

  console.log('W8.1 STOCK OVERVIEW COMPLETION PASSED — exact stock truth preserved; expanded products browse as execution/color/size tiles with clear result scope and mobile targets')
} catch (error) {
  console.error(`W8.1 STOCK OVERVIEW COMPLETION FAILED: ${error?.message || error}`)
  process.exit(1)
}
'''
(ROOT / TEST_REL).write_text(test, encoding="utf-8")

pkg_path = ROOT / "package.json"
pkg = pkg_path.read_text(encoding="utf-8")
pkg = replace_once(
    pkg,
    "&& node scripts/test-w7-sku-history-price-readiness.mjs\"",
    "&& node scripts/test-w7-sku-history-price-readiness.mjs && node scripts/test-w8-1-stock-overview-completion.mjs\"",
)
pkg_path.write_text(pkg, encoding="utf-8")

entry_path = ROOT / "scripts/test-step1906b-frontend-modularization.mjs"
entry = entry_path.read_text(encoding="utf-8")
entry = replace_once(
    entry,
    "// w7SkuHistoryPath — W7 exact-SKU history integration preservation layer\nawait import('./test-step1906b-frontend-modularization-w7-layer.mjs')",
    "// w7SkuHistoryPath — W7 exact-SKU history integration preservation layer\n// w8StockOverviewPath — W8.1 stock overview completion preservation layer\nawait import('./test-step1906b-frontend-modularization-w8-layer.mjs')",
)
entry_path.write_text(entry, encoding="utf-8")

doc = """# W8.1 — завершение ежедневного экрана «Остатки»\n\nДата: 2026-09-06\nBaseline: `ed889662e9d6dc0fc5fdfdd95943bb5641a8db5b` (W7)\nBranch: `w8-1-stock-overview-completion`\n\n## Цель\n\nДовести `Остатки` как главный ежедневный экран Склада без изменения складской математики. Существующий Product-список сохраняется, а раскрытие сложного товара становится человекочитаемым: **Исполнение → Цвет → пол/тип только при необходимости → крупные Размер/Возраст**. Каждый тайл остаётся точным SKU и открывает существующую безопасную быструю сверку.\n\n## Изменения\n\n- одинаковые цвета и исполнения больше не размазаны плоским списком SKU;\n- размер/возраст — главный визуальный ориентир;\n- на каждом точном тайле видны `Свободно`, `На месте`, а резерв показывается только когда он есть;\n- отрицательный/сомнительный остаток не скрывается и визуально отделён;\n- добавлена явная строка `товары / позиции в текущей выборке`, чтобы глобальные итоговые карточки не выглядели как результат поиска;\n- мобильный экран использует крупные 3-колоночные тайлы;\n- существующие quick-check, reservations, exact history и routine cycle-count пути переиспользуются без новых API/reads/writes.\n\n## Не менялось\n\n- Physical / Reserved / Available;\n- reservation / movement / stocktake / lifecycle semantics;\n- Worker/API/D1;\n- Catalog;\n- Arrival;\n- Branch2;\n- pricing.\n\n## Release gate\n\nW8.1 добавляет focused regression и новый Step1906B preservation layer поверх точного W7 Overview baseline. Перед merge обязательны cumulative release check, TypeScript/build, lint и Cloudflare dry-run.\n"""
(ROOT / DOC_REL).write_text(doc, encoding="utf-8")

context_path = ROOT / "docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md"
context = context_path.read_text(encoding="utf-8")
checkpoint = """## Checkpoint 2026-09-06 — W8.1 `Остатки` interface completion\n\nBaseline entering W8.1: `main` `ed889662e9d6dc0fc5fdfdd95943bb5641a8db5b` (W7). Work branch: `w8-1-stock-overview-completion`.\n\nW8.1 is a presentation-only completion of the daily `Остатки` workflow. Multi-variant products keep exact SKU identity but browse as Execution -> Color -> category/gender subgroup -> large Size/Age tiles. Each tile shows source-specific Available/Physical/Reserved truth and reuses the existing exact quick-check drawer. A current-result count now explicitly separates search/filter scope from the global source summary. No Worker/API/D1/migration, stock mathematics, Catalog, Arrival, Branch2 or pricing change is in scope.\n\nNext after green W8.1 acceptance: audit the remaining daily Warehouse surfaces (`Операции`, `Проверка`, `История`, recovery inbox) for concrete usability gaps only; do not reopen closed business semantics without evidence.\n\n---\n\n"""
marker = "## Checkpoint 2026-09-06 — W7 exact-SKU history / price readiness"
if context.count(marker) != 1:
    raise RuntimeError("canonical context W7 checkpoint anchor missing")
context = context.replace(marker, checkpoint + marker, 1)
context_path.write_text(context, encoding="utf-8")

print("W8.1 stock overview applied")
print("baseline overview blob:", blob_sha(baseline))
print("current overview blob:", blob_sha(current))

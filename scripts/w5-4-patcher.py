from pathlib import Path
import json
import hashlib
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)


def normalize(value):
    return '\n'.join(line.strip() for line in value.replace('\r\n', '\n').split('\n') if line.strip())


def extract_return_expression_hash(path, function_name):
    # We only need the same hash contract used by the existing preservation gate.
    # Delegate exact AST hashing to a temporary Node helper from the workflow.
    raise RuntimeError('hashing is handled by workflow')


panel_path = Path('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
s = panel_path.read_text(encoding='utf-8')

s = replace_once(s,
    "  const unselectedRecommendedProducts = recommendedStocktakeProducts.filter((product: any) => !stocktakeSelectedProductIds.includes(Number(product.productId)))\n\n  return (",
    "  const unselectedRecommendedProducts = recommendedStocktakeProducts.filter((product: any) => !stocktakeSelectedProductIds.includes(Number(product.productId)))\n  const stocktakeProgressPercent = stocktakeProgress.total ? Math.round((stocktakeProgress.filled / stocktakeProgress.total) * 100) : 0\n  const currentStocktakeRows = currentStocktakeGroup?.rows || []\n  const currentStocktakeFilled = currentStocktakeRows.filter((row: any) => (stocktakeFacts[String(row.id)] ?? '') !== '').length\n  const currentStocktakeRecount = currentStocktakeRows.filter((row: any) => row.status === 'recount_required').length\n  const currentStocktakeStatus = currentStocktakeGroup\n    ? `${currentStocktakeFilled} из ${currentStocktakeRows.length} позиций посчитано${currentStocktakeRecount ? ` · пересчитать ${currentStocktakeRecount}` : ''}`\n    : ''\n\n  return (",
    'stocktake progress helpers')

s = replace_once(s,
    "<div className=\"stocktake-full-warning stocktake-full-warning-v5\"><strong>{stocktakeSourceTitle(stocktakeSource)} · {stocktakeSourceStats[stocktakeSource]} позиций</strong><span>Нулевые позиции каталога не добавляются автоматически. Найденную во время пересчёта позицию можно добавить прямо из текущего товара.</span></div>",
    "<div className=\"stocktake-full-warning stocktake-full-warning-v5\"><strong>{stocktakeSourceTitle(stocktakeSource)} · {stocktakeSourceStats[stocktakeSource]} позиций</strong><span>В проверку попадут позиции, которые сейчас учитываются в этой точке. Если во время пересчёта найдёте ещё одну вещь, её можно добавить прямо в текущую проверку.</span></div>",
    'full stocktake start copy')

s = replace_once(s,
    "<p>Начата {formatStocktakeMoment(stocktakeSession.startedAt)} · {stocktakeSession.id}</p>",
    "<p>Начата {formatStocktakeMoment(stocktakeSession.startedAt)}</p>",
    'remove technical session id')

s = replace_once(s,
    "<strong>{stocktakeSavingIds.length ? 'Сохраняю…' : stocktakeUnsavedCount ? `Не сохранено: ${stocktakeUnsavedCount}` : 'Сохранено автоматически ✓'}</strong>\n                            <span>{stocktakeSavingIds.length || stocktakeUnsavedCount ? 'Не закрывайте страницу, пока изменения не сохранятся.' : 'Можно перейти в другой раздел и продолжить эту проверку позже.'}</span>",
    "<strong>{stocktakeSavingIds.length ? 'Сохраняю изменения…' : stocktakeUnsavedCount ? `Ждут сохранения: ${stocktakeUnsavedCount}` : 'Всё сохранено ✓'}</strong>\n                            <span>{stocktakeSavingIds.length || stocktakeUnsavedCount ? 'Дождитесь сохранения перед проверкой результата или выходом.' : 'Можно выйти и вернуться позже — прогресс не потеряется.'}</span>",
    'autosave copy')

s = replace_once(s,
    "<small>Чтобы продолжить позже, отменять не нужно — просто выйдите из раздела.</small>",
    "<small>Отмена закроет эту проверку без изменения остатков. Чтобы продолжить позже, просто выйдите из раздела.</small>",
    'cancel explanation')

s = replace_once(s,
    "<div className=\"stocktake-sticky-progress-main\"><strong>{stocktakeProgress.filled} из {stocktakeProgress.total} проверено</strong><span>{stocktakeProgress.recount ? `Нужно повторно пересчитать ${stocktakeProgress.recount}` : stocktakeProgress.unfilled ? `Завершение станет доступно после проверки ещё ${stocktakeProgress.unfilled}` : 'Все позиции заполнены — можно проверить результат.'}</span></div>",
    "<div className=\"stocktake-sticky-progress-main\"><strong>Проверено {stocktakeProgress.filled} из {stocktakeProgress.total} · {stocktakeProgressPercent}%</strong><span>{stocktakeSavingIds.length || stocktakeUnsavedCount ? 'Сначала дождитесь автосохранения введённых чисел.' : stocktakeProgress.recount ? `Нужно повторно пересчитать ${stocktakeProgress.recount}` : stocktakeProgress.unfilled ? `Осталось посчитать ${stocktakeProgress.unfilled}` : 'Все позиции посчитаны. Следующий шаг — проверить результат.'}</span></div>",
    'sticky progress copy')

s = replace_once(s,
    "<div className=\"stocktake-counting-rule\">Считайте всё, что физически находится здесь, включая уже отложенные заказы. Пустое поле означает, что позиция ещё не посчитана.</div>",
    "<div className=\"stocktake-counting-rule\">Считайте всё, что физически находится здесь, включая уже отложенные заказы. Системные числа появятся только после подсчёта. Пустое поле означает «ещё не посчитано», а не ноль.</div>",
    'blind count explanation')

s = replace_once(s,
    "const status = attention ? 'пересчитать' : done ? '✓' : counted ? `${remaining} осталось` : `${total}`",
    "const status = attention ? 'пересчитать' : done ? 'готово' : counted ? `${remaining} осталось` : `${total} поз.`",
    'desktop product status')

s = replace_once(s,
    "const counted = (group.rows || []).filter((row: any) => (stocktakeFacts[String(row.id)] ?? '') !== '').length\n                                      const total = (group.rows || []).length\n                                      return <option value={index} key={`stocktake-mobile-product-${group.key}`}>{group.productName} · {counted}/{total}</option>",
    "const counted = (group.rows || []).filter((row: any) => (stocktakeFacts[String(row.id)] ?? '') !== '').length\n                                      const total = (group.rows || []).length\n                                      const attention = (group.rows || []).some((row: any) => row.status === 'recount_required')\n                                      const status = attention ? 'пересчитать' : total > 0 && counted === total ? 'готово' : `${Math.max(0, total - counted)} осталось`\n                                      return <option value={index} key={`stocktake-mobile-product-${group.key}`}>{group.productName} · {status}</option>",
    'mobile product status')

s = replace_once(s,
    "<div><span>Товар {stocktakeProductIndex + 1} из {stocktakeGroups.length}</span><h4>{currentStocktakeGroup.productName}</h4></div>",
    "<div><span>Товар {stocktakeProductIndex + 1} из {stocktakeGroups.length}</span><h4>{currentStocktakeGroup.productName}</h4><small className=\"stocktake-current-product-status\">{currentStocktakeStatus}</small></div>",
    'current product progress')

s = replace_once(s,
    "<div className=\"stocktake-current-product-actions stocktake-current-product-actions-v5\">\n                                      <button className=\"secondary compact\" type=\"button\" title=\"Используйте только если весь текущий товар уже физически проверен\" disabled={stocktakeBusy || !(currentStocktakeGroup.rows || []).some((row: any) => (stocktakeFacts[String(row.id)] ?? '') === '')} onClick={() => void markCurrentStocktakeProductRemainingZero()}>Остальные = 0</button>\n                                      <button className=\"primary compact\" type=\"button\" onClick={() => setStocktakeFoundOpen(true)}>+ Найденная позиция</button>\n                                    </div>",
    "<div className=\"stocktake-current-product-actions stocktake-current-product-actions-v5\">\n                                      <button className=\"secondary compact\" type=\"button\" title=\"Только если весь текущий товар уже физически пересчитан\" disabled={stocktakeBusy || !(currentStocktakeGroup.rows || []).some((row: any) => (stocktakeFacts[String(row.id)] ?? '') === '')} onClick={() => void markCurrentStocktakeProductRemainingZero()}>Остальных нет</button>\n                                      <button className=\"primary compact\" type=\"button\" onClick={() => setStocktakeFoundOpen(true)}>+ Найденная позиция</button>\n                                      <span>«Остальных нет» заполнит пустые позиции этого товара нулём. Используйте только после полного физического пересчёта товара.</span>\n                                    </div>",
    'remaining zero action')

s = replace_once(s,
    "<div><strong>{stocktakeReadyForReview ? 'Все позиции заполнены' : stocktakeProgress.recount ? `Повторно проверить: ${stocktakeProgress.recount}` : `Осталось: ${stocktakeProgress.unfilled}`}</strong><span>Статус и кнопка завершения всегда видны в верхней панели.</span></div>\n                              {!stocktakeReadyForReview ? <button className=\"secondary\" type=\"button\" onClick={goToNextUnfilledStocktakeProduct}>К следующей требующей внимания</button> : null}",
    "<div><strong>{stocktakeReadyForReview ? 'Все позиции посчитаны' : stocktakeProgress.recount ? `Повторно пересчитать: ${stocktakeProgress.recount}` : `Осталось посчитать: ${stocktakeProgress.unfilled}`}</strong><span>{stocktakeReadyForReview ? 'Проверьте результат перед завершением.' : 'Пустые поля не считаются нулём.'}</span></div>\n                              {!stocktakeReadyForReview ? <button className=\"secondary\" type=\"button\" onClick={goToNextUnfilledStocktakeProduct}>{stocktakeProgress.recount ? 'К товару для пересчёта' : 'К следующему незаполненному товару'}</button> : null}",
    'full stocktake footer')

s = replace_once(s,
    "<div><span className=\"stocktake-step-kicker\">Проверка перед применением</span><h4>{stocktakeReviewRows.length ? `${stocktakeReviewRows.length} позиций требуют внимания` : 'Расхождений нет'}</h4><p>Система показывает учётное количество только после завершения слепого пересчёта.</p></div>",
    "<div><span className=\"stocktake-step-kicker\">Проверка результата</span><h4>{stocktakeReviewRows.length ? `${stocktakeReviewRows.length} позиций требуют внимания` : 'Расхождений нет'}</h4><p>Системный остаток показан только сейчас — после физического пересчёта.</p></div>",
    'review heading')

s = replace_once(s,
    "<div><strong>{stocktakeSourceTitle(stocktakeSession.source)} · проверено {stocktakeProgress.total} позиций</strong><span>Перед применением система ещё раз проверит, не изменился ли физический остаток после вашего подсчёта. Ничего не будет применено частично.</span></div>\n                              <button className=\"primary stocktake-finish-button\" type=\"button\" disabled={stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} onClick={() => void applyStocktake()}>{stocktakeBusy ? 'Проверяю и сохраняю…' : stocktakeProgress.differences ? `Применить ${stocktakeProgress.differences} изменений` : 'Завершить проверку'}</button>",
    "<div><strong>{stocktakeSourceTitle(stocktakeSession.source)} · проверено {stocktakeProgress.total} позиций</strong><span>Перед завершением система ещё раз сверит, не изменился ли остаток после вашего подсчёта. Если изменился, нужно будет пересчитать только затронутые позиции; частичного применения не будет.</span></div>\n                              <button className=\"primary stocktake-finish-button\" type=\"button\" disabled={stocktakeBusy || stocktakeSavingIds.length > 0 || stocktakeUnsavedCount > 0} onClick={() => void applyStocktake()}>{stocktakeBusy ? 'Проверяю и сохраняю…' : stocktakeProgress.differences ? `Сохранить изменения и завершить · ${stocktakeProgress.differences}` : 'Завершить проверку'}</button>",
    'final action copy')

panel_path.write_text(s, encoding='utf-8')

css_path = Path('src/styles/w5-checking-ux.css')
css = css_path.read_text(encoding='utf-8')
if '/* W5.4 — full revision:' in css:
    raise SystemExit('W5.4 CSS already present')
css += """

/* W5.4 — full revision: clearer progress, safer zero shortcut, strong finish path. */
.stocktake-current-product-status{display:block;margin-top:3px;color:#64748b;font-size:10px;line-height:1.3;font-weight:700}
.stocktake-current-product-actions-v5{flex-wrap:wrap}
.stocktake-current-product-actions-v5>span{flex:1 1 260px;min-width:220px}
.stocktake-sticky-progress.is-ready .stocktake-review-button{min-height:46px;box-shadow:0 0 0 3px rgba(22,163,74,.10)}
.stocktake-e-review-actions .stocktake-finish-button{min-height:48px}

@media(max-width:680px){
  .stocktake-current-product-actions-v5{display:grid!important;grid-template-columns:1fr 1fr;gap:8px!important}
  .stocktake-current-product-actions-v5>button{width:100%;min-height:44px}
  .stocktake-current-product-actions-v5>span{grid-column:1/-1;min-width:0}
  .stocktake-e-footer-v4{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
  .stocktake-e-footer-v4>button{width:100%;min-height:46px}
}

@media(max-width:420px){
  .stocktake-current-product-actions-v5{grid-template-columns:1fr}
  .stocktake-current-product-actions-v5>span{grid-column:auto}
}
"""
css_path.write_text(css, encoding='utf-8')

# The exact preservation hashes are supplied by the workflow after AST hashing.

# Focused regression.
Path('scripts/test-w5-4-full-stocktake.mjs').write_text("""import fs from 'node:fs'\nconst check = (condition, message) => { if (!condition) throw new Error(message) }\nconst panel = fs.readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx', 'utf8')\nconst css = fs.readFileSync('src/styles/w5-checking-ux.css', 'utf8')\nconst section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')\nconst worker = fs.readFileSync('worker/domains/inventory-stocktake.ts', 'utf8')\n\ncheck(panel.includes('Системные числа появятся только после подсчёта.'), 'Full stocktake must explain blind-first counting')\ncheck(panel.includes('Пустое поле означает «ещё не посчитано», а не ноль.'), 'Empty count semantics are not explicit')\ncheck(panel.includes('Проверено {stocktakeProgress.filled} из {stocktakeProgress.total} · {stocktakeProgressPercent}%'), 'Persistent progress is not explicit enough')\ncheck(panel.includes(\"'Все позиции посчитаны. Следующий шаг — проверить результат.'\"), 'Ready-state next action is unclear')\ncheck(panel.includes('Остальных нет</button>'), 'Safe zero shortcut was not renamed for humans')\ncheck(!panel.includes('Остальные = 0</button>'), 'Old technical zero shortcut remains visible')\ncheck(panel.includes('«Остальных нет» заполнит пустые позиции этого товара нулём.'), 'Zero shortcut consequence is not explained')\ncheck(panel.includes('Проверка результата</span>'), 'Review step still uses application/internal wording')\ncheck(panel.includes('Системный остаток показан только сейчас — после физического пересчёта.'), 'Review does not explain why system quantity appears now')\ncheck(panel.includes('Сохранить изменения и завершить · ${stocktakeProgress.differences}'), 'Final change action is not explicit')\ncheck(panel.includes('частичного применения не будет.'), 'All-or-nothing consequence copy disappeared')\ncheck(panel.includes('Отмена закроет эту проверку без изменения остатков.'), 'Cancel consequence is not visible')\ncheck(!panel.includes('Начата {formatStocktakeMoment(stocktakeSession.startedAt)} · {stocktakeSession.id}'), 'Technical session id is still exposed in active UI')\ncheck(panel.includes('Сессия {stocktakeSession.id} · начата'), 'Session id must remain on the printable audit sheet')\ncheck(panel.includes(\"stocktakeProgress.recount ? 'К товару для пересчёта' : 'К следующему незаполненному товару'\"), 'Next-attention action is not state-specific')\ncheck(panel.includes(\"done ? 'готово'\"), 'Desktop product status does not use a human completion label')\ncheck(panel.includes(\"attention ? 'пересчитать' : total > 0 && counted === total ? 'готово'\"), 'Mobile product status does not expose recount/done state')\n\ncheck(css.includes('.stocktake-current-product-status'), 'Current-product progress styling missing')\ncheck(css.includes('@media(max-width:680px)'), 'Small-screen contract missing')\ncheck(css.includes('.stocktake-current-product-actions-v5{display:grid!important;grid-template-columns:1fr 1fr'), 'Current-product actions do not adapt on small screens')\ncheck(css.includes('.stocktake-e-footer-v4>button{width:100%;min-height:46px}'), 'Next action is not a comfortable mobile target')\ncheck(css.includes('.stocktake-e-review-actions .stocktake-finish-button{min-height:48px}'), 'Final action is not prominent enough')\n\ncheck(worker.includes(\"SET status = 'recount_required',\"), 'Full stocktake conflict protection missing')\ncheck(worker.includes('пересчитайте только их — ничего из ревизии не было применено частично.'), 'Full stocktake all-or-nothing conflict contract missing')\ncheck(section.includes(\"async function startStocktake() {\\n    if (stocktakeBusy) return\"), 'Manager stocktake access regressed')\ncheck(!section.includes(\"async function startStocktake() {\\n    if (!isAdmin\"), 'Manager stocktake start silently blocked again')\n\nconst arrivalStart = section.indexOf('<div className=\"inventory-arrival-legacy-workspace\">')\nconst arrivalButton = '<button className=\"inventory-arrival-add-position\" type=\"button\" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'\ncheck(arrivalStart >= 0 && section.indexOf(arrivalButton, arrivalStart) >= 0, 'Frozen Arrival workspace changed')\nconsole.log('W5.4 FULL STOCKTAKE PASSED — blind counting, progress, cancel/continue, review, finish, manager access and small-screen actions remain clear and safe')\n""", encoding='utf-8')

Path('docs/continuation/W5_4_FULL_STOCKTAKE_20260905.md').write_text("""# W5.4 — Full stocktake comprehension and completion UX\n\nDate: 2026-09-05\nBase Production: `a4a9ee8968523bac9d72bdce39cdfcd4d3d45477` (`W5: restore manager Warehouse checks and history`)\n\n## Goal\nKeep the proven resumable stocktake engine and layout, but remove the remaining points where an employee can hesitate during a full physical count: what an empty field means, why system numbers are hidden, what is saved, what cancel does, where to go next, and what the final button will do.\n\n## Changes\n- Active header no longer exposes the technical session id; the id remains on the printable audit sheet.\n- Autosave state now says whether values are saved and explicitly tells the employee to wait before leaving/reviewing when writes are still pending.\n- Persistent progress includes percentage and a concrete next-action message.\n- Full-count rule explicitly states blind-first behavior and distinguishes an empty field from physical zero.\n- Product browser and mobile selector use `готово`, `осталось`, and `пересчитать` states instead of terse counters/checkmarks.\n- Current product shows its own counted/recount state.\n- High-risk `Остальные = 0` becomes `Остальных нет`, with a visible consequence: it fills remaining blank positions with zero and should only be used after the product was physically counted.\n- Footer gives a real next action instead of describing where UI controls are located.\n- Review is named `Проверка результата`; system quantities are explained as intentionally appearing only after the physical count.\n- Final action says `Сохранить изменения и завершить` when differences exist and explains the existing all-or-nothing conflict behavior.\n- Cancel explanation states that cancellation closes the check without changing stock; leaving the section remains the safe way to continue later.\n- Small-screen rules keep current-product actions, next action, review and finish controls large and stack them when needed.\n\n## Deliberate non-changes\n- No migration, D1 probe or Production data write.\n- No stocktake server algorithm change: autosave, retry/idempotency, CAS/conflict marking and all-or-nothing completion remain unchanged.\n- No change to `Найденная позиция`; that belongs to W5.5.\n- No change to W5.6 completion consequences/recovery summary yet.\n- Arrival UI frozen; Branch2 untouched.\n\n## Next\nW5.5: make found/unclear physical items during a check resolve naturally without turning the employee into a catalog administrator.\n""", encoding='utf-8')

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
marker = ' && node scripts/test-w5-4-full-stocktake.mjs'
if marker not in pkg['scripts']['release:check']:
    pkg['scripts']['release:check'] += marker
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('W5.4 source patcher completed')

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)


app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')

app = replace_once(app, """  const openInventoryPanel = (panel: InventoryPanel) => {
    const nextPanel: InventoryPanel = panel === 'audit' ? 'settings' : panel
    if (!isAdmin && nextPanel !== 'overview' && nextPanel !== 'attention') {
      setInventoryPanel('overview')
      return
    }
""", """  const openInventoryPanel = (panel: InventoryPanel) => {
    const nextPanel: InventoryPanel = panel === 'audit' ? 'settings' : panel
    if (!isAdmin && (nextPanel === 'catalog' || nextPanel === 'settings')) {
      setInventoryPanel('overview')
      return
    }
""", 'manager Warehouse navigation gate')

app = replace_once(
    app,
    'function App() {',
    "async function settleCatalogReviewRefreshes(tasks: Promise<unknown>[]) { return (await Promise.allSettled(tasks)).some((entry) => entry.status === 'rejected') }\nfunction App() {",
    'catalog review refresh helper',
)

old_reconcile = """      if (!response.ok) throw new Error(result?.message || 'Не удалось разобрать очевидные позиции.')
      const next = await loadCatalogReview(true)
      if (Number(result?.resolvedGroups || 0) > 0) {
        await Promise.all([loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false), loadCatalogData(true)])
      }
      setMessage(Number(result?.resolvedGroups || 0) > 0 ? `Автоматически разобрано: ${result.resolvedGroups}.` : 'Очевидных безопасных совпадений больше нет.')
      return { ...result, review: next }
"""
new_reconcile = """      if (!response.ok) throw new Error(result?.message || 'Не удалось разобрать очевидные позиции.')
      const nextRefresh = loadCatalogReview(true)
      const refreshIncomplete = await settleCatalogReviewRefreshes([nextRefresh, ...(Number(result?.resolvedGroups || 0) > 0 ? [loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false), loadCatalogData(true)] : [])])
      const next = await nextRefresh.catch(() => catalogReview)
      const successMessage = Number(result?.resolvedGroups || 0) > 0 ? `Автоматически разобрано: ${result.resolvedGroups}.` : 'Очевидных безопасных совпадений больше нет.'
      setMessage(refreshIncomplete ? `${successMessage} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : successMessage)
      return { ...result, review: next }
"""
app = replace_once(app, old_reconcile, new_reconcile, 'catalog reconcile refresh isolation')

old_facts = """      const createdReference = Array.isArray(input.createFields) && input.createFields.length > 0
      await Promise.all([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        createdReference ? loadReferencesData(true) : Promise.resolve(null),
        loadWarehouseAttention(false, true),
      ])
      setMessage(result?.message || 'Позиция разобрана.')
      return result
"""
new_facts = """      const createdReference = Array.isArray(input.createFields) && input.createFields.length > 0
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
        createdReference ? loadReferencesData(true) : Promise.resolve(null), loadWarehouseAttention(false, true),
      ])
      setMessage(refreshIncomplete ? `${result?.message || 'Позиция разобрана.'} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : (result?.message || 'Позиция разобрана.'))
      return result
"""
app = replace_once(app, old_facts, new_facts, 'resolve-facts refresh isolation')

old_exclude = """      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось оставить позицию вне каталога.')
      await Promise.all([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
      ])
      setMessage(result?.message || 'Позиция оставлена только в заказе.')
      return result
"""
new_exclude = """      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось оставить позицию вне каталога.')
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
      ])
      setMessage(refreshIncomplete ? `${result?.message || 'Позиция оставлена только в заказе.'} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : (result?.message || 'Позиция оставлена только в заказе.'))
      return result
"""
app = replace_once(app, old_exclude, new_exclude, 'catalog exclude refresh isolation')

old_link = """      if (!response.ok || result.ok === false) throw new Error(result.message || 'Не удалось связать позицию с каталогом.')
      await Promise.all([
        loadCatalogReview(true),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
      ])
      setMessage(result.message || `Позиция связана с каталогом${Number(result.linked || 0) > 1 ? `; одинаковых записей обработано: ${result.linked}` : ''}.`)
      return true
"""
new_link = """      if (!response.ok || result.ok === false) throw new Error(result.message || 'Не удалось связать позицию с каталогом.')
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true), loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
      ])
      const successMessage = result.message || `Позиция связана с каталогом${Number(result.linked || 0) > 1 ? `; одинаковых записей обработано: ${result.linked}` : ''}.`
      setMessage(refreshIncomplete ? `${successMessage} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : successMessage)
      return true
"""
app = replace_once(app, old_link, new_link, 'legacy catalog link refresh isolation')
app_path.write_text(app, encoding='utf-8')

css_path = Path('src/styles/187-inventory-health.css')
css = css_path.read_text(encoding='utf-8')
css = replace_once(css, ".inventory-tabs-step187.is-manager {\n  grid-template-columns: minmax(120px, 180px);\n}\n", ".inventory-tabs-step187.is-manager {\n  grid-template-columns: repeat(5, minmax(0, 1fr));\n}\n", 'manager desktop nav grid')
css = replace_once(css, "@media (max-width: 1180px) {\n  .inventory-tabs-step187 {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n", "@media (max-width: 1180px) {\n  .inventory-tabs-step187 {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n\n  .inventory-tabs-step187.is-manager {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n", 'manager medium nav grid')
css = replace_once(css, "  .inventory-tabs-step187.is-manager {\n    grid-template-columns: 1fr;\n  }\n", "  .inventory-tabs-step187.is-manager {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n", 'manager small nav grid')
css = replace_once(css, "@media (max-width: 420px) {\n  .inventory-tabs-step187 {\n    grid-template-columns: 1fr;\n  }\n}\n", "@media (max-width: 420px) {\n  .inventory-tabs-step187,\n  .inventory-tabs-step187.is-manager {\n    grid-template-columns: 1fr;\n  }\n}\n", 'manager narrow nav grid')
css_path.write_text(css, encoding='utf-8')

panel_path = Path('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
panel = panel_path.read_text(encoding='utf-8')
panel = replace_once(panel, "Требуют разбора{catalogReview && (catalogReview.count || 0) > 0 ? ` (${catalogReview.count})` : ''}", "Уточнить товары{catalogReview && (catalogReview.count || 0) > 0 ? ` (${catalogReview.count})` : ''}", 'catalog review tab wording')
panel = replace_once(panel, '<span className="catalog-review-eyebrow">Только то, что нужно решить сейчас</span>', '<span className="catalog-review-eyebrow">Нужно уточнить, какой это товар</span>', 'catalog review eyebrow')
panel = replace_once(panel, "<h3>{catalogReview?.mode === 'order' ? `Разбор заказа ${catalogReview.items?.[0]?.externalId || ''}`.trim() : catalogReview?.count ? `Нужно разобрать: ${catalogReview.count}` : 'Разбор товаров'}</h3>", "<h3>{catalogReview?.mode === 'order' ? `Уточнить товар в заказе ${catalogReview.items?.[0]?.externalId || ''}`.trim() : catalogReview?.count ? `Нужно уточнить: ${catalogReview.count}` : 'Товары определены'}</h3>", 'catalog review heading')
panel = replace_once(panel, "<p>{catalogReview?.mode === 'order' ? 'Показаны только неразобранные товары этого заказа. После решения можно вернуться к текущей очереди.' : 'Здесь только недавние позиции, которые действительно требуют решения для текущей работы.'}</p>", "<p>{catalogReview?.mode === 'order' ? 'Система не смогла безопасно связать эти позиции заказа с точным товаром или вариантом. Подтвердите недостающий факт — это не общая ошибка каталога.' : 'Здесь только недавние позиции заказов, где система не смогла безопасно определить точный товар или вариант. Подтвердите недостающий факт; старый неактуальный мусор сюда не должен попадать.'}</p>", 'catalog review explanation')
panel_path.write_text(panel, encoding='utf-8')

pkg_path = Path('package.json')
pkg = pkg_path.read_text(encoding='utf-8')
pkg = replace_once(pkg, ' && node scripts/test-d1-read-budget-r5-11.mjs"', ' && node scripts/test-d1-read-budget-r5-11.mjs && node scripts/test-w1-warehouse-reliability.mjs"', 'release check W1 registration')
pkg_path.write_text(pkg, encoding='utf-8')

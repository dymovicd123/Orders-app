from pathlib import Path

p = Path('src/features/sections/InventorySection.tsx')
s = p.read_text(encoding='utf-8')


def one(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

s = one(
    s,
    """      setStocktakeNotice(deferred
        ? `Найдено позиций для уточнения: ${deferred}. Они сохранены в этой проверке — укажите фактическое количество. После завершения система отдельно покажет, что нужно определить.`
        : `${added ? `Добавлено в ревизию: ${added}. ` : ''}${existing ? `Уже были в ревизии: ${existing}. ` : ''}Теперь укажите фактическое количество по найденным размерам.`)
""",
    """      setStocktakeNotice(deferred ? `Найдено позиций для уточнения: ${deferred}. Они сохранены в этой проверке — укажите фактическое количество. После завершения система отдельно покажет, что нужно определить.` : `${added ? `Добавлено в ревизию: ${added}. ` : ''}${existing ? `Уже были в ревизии: ${existing}. ` : ''}Теперь укажите фактическое количество по найденным размерам.`)
""",
    'compact deferred found notice',
)

s = one(
    s,
    """      await Promise.allSettled([
        loadInventoryData(item.source === 'boutique' ? 'boutique' : 'warehouse', true, '', false),
        loadWarehouseAttention(true),
      ])
""",
    """      await Promise.allSettled([loadInventoryData(item.source === 'boutique' ? 'boutique' : 'warehouse', true, '', false), loadWarehouseAttention(true)])
""",
    'compact found reconciliation refresh',
)

s = one(
    s,
    """  }

  function openFoundInventoryCatalog(item: any) {
""",
    """  }
  function openFoundInventoryCatalog(item: any) {
""",
    'compact found helper spacing',
)

p.write_text(s, encoding='utf-8')

# Preserve the typed API boundary: this call only consumes ok/message and returns the
# narrow response object to the caller; W5.5 must not reintroduce readJsonResponse<any>.
p = Path('src/App.tsx')
s = p.read_text(encoding='utf-8')
s = one(
    s,
    "const data = await readJsonResponse<any>(response, 'Уточнение найденной позиции')",
    "const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Уточнение найденной позиции')",
    'typed found reconciliation response',
)
p.write_text(s, encoding='utf-8')

# W5 manager-access regression used to assert only the old object-shaped request.
# W5.5 intentionally accepts both the existing object shape and the array shape used by
# the stocktake UI, while keeping the exact same requireAdminAccess boundary.
p = Path('scripts/test-w5-manager-warehouse-access.mjs')
s = p.read_text(encoding='utf-8')
s = one(
    s,
    "check(worker.includes(\"const wantsNewReferenceValue = Object.values(createReferenceFields).some((value) => value === true);\"), 'New reference-value boundary missing')",
    "check(worker.includes(\"const wantsNewReferenceValue = Array.isArray(createReferenceFields)\"), 'New reference-value array boundary missing')\ncheck(worker.includes(\"Object.values(createReferenceFields as Record<string, unknown>).some((value) => value === true)\"), 'New reference-value object boundary missing')",
    'manager-access create-reference shape contract',
)
p.write_text(s, encoding='utf-8')

print('W5.5 controller budgets, typed API boundary, and manager master-data guard preserved')

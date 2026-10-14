type RoutineCycleCountArgs = {
  row: any
  countedQuantity: number
  source: 'warehouse' | 'boutique'
  busy: boolean
  quickInventoryStocktake: (input: { source: 'warehouse' | 'boutique'; variantId: number; expectedQuantity: number; countedQuantity: number }) => Promise<any>
  refreshInventoryModule: (force?: boolean) => Promise<any>
  refreshSuggestions: (source: 'warehouse' | 'boutique', keepNotice?: boolean, limit?: number) => Promise<any>
  setBusy: (value: boolean) => void
  setNotice: (value: string) => void
  setData: (update: any) => void
  setValues: (update: any) => void
}

export async function runRoutineCycleCount(args: RoutineCycleCountArgs) {
  const { row, countedQuantity, source, busy, quickInventoryStocktake, refreshInventoryModule, refreshSuggestions, setBusy, setNotice, setData, setValues } = args
  if (busy) return
  const numeric = Number(countedQuantity)
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
    setNotice('Укажите целое фактическое количество 0 или больше.')
    return
  }
  setBusy(true)
  setNotice('')
  try {
    const result = await quickInventoryStocktake({ source, variantId: Number(row.variantId), expectedQuantity: Number(row.physical || 0), countedQuantity: numeric })
    if (!result?.ok) {
      const failureNotice = result?.message || 'Остаток изменился. Обновите данные и пересчитайте позицию.'
      setNotice(failureNotice)
      if (result?.code === 'changed') {
        setValues((current: any) => ({ ...current, [String(row.variantId)]: '' }))
        const refreshes = await Promise.allSettled([
          refreshInventoryModule(true),
          refreshSuggestions(source, true, 5),
        ])
        if (refreshes.some((entry) => entry.status === 'rejected')) {
          setNotice(`${failureNotice} Свежие данные не удалось загрузить автоматически; обновите остатки перед повторным подсчётом.`)
        }
      }
      return
    }
    setData((current: any) => current?.source === source ? { ...current, items: (current.items || []).filter((item: any) => Number(item.variantId) !== Number(row.variantId)) } : current)
    setValues((current: any) => ({ ...current, [String(row.variantId)]: '' }))
    const successNotice = Boolean(result.changed) ? `Фактическое количество «${row.productName}» сохранено.` : `Совпадение «${row.productName}» подтверждено.`
    setNotice(successNotice)
    try {
      await refreshInventoryModule(true)
    } catch {
      setNotice(`${successNotice} Остаток уже сохранён; общий список обновится при следующем обновлении.`)
    }
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Не удалось сохранить короткую сверку.')
  } finally {
    setBusy(false)
  }
}

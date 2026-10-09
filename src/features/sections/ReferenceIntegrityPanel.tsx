import { useState } from 'react'

type DuplicateValue = { id: number; value: string; isActive: boolean }
type DuplicateGroup = { kind: string; identity: string; suggestedTargetId: number; items: DuplicateValue[] }
type SkuDuplicate = { productId: number; productName: string; category: string; gender: string;
  material: string; length: string; color: string; size: string;
  variants: Array<{ id: number; color: string; physical: number; reserved: number; material: string; length: string }> }
type SkuPreview = {
  ok: boolean;
  source: { id: number; color: string; size: string; active: boolean };
  target: { id: number; color: string; size: string; active: boolean };
  productName: string; material: string; length: string;
  sourceImpact: { physical: number; reserved: number; historicalOrders: number; activeOrders: number; activeReservations: number };
  targetImpact: { physical: number; reserved: number; historicalOrders: number };
  stockBreakdown: Array<{ location: string; sourcePhysical: number; targetPhysical: number; combinedPhysical: number; sourceReserved: number; targetReserved: number }>;
  stateToken: string; transferQuantity: number; reservationCount: number;
  blockers: string[]; canConsolidate: boolean; explanation: string;
}
type SkuMergeHistory = {
  id: number; sourceId: number; targetId: number; productName: string;
  sourceColor: string; targetColor: string; material: string; length: string;
  size: string; category: string; gender: string; createdBy: string; createdAt: string;
}
type DuplicateResponse = { ok?: boolean; groups?: DuplicateGroup[]; skuGroups?: SkuDuplicate[];
  limited?: boolean; skuLimited?: boolean; message?: string }
type Preview = {
  source: DuplicateValue; target: DuplicateValue;
  summary: {
    matchedVariantCount: number; sourceActiveVariants: number; activeExecutions: number;
    physical: number; reserved: number; requiresCatalogReview: boolean; variantLimitReached: boolean
  };
  sampleVariants: Array<{
    id: number; productName: string; color: string; size: string; material: string;
    length: string; active: boolean; physical: number; reserved: number; belongsTo: string
  }>;
  safeToHideSource: boolean;
  explanation: string;
}

const titles: Record<string, string> = {
  color: 'Цвета', material: 'Материалы', length: 'Длины', size: 'Размеры',
  child_age: 'Детские возраста', city: 'Города', payment_method: 'Способы оплаты',
  delivery_type: 'Доставка', return_reason: 'Причины возврата',
  writeoff_reason: 'Причины списания',
}

export function ReferenceIntegrityPanel({
  apiFetch,
  isAdmin,
  onHidden,
}: {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  isAdmin: boolean;
  onHidden: () => Promise<void>;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [limited, setLimited] = useState(false)
  const [skuGroups, setSkuGroups] = useState<SkuDuplicate[] | null>(null)
  const [skuLimited, setSkuLimited] = useState(false)
  const [skuKeeper, setSkuKeeper] = useState<Record<string, number>>({})
  const [skuSelected, setSkuSelected] = useState('')
  const [skuPreview, setSkuPreview] = useState<SkuPreview | null>(null)
  const [skuPreviewBusy, setSkuPreviewBusy] = useState(false)
  const [mergeHistory, setMergeHistory] = useState<SkuMergeHistory[] | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')

  if (!isAdmin) return null

  async function scan() {
    if (loading) return
    setLoading(true)
    setError('')
    setPreview(null)
    setSkuPreview(null)
    setSelected('')
    try {
      const response = await apiFetch('/api/reference-values/duplicates')
      const data = await response.json() as DuplicateResponse
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось проверить справочники.')
      setGroups(Array.isArray(data.groups) ? data.groups : [])
      setLimited(Boolean(data.limited))
      setSkuGroups(Array.isArray(data.skuGroups) ? data.skuGroups : [])
      setSkuLimited(Boolean(data.skuLimited))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Проверка временно недоступна.')
    } finally {
      setLoading(false)
    }
  }

  async function inspect(group: DuplicateGroup, sourceId: number) {
    if (previewBusy) return
    setPreviewBusy(true)
    setPreview(null)
    setSkuPreview(null)
    setError('')
    setSelected(group.kind + ':' + sourceId)
    try {
      const qs = new URLSearchParams({ sourceId: String(sourceId), targetId: String(group.suggestedTargetId) })
      const response = await apiFetch('/api/reference-values/consolidation-preview?' + qs.toString())
      const data = await response.json() as Preview & { message?: string; ok?: boolean }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось проверить связи вариантов.')
      setPreview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Проверка связей временно недоступна.')
    } finally {
      setPreviewBusy(false)
    }
  }

  async function loadMergeHistory() {
    if (historyBusy) return
    setHistoryBusy(true)
    setError('')
    try {
      const response = await apiFetch('/api/catalog/variants/consolidation-history')
      const data = await response.json() as { ok?: boolean; items?: SkuMergeHistory[]; message?: string }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось загрузить историю.')
      setMergeHistory(Array.isArray(data.items) ? data.items : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'История пока недоступна.')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function inspectSku(sourceId: number, targetId: number) {
    if (skuPreviewBusy || actionBusy) return
    setSkuPreviewBusy(true)
    setSkuPreview(null)
    setPreview(null)
    setSkuSelected(sourceId + ':' + targetId)
    setError('')
    try {
      const qs = new URLSearchParams({ sourceId: String(sourceId), targetId: String(targetId) })
      const response = await apiFetch('/api/catalog/variants/consolidation-preview?' + qs.toString())
      const data = await response.json() as SkuPreview & { message?: string }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось проверить варианты.')
      setSkuPreview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Проверка вариантов временно недоступна.')
    } finally {
      setSkuPreviewBusy(false)
    }
  }

  async function consolidateSku() {
    if (!skuPreview?.canConsolidate || actionBusy) return
    const { source, target } = skuPreview
    if (!window.confirm(
      'Объединить вариант #' + source.id + ' с основным #' + target.id + '? '
      + (skuPreview.transferQuantity > 0
        ? 'Будет перенесено ' + skuPreview.transferQuantity + ' шт. между идентичными вариантами по их местам хранения. '
        : 'Физические остатки не требуют переноса. ')
      + (skuPreview.reservationCount
        ? 'Действующие резервы ' + skuPreview.reservationCount + ' строк заказов перейдут на основной вариант. '
        : '')
      + 'Цены, названия в истории и складские движения сохранятся, списания не будет.'
    )) return
    setActionBusy(true)
    setError('')
    try {
      const response = await apiFetch('/api/catalog/variants/consolidate-unused', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.id, targetId: target.id, expectedToken: skuPreview.stateToken }),
      })
      const data = await response.json() as { ok?: boolean; message?: string }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось объединить варианты.')
      await onHidden()
      await scan()
      setMergeHistory(null)
      setNotice('Варианты объединены: остатки сохранены и закреплены за основным вариантом. Исторические документы не менялись.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Объединение временно недоступно.')
    } finally {
      setActionBusy(false)
    }
  }

  async function hideSafeSource() {
    if (actionBusy || !preview?.safeToHideSource) return
    if (!window.confirm('Убрать «' + preview.source.value + '» из рабочих списков? Действующие товары, остатки и история не изменятся.')) return
    setActionBusy(true)
    setError('')
    const targetId = preview.target.id
    const sourceId = preview.source.id
    try {
      const response = await apiFetch('/api/reference-values/hide-unused-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, targetId }),
      })
      const data = await response.json() as { ok?: boolean; message?: string }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось убрать значение.')
      await onHidden()
      await scan()
      setNotice('Лишнее значение отключено, действующие товары и складская история сохранены.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обновить справочник.')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <section className="mini-panel reference-integrity-panel" aria-label="Порядок в справочниках">
      <div className="mini-panel-head">
        <div>
          <h3>Порядок в справочниках</h3>
          <p className="mini-panel-note">Найдём одинаковые значения и проверим последствия их объединения. Пока ничего не меняем.</p>
        </div>
        <button className="secondary compact" type="button" disabled={loading || previewBusy} onClick={() => void scan()}>
          {loading ? 'Проверяю…' : groups === null ? 'Найти дубли' : 'Проверить заново'}
        </button>
      </div>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {groups !== null ? (
        <div className="reference-integrity-results">
          {!groups.length ? <p className="mini-panel-note">Совпадений по пробелам, дефисам и регистру не найдено.</p> : (
            <>
              <p className="mini-panel-note">Найдено групп: <strong>{groups.length}</strong>. Выберите лишнее значение, чтобы проверить его связи.</p>
              {groups.map(group => (
                <div className="reference-integrity-group" key={group.kind + ':' + group.identity}>
                  <strong>{titles[group.kind] || group.kind}: {group.identity}</strong>
                  <div className="reference-integrity-items">
                    {group.items.map(item => (
                      <div key={item.id} className="reference-integrity-item">
                        <span>{item.value} {item.id === group.suggestedTargetId ? '· основное' : ''} {!item.isActive ? '· отключено' : ''}</span>
                        {item.id !== group.suggestedTargetId ? (
                          <button type="button" className="secondary compact" disabled={previewBusy} onClick={() => void inspect(group, item.id)}>
                            {previewBusy && selected === group.kind + ':' + item.id ? 'Проверяю…' : 'Посмотреть последствия'}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
          {limited ? <p className="mini-panel-note">Список большой. Нужна дополнительная проверка остальных значений.</p> : null}
        </div>
      ) : null}
      {skuGroups !== null ? (
        <div className="reference-integrity-sku-results">
          <h4>Повторяющиеся варианты товаров</h4>
          {!skuGroups.length ? (
            <p className="mini-panel-note">Среди проверенных активных вариантов одинаковых комбинаций не найдено.</p>
          ) : (
            <>
              <p className="mini-panel-note">
                Найдено совпадающих комбинаций: <strong>{skuGroups.length}</strong>. Материалы и длины учитываются отдельно.
              </p>
              {skuGroups.map((group, index) => {
                const key = group.productId + ':' + index
                const preferred = [...group.variants].sort((a, b) =>
                  (Math.abs(b.physical) + Math.abs(b.reserved)) - (Math.abs(a.physical) + Math.abs(a.reserved)) || a.id - b.id
                )[0]
                const keeperId = skuKeeper[key] && group.variants.some(v => v.id === skuKeeper[key])
                  ? skuKeeper[key] : (preferred?.id || 0)
                return (
                  <div className="reference-integrity-group" key={key}>
                    <strong>{group.productName} · {group.material || 'Стандарт'} · {group.length || 'Стандарт'}</strong>
                    <p className="mini-panel-note">{group.color} · {group.size || 'Без размера'} · {group.gender || 'Без указания пола'}</p>
                    <label className="mini-panel-note">
                      Основной вариант:{' '}
                      <select value={keeperId} disabled={actionBusy || skuPreviewBusy}
                        onChange={e => {
                          setSkuKeeper(old => ({ ...old, [key]: Number(e.target.value) }))
                          setSkuPreview(null)
                        }}>
                        {group.variants.map(variant => (
                          <option key={variant.id} value={variant.id}>#{variant.id} · {variant.color}</option>
                        ))}
                      </select>
                    </label>
                    <div className="reference-integrity-items">
                      {group.variants.map(variant => (
                        <div className="reference-integrity-item" key={variant.id}>
                          <span>{variant.color} · вариант #{variant.id}{variant.id === keeperId ? ' · основной' : ''}</span>
                          <span>{variant.physical} шт. · резерв {variant.reserved}</span>
                          {variant.id !== keeperId ? (
                            <button type="button" className="secondary compact" disabled={skuPreviewBusy || actionBusy}
                              onClick={() => void inspectSku(variant.id, keeperId)}>
                              {skuPreviewBusy && skuSelected === variant.id + ':' + keeperId ? 'Проверяю…' : 'Проверить объединение'}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </>
          )}
          {skuLimited ? <p className="mini-panel-note">Каталог большой: показана только часть возможных совпадений.</p> : null}
          <p className="mini-panel-note">Сначала выберите основной вариант. Система объединит физические остатки и согласованные резервы по складу и бутику. Если действующие заказы или обратимые операции требуют отдельной проверки, она объяснит причину без списания.</p>
        </div>
      ) : null}
      <div className="reference-integrity-results">
        <button className="secondary compact" type="button" disabled={historyBusy} onClick={() => void loadMergeHistory()}>
          {historyBusy ? 'Загружаю историю…' : mergeHistory === null ? 'История объединений вариантов' : 'Обновить историю объединений'}
        </button>
        {mergeHistory !== null ? (
          <div className="reference-integrity-items">
            {!mergeHistory.length ? <p className="mini-panel-note">Варианты ещё не объединялись.</p> : null}
            {mergeHistory.map(item => (
              <div className="reference-integrity-item" key={item.id}>
                <span>
                  <strong>{item.productName}</strong> · {item.material || 'Стандарт'} · {item.length || 'Стандарт'} ·
                  {' '}{item.sourceColor || 'Без цвета'} · {item.size || 'Без размера'}
                </span>
                <span>Вариант #{item.sourceId} → #{item.targetId} · {item.createdBy || 'Администратор'} · {new Date(item.createdAt).toLocaleString('ru-RU')}</span>
              </div>
            ))}
            {mergeHistory.length >= 30 ? <p className="mini-panel-note">Показаны 30 последних объединений.</p> : null}
          </div>
        ) : null}
      </div>
      {skuPreview ? (
        <div className="reference-integrity-preview">
          <h4>Проверка объединения вариантов</h4>
          <p><strong>{skuPreview.productName}</strong> · {skuPreview.material} · {skuPreview.length}</p>
          <p>Вариант #{skuPreview.source.id} → основной вариант #{skuPreview.target.id}</p>
          <p>{skuPreview.explanation}</p>
          <p className="mini-panel-note">
            Лишний вариант: {skuPreview.sourceImpact.physical} шт., резерв {skuPreview.sourceImpact.reserved},
            связанных действующих резервов {skuPreview.reservationCount}, исторических строк заказов {skuPreview.sourceImpact.historicalOrders}.
            Основной вариант: {skuPreview.targetImpact.physical} шт., резерв {skuPreview.targetImpact.reserved}.
          </p>
          <div className="reference-integrity-items">
            {skuPreview.stockBreakdown.map(place => (
              <div className="reference-integrity-item" key={place.location}>
                <strong>{place.location === 'warehouse' ? 'Склад' : 'Бутик'}</strong>
                <span>{place.sourcePhysical} + {place.targetPhysical} = {place.combinedPhysical} шт. после объединения</span>
                <span>Резервы: {place.sourceReserved} + {place.targetReserved} = {place.sourceReserved + place.targetReserved} шт.</span>
              </div>
            ))}
          </div>
                    {skuPreview.blockers.length ? (
            <div className="notice" role="status">
              <strong>Пока нельзя выполнить:</strong>
              <ul>{skuPreview.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>
            </div>
          ) : null}
          {skuPreview.canConsolidate ? (
            <div className="actions">
              <button className="primary compact" type="button" disabled={actionBusy} onClick={() => void consolidateSku()}>
                {actionBusy ? 'Проверяю и сохраняю…' : skuPreview.transferQuantity > 0 || skuPreview.reservationCount > 0 ? 'Объединить варианты и резервы' : 'Убрать дублирующий вариант'}
              </button>
            </div>
          ) : null}
          <p className="mini-panel-note">Остатки и действующие резервы сохраняются в своих местах хранения. Текущие заказы получают основной вариант, но цены, названия, оплаты и исторические складские движения не переписываются.</p>
        </div>
      ) : null}
      {preview ? (
        <div className="reference-integrity-preview">
          <h4>Что изменится при объединении</h4>
          <p><strong>{preview.source.value}</strong> → <strong>{preview.target.value}</strong></p>
          <p>{preview.explanation}</p>
          <p className="mini-panel-note">
            Связанных вариантов: {preview.summary.matchedVariantCount};
            активных для лишнего значения: {preview.summary.sourceActiveVariants};
            исполнений: {preview.summary.activeExecutions};
            остаток связанных вариантов: {preview.summary.physical};
            резерв: {preview.summary.reserved}.
          </p>
          {preview.summary.variantLimitReached ? <p className="mini-panel-note">Показана лишь часть вариантов. Объединять пока небезопасно.</p> : null}
          {preview.sampleVariants.length ? (
            <div className="reference-integrity-variants">
              {preview.sampleVariants.map(item => (
                <div key={item.id} className="reference-integrity-variant">
                  <span>{item.productName} · {item.material || 'Стандарт'} · {item.length || 'Стандарт'} · {item.color || 'Без цвета'} · {item.size || 'Без размера'}</span>
                  <span>{item.belongsTo === 'source' ? 'Лишнее значение' : 'Основное'} · {item.active ? 'Активно' : 'Архив'} · {item.physical} шт. · резерв {item.reserved}</span>
                </div>
              ))}
            </div>
          ) : null}
          {preview.safeToHideSource && preview.source.isActive ? (
            <div className="actions">
              <button className="primary compact" type="button" disabled={actionBusy} onClick={() => void hideSafeSource()}>
                {actionBusy ? 'Проверяю и сохраняю…' : 'Убрать лишнее значение из выбора'}
              </button>
            </div>
          ) : null}
          <p className="mini-panel-note">Складские остатки и история никогда не переносятся этим действием.</p>
        </div>
      ) : null}
    </section>
  )
}

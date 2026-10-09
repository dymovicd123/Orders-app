import { useState } from 'react'

type DuplicateValue = { id: number; value: string; isActive: boolean }
type DuplicateGroup = { kind: string; identity: string; suggestedTargetId: number; items: DuplicateValue[] }
type DuplicateResponse = { ok?: boolean; groups?: DuplicateGroup[]; limited?: boolean; message?: string }
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
}: {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  isAdmin: boolean;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [limited, setLimited] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')

  if (!isAdmin) return null

  async function scan() {
    if (loading) return
    setLoading(true)
    setError('')
    setPreview(null)
    setSelected('')
    try {
      const response = await apiFetch('/api/reference-values/duplicates')
      const data = await response.json() as DuplicateResponse
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось проверить справочники.')
      setGroups(Array.isArray(data.groups) ? data.groups : [])
      setLimited(Boolean(data.limited))
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
          <p className="mini-panel-note">Результат только для ознакомления. Автоматический перенос остатков и истории не выполняется.</p>
        </div>
      ) : null}
    </section>
  )
}

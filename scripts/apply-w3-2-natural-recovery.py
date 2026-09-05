from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def replace_region(path: str, start: str, end: str, transform) -> None:
    text = read(path)
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'{path}: start marker missing: {start!r}')
    b = text.find(end, a + len(start))
    if b < 0:
        raise SystemExit(f'{path}: end marker missing: {end!r}')
    region = text[a:b]
    new_region = transform(region)
    write(path, text[:a] + new_region + text[b:])


# -----------------------------------------------------------------------------
# 1. Recovery action hook: clarification is only handover/identity; known intake
#    remains separate. A successful physical check never becomes a false failure
#    just because the following read refresh failed.
# -----------------------------------------------------------------------------
actions = '''import { useEffect, useState } from 'react'

type AttentionCategory = 'handover' | 'intake' | 'identify'

type InventoryAttentionActionsInput = {
  activeSector: string
  inventoryPanel: string
  simpleStockDetail: any
  quickStocktakeBusy: boolean
  quickStocktakeValues: Record<string, string>
  setQuickStocktakeBusy: (value: boolean) => void
  setQuickStocktakeValues: (value: Record<string, string>) => void
  setQuickStocktakeNotice: (value: string) => void
  setQuickStocktakeOpen: (value: boolean) => void
  setSimpleStockDetail: (value: any) => void
  setCatalogAdminMode: (value: 'lifecycle' | 'review') => void
  setCatalogReviewTaskIndex: (value: number) => void
  setInventoryLifecycleTaskIndex: (value: number) => void
  loadWarehouseAttention: (details?: boolean) => Promise<any>
  loadInventoryLifecycle: (force?: boolean) => Promise<any>
  loadCatalogReview: (force?: boolean) => Promise<any>
  reconcileKnownInventoryLifecycle: (eventId: number) => Promise<any>
  quickInventoryStocktake: (input: any) => Promise<any>
  loadInventoryData: (...args: any[]) => Promise<any>
  openInventoryPanel: (panel: any) => void
  openOrderStockHandoverById: (orderId: number, externalId?: string) => any
}

function attentionCategoryCount(data: any, category: AttentionCategory) {
  if (!data?.counts) return 0
  if (category === 'handover') return Number(data.counts.handover || 0)
  if (category === 'intake') return Number(data.counts.intake || 0)
  return Number(data.counts.lifecycle || 0) + Number(data.counts.catalog || 0)
}

export function useInventoryAttentionActions(input: InventoryAttentionActionsInput) {
  const {
    activeSector,
    inventoryPanel,
    simpleStockDetail,
    quickStocktakeBusy,
    quickStocktakeValues,
    setQuickStocktakeBusy,
    setQuickStocktakeValues,
    setQuickStocktakeNotice,
    setQuickStocktakeOpen,
    setSimpleStockDetail,
    setCatalogAdminMode,
    setCatalogReviewTaskIndex,
    setInventoryLifecycleTaskIndex,
    loadWarehouseAttention,
    loadInventoryLifecycle,
    loadCatalogReview,
    reconcileKnownInventoryLifecycle,
    quickInventoryStocktake,
    loadInventoryData,
    openInventoryPanel,
    openOrderStockHandoverById,
  } = input
  const [attentionLoading, setAttentionLoading] = useState(false)
  const [attentionError, setAttentionError] = useState('')
  const [attentionCategory, setAttentionCategory] = useState<AttentionCategory>('handover')
  const [attentionIntakeBusyId, setAttentionIntakeBusyId] = useState<number | null>(null)

  async function applyQuickStocktake(countedOverride?: number) {
    if (!simpleStockDetail?.variantId || simpleStockDetail.aggregate || quickStocktakeBusy) return
    const raw = countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)
    if (raw === '') {
      setQuickStocktakeNotice('Введите фактическое количество этой позиции.')
      return
    }
    const countedQuantity = Number(raw)
    if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
      setQuickStocktakeNotice('Фактическое количество должно быть целым числом 0 или больше.')
      return
    }
    setQuickStocktakeBusy(true)
    setQuickStocktakeNotice('')
    try {
      const result = await quickInventoryStocktake({
        source: simpleStockDetail.source,
        variantId: simpleStockDetail.variantId,
        expectedQuantity: simpleStockDetail.physical,
        countedQuantity,
      })
      if (!result?.ok) {
        setQuickStocktakeNotice(result?.message || 'Сверку пока нельзя применить.')
        if (result?.code === 'changed') {
          const current = result?.conflicts?.find((row: any) => Number(row.variantId) === Number(simpleStockDetail.variantId))
          if (current) setSimpleStockDetail((detail: any) => detail ? { ...detail, physical: Number(current.currentQuantity || 0), free: Number(current.currentQuantity || 0) - Number(detail.reserved || 0) } : detail)
        }
        return
      }
      const physical = Number(result.physical || 0)
      const reserved = Number(result.reserved || 0)
      const successNotice = result.changed ? `Сохранено: ${result.previousQuantity} → ${physical}.` : `Проверено: на месте ${physical}. Всё совпало.`
      setSimpleStockDetail((detail: any) => detail ? { ...detail, physical, reserved, free: physical - reserved } : detail)
      setQuickStocktakeNotice(successNotice)
      setQuickStocktakeValues({})
      try {
        await loadInventoryData(simpleStockDetail.source, true, '', false)
      } catch {
        setQuickStocktakeNotice(`${successNotice} Остаток сохранён; список обновится при следующем обновлении.`)
      }
    } catch (error) {
      setQuickStocktakeNotice(error instanceof Error ? error.message : 'Не удалось сохранить сверку.')
    } finally {
      setQuickStocktakeBusy(false)
    }
  }

  async function refreshWarehouseAttention() {
    if (attentionLoading) return
    setAttentionLoading(true)
    setAttentionError('')
    try {
      const data = await loadWarehouseAttention(true)
      if (!data?.items) throw new Error('Не удалось загрузить список вопросов склада. Нажмите «Обновить» и попробуйте ещё раз.')
    } catch (error) {
      setAttentionError(error instanceof Error ? error.message : 'Не удалось обновить вопросы склада.')
    } finally {
      setAttentionLoading(false)
    }
  }

  useEffect(() => {
    if (activeSector !== 'inventory' || inventoryPanel !== 'attention') return
    void refreshWarehouseAttention()
  }, [activeSector, inventoryPanel])

  async function openAttentionLifecycle(item: any) {
    setCatalogAdminMode('lifecycle')
    openInventoryPanel('catalog')
    const data = await loadInventoryLifecycle(true)
    const index = Array.isArray(data?.items) ? data.items.findIndex((row: any) => Number(row.id) === Number(item.id)) : -1
    setInventoryLifecycleTaskIndex(index >= 0 ? index : 0)
  }

  async function openAttentionCatalog(item: any) {
    setCatalogAdminMode('review')
    openInventoryPanel('catalog')
    const data = await loadCatalogReview(true)
    const groups = Array.isArray(data?.groups) ? data.groups : Array.isArray(data?.items) ? data.items : []
    const index = groups.findIndex((row: any) => Number(row.orderItemId || row.order_item_id) === Number(item.orderItemId))
    setCatalogReviewTaskIndex(index >= 0 ? index : 0)
  }

  async function openAttentionIntake(item: any) {
    if (!item?.id || attentionIntakeBusyId !== null) return
    setAttentionIntakeBusyId(Number(item.id))
    setAttentionError('')
    try {
      const result = await reconcileKnownInventoryLifecycle(Number(item.id))
      if (!result?.ok) setAttentionError(result?.message || 'Не удалось завершить приёмку.')
      else if (!result?.warehouseAttention) await loadWarehouseAttention(true)
    } catch (error) {
      setAttentionError(error instanceof Error ? error.message : 'Не удалось завершить приёмку.')
    } finally {
      setAttentionIntakeBusyId(null)
    }
  }

  function openAttentionHandover(item: any) {
    void openOrderStockHandoverById(Number(item.orderId || 0), String(item.externalId || ''))
  }

  return {
    applyQuickStocktake,
    attentionCategory,
    attentionError,
    attentionIntakeBusyId,
    attentionLoading,
    openAttentionCatalog,
    openAttentionHandover,
    openAttentionIntake,
    openAttentionLifecycle,
    refreshWarehouseAttention,
    setAttentionCategory,
  }
}
'''
write('src/features/inventory/useInventoryAttentionActions.ts', actions)


# -----------------------------------------------------------------------------
# 2. Human recovery UI: known physical intake is a separate secondary surface;
#    clarification contains only handover ambiguity and identity ambiguity.
# -----------------------------------------------------------------------------
attention = '''import type { InventoryRenderContext } from './types'

type AttentionCategory = 'handover' | 'intake' | 'identify'

type PanelContext = Pick<InventoryRenderContext,
  | 'attentionCategory'
  | 'attentionError'
  | 'attentionIntakeBusyId'
  | 'attentionLoading'
  | 'formatDateShort'
  | 'inventoryPanelStyle'
  | 'isAdmin'
  | 'openAttentionCatalog'
  | 'openAttentionHandover'
  | 'openAttentionIntake'
  | 'openAttentionLifecycle'
  | 'refreshWarehouseAttention'
  | 'setAttentionCategory'
  | 'sourceLabel'
  | 'warehouseAttention'
>

function detailLine(item: any) {
  return [item.color, item.size, item.material && item.material !== 'СТАНДАРТ' ? item.material : '', item.length && item.length !== 'СТАНДАРТ' ? item.length : '', item.gender].filter(Boolean).join(' · ')
}

function formatDateTime(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function renderInventoryAttentionPanel(ctx: PanelContext) {
  const {
    attentionCategory,
    attentionError,
    attentionIntakeBusyId,
    attentionLoading,
    formatDateShort,
    inventoryPanelStyle,
    isAdmin,
    openAttentionCatalog,
    openAttentionHandover,
    openAttentionIntake,
    openAttentionLifecycle,
    refreshWarehouseAttention,
    setAttentionCategory,
    sourceLabel,
    warehouseAttention,
  } = ctx
  const items = warehouseAttention?.items
  const counts = warehouseAttention?.counts
  const categoryCounts: Record<AttentionCategory, number> = {
    handover: Number(counts?.handover || 0),
    intake: Number(counts?.intake || 0),
    identify: Number(counts?.lifecycle || 0) + Number(counts?.catalog || 0),
  }
  const clarificationTotal = categoryCounts.handover + categoryCounts.identify
  const isIntake = attentionCategory === 'intake'
  const tabs: Array<{ value: Exclude<AttentionCategory, 'intake'>; label: string }> = [
    { value: 'handover', label: 'Выдача' },
    { value: 'identify', label: 'Товар' },
  ]

  return (
    <div className="inventory-attention-panel" style={inventoryPanelStyle('attention')}>
      <div className="inventory-attention-head">
        <div>
          <h3>{isIntake ? 'Ожидают приёма' : 'Нужно уточнить'}</h3>
          <p>{isIntake
            ? 'Товар уже известен. Если вещь действительно уже у вас, можно завершить приёмку; если вы сейчас не рядом со складом или не уверены — просто оставьте её как есть.'
            : 'Здесь остаются только вопросы, где системе действительно не хватает факта: что именно выдали или какой это товар. Нехватка и ревизии решаются в своих обычных разделах.'}</p>
        </div>
        <button className="secondary compact" type="button" onClick={refreshWarehouseAttention} disabled={attentionLoading}>{attentionLoading ? 'Обновляю…' : 'Обновить'}</button>
      </div>

      {attentionError ? <div className="inventory-attention-error">{attentionError}</div> : null}
      {attentionLoading && !items ? <div className="empty-state">Загружаю складские вопросы…</div> : null}
      {warehouseAttention && !isIntake && clarificationTotal === 0 ? <div className="inventory-attention-clear"><strong>Уточнять ничего не нужно</strong><span>Можно продолжать обычную работу.</span></div> : null}
      {warehouseAttention && isIntake && categoryCounts.intake === 0 ? <div className="inventory-attention-clear"><strong>Сейчас ничего не ждёт приёмки</strong><span>Если такая вещь появится, она будет показана здесь отдельно от вопросов по данным.</span></div> : null}

      {warehouseAttention && !isIntake && clarificationTotal > 0 ? (
        <>
          <div className="inventory-attention-summary">
            <strong>Нужно уточнить: {clarificationTotal}</strong>
            <span>Только вопросы, которые нельзя надёжно закрыть по уже известным данным или свежему физическому факту.</span>
          </div>
          <div className="inventory-attention-tabs" role="tablist" aria-label="Что нужно уточнить">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={attentionCategory === tab.value}
                className={attentionCategory === tab.value ? 'is-active' : ''}
                onClick={() => setAttentionCategory(tab.value)}
              >
                <span>{tab.label}</span><b>{categoryCounts[tab.value]}</b>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {items && attentionCategory === 'handover' ? (
        <section className="inventory-attention-group is-handover">
          <div className="inventory-attention-group-head"><div><strong>Уточнить выдачу</strong><span>Исторический вопрос по конкретному заказу. Если сейчас нет возможности проверить его — заказ можно оставить и вернуться позже.</span></div><b>{categoryCounts.handover}</b></div>
          {items.handover.length ? <div className="inventory-attention-list">
            {items.handover.map((item: any) => (
              <article key={`attention-handover-${item.orderId}-${item.orderItemId}`}>
                <div className="inventory-attention-main">
                  <strong>{item.productName}</strong>
                  <span>{item.itemDetails || 'Без дополнительных характеристик'} · {sourceLabel(item.source)}</span>
                  <small>Заказ {item.externalId || item.orderId}{item.customerName ? ` · ${item.customerName}` : ''} · от {formatDateShort(item.orderDate)}</small>
                  <small>{item.itemCreatedAt ? `Позиция в учёте с ${formatDateTime(item.itemCreatedAt)} · ` : ''}{item.checkpointAt ? `${item.checkpointKind === 'revision' ? 'ревизия' : 'сверка'} ${formatDateShort(item.checkpointAt)}` : ''}</small>
                  <small>{item.reviewReason === 'late_entry' ? 'Причина: позиция была внесена после физической проверки.' : 'Причина: смешанный заказ, после резерва была физическая проверка.'}</small>
                </div>
                <button className="secondary compact" type="button" onClick={() => openAttentionHandover(item)}>Открыть заказ</button>
              </article>
            ))}
          </div> : <div className="empty-state">Уточнений выдачи сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'intake' ? (
        <section className="inventory-attention-group is-intake">
          <div className="inventory-attention-group-head"><div><strong>Вещь уже можно определить точно</strong><span>Принимайте только если вещь действительно находится у вас. Ничего подтверждать заранее или удалённо не требуется.</span></div><b>{categoryCounts.intake}</b></div>
          {items.intake?.length ? <div className="inventory-attention-list">
            {items.intake.map((item: any) => (
              <article key={`attention-intake-${item.id}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Товар'}</strong><span>{detailLine(item) || 'Стандартный вариант'} · {sourceLabel(item.source)}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}{item.createdAt ? ` · событие ${formatDateTime(item.createdAt)}` : ''}</small></div>
                <button className="primary compact" type="button" disabled={attentionIntakeBusyId !== null} onClick={() => void openAttentionIntake(item)}>{attentionIntakeBusyId === item.id ? 'Проверяю…' : 'Принять в остаток'}</button>
              </article>
            ))}
          </div> : <div className="empty-state">Известных позиций, ожидающих приёмки, сейчас нет.</div>}
        </section>
      ) : null}

      {items && attentionCategory === 'identify' ? (
        <section className="inventory-attention-group is-identify">
          <div className="inventory-attention-group-head"><div><strong>Определить товар</strong><span>Здесь только позиции, которым действительно не хватает точной идентичности.</span></div><b>{categoryCounts.identify}</b></div>
          {(items.lifecycle.length || items.catalog.length) ? <div className="inventory-attention-list">
            {(items.lifecycle || []).map((item: any) => (
              <article key={`attention-lifecycle-${item.id}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'} · {sourceLabel(item.source)}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionLifecycle(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Требуется администратор</span>}
              </article>
            ))}
            {(items.catalog || []).map((item: any) => (
              <article key={`attention-catalog-${item.orderItemId}`}>
                <div className="inventory-attention-main"><strong>{item.productName || 'Неизвестный товар'}</strong><span>{detailLine(item) || 'Характеристики не определены'}</span><small>{item.externalId ? `Заказ ${item.externalId} · от ${formatDateShort(item.orderDate)}` : ''}{item.affectedCount > 1 ? ` · похожих позиций: ${item.affectedCount}` : ''}</small></div>
                {isAdmin ? <button className="secondary compact" type="button" onClick={() => void openAttentionCatalog(item)}>Разобрать</button> : <span className="inventory-attention-admin-note">Требуется администратор</span>}
              </article>
            ))}
          </div> : <div className="empty-state">Неопределённых товаров сейчас нет.</div>}
        </section>
      ) : null}
    </div>
  )
}
'''
write('src/features/inventory/views/renderInventoryAttentionPanel.tsx', attention)


# -----------------------------------------------------------------------------
# 3. Inventory controller: separate intake nav, honest clarification badge, and
#    remove obsolete shortage/revision Attention actions from the hook boundary.
# -----------------------------------------------------------------------------
section = 'src/features/sections/InventorySection.tsx'

def clean_attention_hook(region: str) -> str:
    for line in [
        '    setSimpleStockSource,\n',
        '    setSimpleStockReservations,\n',
        '    setSimpleStockReservationsBusy,\n',
        '    setStocktakeSource,\n',
        '    loadInventoryReservations,\n',
    ]:
        if line not in region:
            raise SystemExit(f'InventorySection hook region missing {line!r}')
        region = region.replace(line, '', 1)
    return region

replace_region(section, '  } = useInventoryAttentionActions({', '\n\n\n  useEffect(() => {\n    if (activeSector !== \'inventory\' || inventoryPanel !== \'movement\'', clean_attention_hook)

replace_once(
    section,
    """    openAttentionIntake,\n    openAttentionLifecycle,\n    openAttentionShortage,\n    openAttentionStocktake,\n    refreshWarehouseAttention,""",
    """    openAttentionIntake,\n    openAttentionLifecycle,\n    refreshWarehouseAttention,""",
)

replace_once(
    section,
    """  })\n\n\n  useEffect(() => {\n    if (activeSector !== 'inventory' || inventoryPanel !== 'movement'""",
    """  })\n\n  const warehousePendingIntakeCount = Number(warehouseAttention?.counts?.intake || 0)\n  const warehouseClarificationCount = Number(warehouseAttention?.counts?.handover || 0)\n    + Number(warehouseAttention?.counts?.lifecycle || 0)\n    + Number(warehouseAttention?.counts?.catalog || 0)\n\n  useEffect(() => {\n    if (activeSector !== 'inventory' || inventoryPanel !== 'movement'""",
)

old_nav = '''                <div className="warehouse-w2-secondary">
                  <button type="button" className={`warehouse-w2-recovery ${inventoryPanel === 'attention' ? 'is-active' : ''}`} onClick={() => openInventoryPanel('attention')} title="Вопросы, которые нельзя безопасно решить автоматически">
                    <span>Нужно уточнить</span>{Number(warehouseAttention?.total || 0) > 0 ? <b>{warehouseAttention?.total}</b> : null}
                  </button>
                  {isAdmin ? <button type="button" className={inventoryPanel === 'catalog' ? 'is-active' : ''} onClick={() => openInventoryPanel('catalog')} title="Товары и характеристики">Товары</button> : null}
                </div>'''
new_nav = '''                <div className="warehouse-w2-secondary">
                  {warehousePendingIntakeCount > 0 ? <button type="button" className={`warehouse-w2-recovery warehouse-w3-intake ${inventoryPanel === 'attention' && attentionCategory === 'intake' ? 'is-active' : ''}`} onClick={() => { setAttentionCategory('intake'); openInventoryPanel('attention') }} title="Известные вещи, которые ещё не приняты в физический остаток">
                    <span>Ожидают приёма</span><b>{warehousePendingIntakeCount}</b>
                  </button> : null}
                  <button type="button" className={`warehouse-w2-recovery ${inventoryPanel === 'attention' && attentionCategory !== 'intake' ? 'is-active' : ''}`} onClick={() => { setAttentionCategory(Number(warehouseAttention?.counts?.handover || 0) > 0 ? 'handover' : 'identify'); openInventoryPanel('attention') }} title="Только вопросы, где системе действительно не хватает факта">
                    <span>Нужно уточнить</span>{warehouseClarificationCount > 0 ? <b>{warehouseClarificationCount}</b> : null}
                  </button>
                  {isAdmin ? <button type="button" className={inventoryPanel === 'catalog' ? 'is-active' : ''} onClick={() => openInventoryPanel('catalog')} title="Товары и характеристики">Товары</button> : null}
                </div>'''
replace_once(section, old_nav, new_nav)


def clean_attention_render(region: str) -> str:
    for line in [
        '        openAttentionShortage,\n',
        '        openAttentionStocktake,\n',
    ]:
        if line not in region:
            raise SystemExit(f'InventorySection Attention render missing {line!r}')
        region = region.replace(line, '', 1)
    return region

replace_region(section, '              {renderInventoryAttentionPanel({', '\n\n              {renderInventoryHealthPanel({', clean_attention_render)


# -----------------------------------------------------------------------------
# 4. Small visual distinction for physically-known pending intake. Reuse the W2
#    secondary navigation layout and add only a quiet green badge.
# -----------------------------------------------------------------------------
css = 'src/styles/188b-human-inventory-ui.css'
css_text = read(css)
marker = '/* W3.2 — known physical intake is separate from clarification. */'
if marker in css_text:
    raise SystemExit('W3.2 CSS already present')
write(css, css_text.rstrip() + '''\n\n/* W3.2 — known physical intake is separate from clarification. */
.warehouse-w3-intake b{background:rgba(34,139,83,.13);color:#166534}
.warehouse-w3-intake.is-active b{background:rgba(34,139,83,.18)}
''')


# -----------------------------------------------------------------------------
# 5. Lifecycle disposition: a newer exact physical check is sufficient evidence
#    to retire an older pending inbound even without a full-stocktake baseline.
#    Fresh Workshop return creation opts out of this extra historical read.
# -----------------------------------------------------------------------------
lifecycle = 'worker/domains/lifecycle.ts'
text = read(lifecycle)
start = text.find('export async function inventoryLifecycleDeferredInboundDisposition(')
end = text.find('\n\n\nexport async function supersedeInventoryLifecycleInboundWithoutStockChange', start)
if start < 0 or end < 0:
    raise SystemExit('Lifecycle disposition region not found')
new_disposition = '''export async function inventoryLifecycleDeferredInboundDisposition(
  db: D1Database,
  event: InventoryLifecycleEventRow,
  exactVariantId = 0,
  options: { checkLaterPhysical?: boolean } = {},
): Promise<InventoryLifecycleDeferredInboundDisposition> {
  if (cleanText(event.direction) !== 'in') return { action: 'apply', reason: 'not_inbound' };
  if (cleanText(event.status) !== 'pending') return { action: 'hold', reason: 'not_pending' };
  const createdAt = cleanText(event.created_at);

  // A newer exact physical count is already a stronger fact than an older pending
  // inbound. Check it before requiring a historical full-stocktake boundary so a
  // normal quick/selective check can retire stale uncertainty by itself.
  if (options.checkLaterPhysical !== false && exactVariantId > 0 && createdAt) {
    const laterPhysicalCheck = await db.prepare(
      `SELECT id FROM inventory_stock_checks
       WHERE inventory_source = ? AND variant_id = ? AND datetime(checked_at) >= datetime(?)
       ORDER BY datetime(checked_at) DESC, id DESC LIMIT 1`
    ).bind(normalizeSourceType(event.inventory_source), exactVariantId, createdAt).first<{ id: number }>();
    if (laterPhysicalCheck?.id) {
      return { action: 'supersede', reason: 'later_physical_check', laterCheckId: toInt(laterPhysicalCheck.id, 0) };
    }
  }

  const boundary = await trustedInventoryFullStocktakeBoundary(db, event.inventory_source);
  if (!boundary.trusted) {
    return {
      action: 'hold',
      reason: boundary.reason === 'ACTIVE_STOCKTAKE' ? 'active_stocktake' : 'no_trusted_baseline',
      boundarySessionId: boundary.sessionId,
      boundaryCompletedAt: boundary.completedAt,
    };
  }
  if (!createdAt || !boundary.startedAt || !boundary.completedAt) {
    return { action: 'hold', reason: 'no_trusted_baseline', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
  }
  if (createdAt < boundary.startedAt) {
    return { action: 'supersede', reason: 'stale_before_full_stocktake', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
  }
  if (createdAt <= boundary.completedAt) {
    return { action: 'hold', reason: 'overlaps_full_stocktake', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
  }
  return { action: 'apply', reason: 'fresh', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
}'''
write(lifecycle, text[:start] + new_disposition + text[end:])
replace_once(
    lifecycle,
    '  const disposition = await inventoryLifecycleDeferredInboundDisposition(db, event, exactVariantId);\n  return disposition.action === \'apply\';',
    "  const disposition = await inventoryLifecycleDeferredInboundDisposition(db, event, exactVariantId, { checkLaterPhysical: false });\n  return disposition.action === 'apply';",
)


# -----------------------------------------------------------------------------
# 6. Quick stocktake: the accepted physical fact and retirement of older known
#    Workshop inbound happen in the SAME D1 transaction. No follow-up read needed.
# -----------------------------------------------------------------------------
stocktake = 'worker/domains/inventory-stocktake.ts'
replace_once(
    stocktake,
    '''  const insertChecks = db.prepare(\n    `WITH expected(variant_id, expected_quantity, counted_quantity) AS (VALUES ${expectedValuesSql})\n     ${requestReferenceId ? 'INSERT' : 'INSERT OR IGNORE'} INTO inventory_stock_checks (\n       check_key, inventory_source, product_id, variant_id, expected_quantity, counted_quantity,\n       difference_quantity, reserved_quantity, check_type, reference_type, reference_id, checked_by, checked_at, created_at\n     )\n     SELECT ? || ':' || v.id, ?, v.product_id, v.id, e.expected_quantity, e.counted_quantity,\n            e.counted_quantity - e.expected_quantity,\n            COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.inventory_source = ? AND r.variant_id = v.id AND r.status = 'active'), 0),\n            ?, ?, ?, ?, ?, ?\n     FROM expected e\n     JOIN catalog_variants v ON v.id = e.variant_id`\n  ).bind(...expectedBindings, batchId, source, source, checkType, checkReferenceType, batchId, cleanText(options.actor) || null, now, now);\n\n  try {\n    await db.batch([guard, updateExisting, insertMissing, insertMovements, insertChecks]);''',
    '''  const insertChecks = db.prepare(\n    `WITH expected(variant_id, expected_quantity, counted_quantity) AS (VALUES ${expectedValuesSql})\n     ${requestReferenceId ? 'INSERT' : 'INSERT OR IGNORE'} INTO inventory_stock_checks (\n       check_key, inventory_source, product_id, variant_id, expected_quantity, counted_quantity,\n       difference_quantity, reserved_quantity, check_type, reference_type, reference_id, checked_by, checked_at, created_at\n     )\n     SELECT ? || ':' || v.id, ?, v.product_id, v.id, e.expected_quantity, e.counted_quantity,\n            e.counted_quantity - e.expected_quantity,\n            COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.inventory_source = ? AND r.variant_id = v.id AND r.status = 'active'), 0),\n            ?, ?, ?, ?, ?, ?\n     FROM expected e\n     JOIN catalog_variants v ON v.id = e.variant_id`\n  ).bind(...expectedBindings, batchId, source, source, checkType, checkReferenceType, batchId, cleanText(options.actor) || null, now, now);\n\n  const physicalFactResolution = 'Не добавлено повторно: более свежая физическая сверка уже зафиксировала текущий остаток.';\n  const supersedeKnownWorkshopInbound = db.prepare(\n    `UPDATE inventory_lifecycle_events\n     SET status = 'cancelled', pending_reason = NULL, cancelled_at = ?, updated_at = ?,\n         resolution_comment = CASE\n           WHEN COALESCE(resolution_comment, '') = '' THEN ?\n           ELSE resolution_comment || ' | ' || ?\n         END\n     WHERE status = 'pending' AND direction = 'in' AND is_workshop = 1\n       AND inventory_source = ? AND variant_id IN (${placeholders})\n       AND datetime(created_at) <= datetime(?)`\n  ).bind(now, now, physicalFactResolution, physicalFactResolution, source, ...variantIds, now);\n\n  try {\n    await db.batch([guard, updateExisting, insertMissing, insertMovements, insertChecks, supersedeKnownWorkshopInbound]);''',
)


# -----------------------------------------------------------------------------
# 7. Completed stocktake: retire only pending inbound that existed BEFORE the
#    exact SKU was counted. Events that happened after that count remain pending.
# -----------------------------------------------------------------------------
replace_once(
    stocktake,
    '''    db.prepare(\n      `UPDATE inventory_stocktake_items\n       SET status = 'applied', applied_quantity = counted_quantity, conflict_quantity = NULL, updated_at = ?\n       WHERE session_id = ?\n         AND ${hasCompletionLock}`\n    ).bind(now, sessionId, sessionId, completionLock),\n    db.prepare(\n      `UPDATE inventory_stocktake_sessions''',
    '''    db.prepare(\n      `UPDATE inventory_stocktake_items\n       SET status = 'applied', applied_quantity = counted_quantity, conflict_quantity = NULL, updated_at = ?\n       WHERE session_id = ?\n         AND ${hasCompletionLock}`\n    ).bind(now, sessionId, sessionId, completionLock),\n    db.prepare(\n      `UPDATE inventory_lifecycle_events\n       SET status = 'cancelled', pending_reason = NULL, cancelled_at = ?, updated_at = ?,\n           resolution_comment = CASE\n             WHEN COALESCE(resolution_comment, '') = '' THEN ?\n             ELSE resolution_comment || ' | ' || ?\n           END\n       WHERE status = 'pending' AND direction = 'in' AND is_workshop = 1 AND inventory_source = ?\n         AND EXISTS (\n           SELECT 1 FROM inventory_stocktake_items i\n           WHERE i.session_id = ?\n             AND i.variant_id = inventory_lifecycle_events.variant_id\n             AND i.variant_id IS NOT NULL\n             AND i.counted_quantity IS NOT NULL\n             AND i.counted_at IS NOT NULL\n             AND datetime(i.counted_at) >= datetime(inventory_lifecycle_events.created_at)\n         )\n         AND ${hasCompletionLock}`\n    ).bind(\n      now, now,\n      'Не добавлено повторно: завершённая физическая проверка уже зафиксировала текущий остаток.',\n      'Не добавлено повторно: завершённая физическая проверка уже зафиксировала текущий остаток.',\n      source, sessionId, sessionId, completionLock,\n    ),\n    db.prepare(\n      `UPDATE inventory_stocktake_sessions''',
)


# -----------------------------------------------------------------------------
# 8. Cumulative regressions: W2 expectations are intentionally superseded where
#    W3.2 moves count/revision out of the recovery inbox.
# -----------------------------------------------------------------------------
w2 = 'scripts/test-w2-human-warehouse.mjs'
replace_once(
    w2,
    '''  check(attention.includes('<h3>Нужно уточнить</h3>'), 'Recovery inbox heading is not human-readable')\n  check(attention.includes("{ value: 'revision', label: 'Проверка' }"), 'Recovery stocktake category still uses technical wording')\n  check(attention.includes('Требуется администратор'), 'Manager recovery rows do not explain admin-only cases')\n  check(attention.includes('Продолжить проверку'), 'Unfinished physical check has no clear continuation action')\n  check(attention.includes('Уточнять ничего не нужно'), 'Recovery empty state is unclear')''',
    '''  check(attention.includes("'Нужно уточнить'"), 'Recovery inbox heading is not human-readable')\n  check(attention.includes("'Ожидают приёма'"), 'Known physical intake is not separated from clarification')\n  check(!attention.includes("{ value: 'revision', label: 'Проверка' }") && !attention.includes("{ value: 'count', label: 'Количество' }"), 'Count/revision leaked back into secondary clarification')\n  check(attention.includes('Требуется администратор'), 'Manager recovery rows do not explain admin-only cases')\n  check(attention.includes('Уточнять ничего не нужно'), 'Recovery empty state is unclear')''',
)
replace_once(
    w2,
    "  check(nav.includes('warehouse-w2-recovery') && nav.includes('Нужно уточнить'), 'Recovery inbox is not a clear secondary action')",
    "  check(nav.includes('warehouse-w2-recovery') && nav.includes('Нужно уточнить'), 'Recovery inbox is not a clear secondary action')\n  check(nav.includes('Ожидают приёма') && nav.includes('warehousePendingIntakeCount'), 'Known intake is not a distinct secondary action')",
)

w2refresh = 'scripts/test-w2-attention-refresh-r1.mjs'
replace_once(w2refresh, "'  async function openAttentionShortage'", "'  async function openAttentionLifecycle'")


# -----------------------------------------------------------------------------
# 9. Extend frontend preservation chain with one exact W3.2 Attention delta.
# -----------------------------------------------------------------------------
preservation = 'scripts/test-step1906b-frontend-modularization.mjs'
replace_once(
    preservation,
    "const w3StockMicroCheckPath = path.join(root, 'scripts/w3-1b-stock-micro-check-frontend-manifest.json')",
    "const w3StockMicroCheckPath = path.join(root, 'scripts/w3-1b-stock-micro-check-frontend-manifest.json')\nconst w3NaturalRecoveryPath = path.join(root, 'scripts/w3-2-natural-recovery-frontend-manifest.json')",
)
replace_once(
    preservation,
    "  const w3StockMicroCheck = fs.existsSync(w3StockMicroCheckPath) ? JSON.parse(fs.readFileSync(w3StockMicroCheckPath, 'utf8')) : null",
    "  const w3StockMicroCheck = fs.existsSync(w3StockMicroCheckPath) ? JSON.parse(fs.readFileSync(w3StockMicroCheckPath, 'utf8')) : null\n  const w3NaturalRecovery = fs.existsSync(w3NaturalRecoveryPath) ? JSON.parse(fs.readFileSync(w3NaturalRecoveryPath, 'utf8')) : null",
)
replace_once(
    preservation,
    "  if (w3StockMicroCheck) check(w3StockMicroCheck.version === 1 && w3StockMicroCheck.revision === 'w3-1b-stock-micro-check', 'W3.1B stock micro-check frontend manifest invalid')",
    "  if (w3StockMicroCheck) check(w3StockMicroCheck.version === 1 && w3StockMicroCheck.revision === 'w3-1b-stock-micro-check', 'W3.1B stock micro-check frontend manifest invalid')\n  if (w3NaturalRecovery) check(w3NaturalRecovery.version === 1 && w3NaturalRecovery.revision === 'w3-2-natural-recovery', 'W3.2 natural recovery frontend manifest invalid')",
)
replace_once(
    preservation,
    '''    check(sha(normalize(expression.getText(parsed.source))) === change.after, 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2 delta')''',
    '''    let expectedAttentionHash = change.after\n    const naturalRecoveryAttention = w3NaturalRecovery?.frontend?.attentionReturnChange\n    if (naturalRecoveryAttention) {\n      check(naturalRecoveryAttention.before === expectedAttentionHash, 'W3.2 Attention baseline must match accepted W2 Attention delta')\n      expectedAttentionHash = naturalRecoveryAttention.after\n    }\n    check(sha(normalize(expression.getText(parsed.source))) === expectedAttentionHash, w3NaturalRecovery ? 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2/W3.2 deltas' : 'renderInventoryAttentionPanel: rendered JSX changed outside exact W2 delta')''',
)
replace_once(
    preservation,
    "${w3StockMicroCheck ? ', exact W3.1B stock micro-check frontend delta accepted' : ''}`)",
    "${w3StockMicroCheck ? ', exact W3.1B stock micro-check frontend delta accepted' : ''}${w3NaturalRecovery ? ', exact W3.2 natural-recovery Attention delta accepted' : ''}`)",
)


# -----------------------------------------------------------------------------
# 10. Focused W3.2 regression and release chain.
# -----------------------------------------------------------------------------
test = r'''import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const section = read('src/features/sections/InventorySection.tsx')
const attention = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const actions = read('src/features/inventory/useInventoryAttentionActions.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const stocktake = read('worker/domains/inventory-stocktake.ts')
const manifest = JSON.parse(read('scripts/w3-2-natural-recovery-frontend-manifest.json'))
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')

const between = (text, start, end) => {
  const a = text.indexOf(start)
  check(a >= 0, `Missing start: ${start}`)
  const b = text.indexOf(end, a + start.length)
  check(b > a, `Missing end: ${end}`)
  return text.slice(a, b)
}

check(section.includes('const warehousePendingIntakeCount = Number(warehouseAttention?.counts?.intake || 0)'), 'known intake count is not separated')
check(section.includes('const warehouseClarificationCount = Number(warehouseAttention?.counts?.handover || 0)') && section.includes('warehouseAttention?.counts?.lifecycle') && section.includes('warehouseAttention?.counts?.catalog'), 'clarification badge is not limited to true ambiguity')
const nav = between(section, '<div className="warehouse-w2-secondary">', '</div>\n              </div>')
check(nav.includes('Ожидают приёма') && nav.includes("setAttentionCategory('intake')"), 'known intake has no separate secondary entry')
check(nav.includes('Нужно уточнить') && nav.includes("? 'handover' : 'identify'"), 'clarification navigation does not select only true ambiguity')
check(!nav.includes('warehouseAttention?.total'), 'legacy all-problem total still drives clarification badge')

check(attention.includes("type AttentionCategory = 'handover' | 'intake' | 'identify'"), 'Attention still treats count/revision as recovery categories')
check(!attention.includes("value: 'count'") && !attention.includes("value: 'revision'"), 'count/revision tabs remain in clarification')
check(!attention.includes('items.shortages') && !attention.includes('items.stocktakes'), 'shortage/stocktake content remains inside clarification')
check(attention.includes("isIntake ? 'Ожидают приёма' : 'Нужно уточнить'"), 'intake and clarification are not presented as separate human surfaces')
check(attention.includes('если вы сейчас не рядом со складом или не уверены — просто оставьте её как есть'), 'intake UI became coercive instead of optional')
check(attention.includes('Нехватка и ревизии решаются в своих обычных разделах'), 'natural recovery location is not explained')

check(!actions.includes('openAttentionShortage') && !actions.includes('openAttentionStocktake'), 'obsolete recovery actions remain wired')
const quick = between(actions, '  async function applyQuickStocktake', '  async function refreshWarehouseAttention')
check(!quick.includes('loadWarehouseAttention('), 'successful quick check still spends a detailed Attention read')
check(quick.includes('const successNotice') && quick.includes('Остаток сохранён; список обновится при следующем обновлении.'), 'post-write refresh can still make a successful check look failed')
const intake = between(actions, '  async function openAttentionIntake', '  function openAttentionHandover')
check(intake.includes('else if (!result?.warehouseAttention) await loadWarehouseAttention(true)'), 'intake no longer reuses an already returned Attention payload')

const disposition = between(lifecycle, 'export async function inventoryLifecycleDeferredInboundDisposition(', 'export async function supersedeInventoryLifecycleInboundWithoutStockChange')
const laterPos = disposition.indexOf('SELECT id FROM inventory_stock_checks')
const boundaryPos = disposition.indexOf('trustedInventoryFullStocktakeBoundary')
check(laterPos >= 0 && boundaryPos > laterPos, 'newer exact physical fact is still ignored until after full-stocktake boundary')
check(disposition.includes('options.checkLaterPhysical !== false'), 'fresh-event read optimization missing')
check(lifecycle.includes("inventoryLifecycleDeferredInboundDisposition(db, event, exactVariantId, { checkLaterPhysical: false })"), 'fresh Workshop intake pays an unnecessary historical-check read')

const quickBatch = between(stocktake, 'export async function quickInventoryStocktakeBatch(', 'export async function quickInventoryStocktake(')
check(quickBatch.includes('supersedeKnownWorkshopInbound') && quickBatch.includes("status = 'pending' AND direction = 'in' AND is_workshop = 1"), 'quick physical fact does not retire older known Workshop intake')
check(quickBatch.includes('await db.batch([guard, updateExisting, insertMissing, insertMovements, insertChecks, supersedeKnownWorkshopInbound])'), 'physical fact and intake retirement are not atomic')
const completion = between(stocktake, 'export async function completeInventoryStocktakeSession(', 'export async function cancelInventoryStocktakeSession')
check(completion.includes("UPDATE inventory_lifecycle_events") && completion.includes("datetime(i.counted_at) >= datetime(inventory_lifecycle_events.created_at)"), 'completed stocktake does not use per-SKU count time to retire older intake safely')
check(completion.includes("is_workshop = 1"), 'stocktake recovery is not narrowly scoped to known Workshop inbound')

check(manifest.version === 1 && manifest.revision === 'w3-2-natural-recovery', 'W3.2 frontend manifest invalid')
check(Boolean(manifest.frontend?.attentionReturnChange), 'W3.2 Attention preservation delta missing')
check(preservation.includes('w3NaturalRecoveryPath') && preservation.includes('W3.2 Attention baseline'), 'frontend preservation chain is unaware of W3.2')

check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.2 NATURAL RECOVERY PASSED — clarification is true ambiguity, intake is separate, and newer physical facts retire stale known intake without extra Attention reads')
'''
write('scripts/test-w3-2-natural-recovery.mjs', test)

pkg = 'package.json'
replace_once(
    pkg,
    ' && node scripts/test-w3-1b-stock-micro-check.mjs\",',
    ' && node scripts/test-w3-1b-stock-micro-check.mjs && node scripts/test-w3-2-natural-recovery.mjs\",',
)


docs = '''# W3.2 — Natural recovery: true clarification vs physical intake

Date: 2026-09-05
Base: W3.1B Production (`d52fc13a382ef77e97d9c049d56c7bd005aac5ad`)

## Goal

Make `Нужно уточнить` genuinely secondary. Ordinary stock shortages, physical checks and unfinished stocktakes belong to their normal work areas; the recovery surface should keep only questions that cannot be derived safely from known data or a newer physical fact.

## Human behavior

- `Нужно уточнить` now means only true ambiguity: historical handover uncertainty or unknown product/characteristics.
- Exact known physical inbound is shown separately as `Ожидают приёма` and only when such rows exist.
- The intake copy explicitly allows doing nothing when the employee is remote, busy or not sure the item is physically present.
- Shortage remains in `Остатки`, where W3.1B already provides a voluntary concrete `Проверить` action.
- Active stocktake remains in `Проверка`; it is not duplicated as a recovery inbox category.

## Natural self-healing

- A successful quick physical count and retirement of older matching known Workshop inbound are written in one D1 batch.
- A completed stocktake retires only matching pending Workshop inbound whose event existed no later than that exact SKU's `counted_at`; an inbound occurring after the count remains pending.
- Manual known-intake reconciliation recognizes a newer exact physical check before demanding an older full-stocktake baseline.
- Fresh Workshop return creation skips that historical-check lookup so the common write path does not spend an extra D1 read.

## Read / failure behavior

- Successful quick stocktake no longer performs a detailed Warehouse Attention read.
- Its inventory refresh is best-effort. A read failure after the write does not turn a successful physical fact into an apparent failed save.
- Warehouse Attention still loads details only when the user opens the secondary surface.

## Invariants

- No migration.
- Arrival UI frozen and untouched.
- Branch2 untouched.
- Reservation/write-off arithmetic unchanged.
- No mandatory stock check introduced.
- No background recovery/details preload introduced.
- Existing CAS protection for physical counts remains.

## Next

Continue W3 by auditing the remaining handover/identity exceptions and moving any resolvable case into its natural operational context. Do not turn `Нужно уточнить` back into a general task inbox.
'''
write('docs/continuation/W3_2_NATURAL_RECOVERY_20260905.md', docs)

print('W3.2 natural recovery patch applied')

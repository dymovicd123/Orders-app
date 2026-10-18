import '../../../styles/w4-writeoff-review.css'
import { useState } from 'react'
import { summarizeWriteoff, type WriteoffReviewInput } from '../writeoffReview'

type Props = {
  source: string;
  reason: string;
  lines: WriteoffReviewInput[];
  busy: boolean;
  sourceLoading: boolean;
  onConfirm: () => void;
}
export function WriteoffReview({source,reason,lines,busy,sourceLoading,onConfirm}: Props) {
  const [reviewedSignature,setReviewedSignature] = useState('')
  const summary = summarizeWriteoff(lines)
  const signature = JSON.stringify({source,reason:reason.trim(),rows:summary.rows.map(
    r=>[r.variantId,r.requested,r.physical,r.reserved]
  )})
  const reviewed = reviewedSignature === signature
  const ready = summary.valid && Boolean(reason.trim()) && !busy && !sourceLoading

  return <section className="inventory-writeoff-review" aria-label="Подтверждение списания">
    <div className="inventory-writeoff-review-heading">
      <div>
        <strong>Шаг 2 из 2 — проверка списания</strong>
        <p>Проверьте количество и последствия для заказов. Это реальное списание товара, а не исправление количества и не очистка дублей.</p>
      </div>
      <span>{summary.rows.length} поз. · {summary.totalRequested} шт.</span>
    </div>
    {!summary.rows.length ? <p className="inventory-writeoff-review-empty">Выберите товар и укажите количество для списания.</p> : (
      <div className="inventory-writeoff-review-items">
        {summary.rows.map(item=><div className="inventory-writeoff-review-row" key={item.variantId}>
          <div className="inventory-writeoff-review-item-name">
            <strong>{item.productName}</strong><small>{item.detail}</small>
          </div>
          <div><small>На месте</small><strong>{item.physical}</strong></div>
          <div><small>В заказах</small><strong>{item.reserved}</strong></div>
          <div><small>Списать</small><strong>{item.requested}</strong></div>
          <div><small>Останется</small><strong>{item.after}</strong></div>
          {item.newShortage>0 ? <p className="inventory-writeoff-review-caution">После списания для заказов дополнительно не хватит {item.newShortage} шт.</p> : null}
          {item.untracked>0 ? <p className="inventory-writeoff-review-caution">Списывается на {item.untracked} шт. больше учтённого. Система запросит подтверждение фактического количества и сохранит расхождение.</p> : null}
          {!item.validQuantity ? <p className="inventory-writeoff-review-caution">Количество должно быть положительным целым числом.</p> : null}
        </div>)}
      </div>
    )}
    {summary.totalNewShortage>0 ? <p className="inventory-writeoff-review-warning">Внимание: новые нехватки по действующим заказам — {summary.totalNewShortage} шт. Сами резервы списанием не отменяются.</p> : null}
    {summary.totalUntracked>0 ? <p className="inventory-writeoff-review-warning">Из {summary.totalRequested} шт. по учёту будут вычтены {summary.totalTracked} шт.; ещё {summary.totalUntracked} шт. потребуют отдельного подтверждения наличия.</p> : null}
    {!reason.trim() ? <p className="inventory-writeoff-review-hint">Выберите или напишите причину списания, чтобы продолжить.</p> : (
      <p className="inventory-writeoff-review-hint">Точка: {source}. Причина: {reason.trim()}.</p>
    )}
    <div className="inventory-writeoff-review-actions">
      {!reviewed ? (
        <button type="button" className="primary" disabled={!ready}
          onClick={()=>setReviewedSignature(signature)}>
          Проверить списание
        </button>
      ) : (
        <>
          <div className="inventory-writeoff-review-confirmation">
            <strong>Подтвердите списание {summary.totalRequested} шт.</strong>
            <span>Остатки изменятся после сохранения. Операция появится в истории склада.</span>
          </div>
          <button type="button" className="primary" disabled={!ready} onClick={onConfirm}>
            {busy ? 'Сохраняю…' : 'Подтвердить списание'}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={()=>setReviewedSignature('')}>
            Вернуться к проверке
          </button>
        </>
      )}
    </div>
  </section>
}

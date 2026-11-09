import type { Dispatch, SetStateAction } from 'react'
import type { OrderTableDispatchDraft, OrderTableDispatchHistoryLine } from './orderTableDispatchActions'
import { clampDispatchQuantity, dispatchSelectionError, dispatchLineAccessibleName } from './shippingSelection'

type Props = {
  draft: OrderTableDispatchDraft
  setDraft: Dispatch<SetStateAction<OrderTableDispatchDraft | null>>
  submitSelectedDispatch: () => void
  confirmIssuedOnlyDispatch: () => void
  cancelDispatchedLine: (line: OrderTableDispatchHistoryLine) => void
}

// Presentation-only: keep the exact ready/partial/prior-issued visibility rules,
// and let the original controller/Worker validate every quantity and state write.
export function OrderTableDispatchModal({
  draft,
  setDraft,
  submitSelectedDispatch,
  confirmIssuedOnlyDispatch,
  cancelDispatchedLine,
}: Props) {
  const dispatchDraft = draft
  const setDispatchDraft = setDraft
  return (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={event=>{if(event.target===event.currentTarget&&!dispatchDraft.submitting)setDispatchDraft(null)}}>
                  <div className="modal-card" role="dialog" aria-modal="true" aria-label="Отправка товаров"
                    style={{maxWidth:620,maxHeight:'88vh',overflowY:'auto'}}>
                    <div className="modal-head">
                      <div><div className="card-label">Отправка товаров</div>
                        <h3>{dispatchDraft.order.external_id}</h3></div>
                      <button type="button" className="ghost compact" disabled={dispatchDraft.submitting}
                        onClick={()=>setDispatchDraft(null)}>Закрыть</button>
                    </div>
                    {dispatchDraft.loading ? <p>Загружаю готовые товары…</p> : (
                      <>
                        {(dispatchDraft.plan?.lines||[]).map((line)=>{
                          const value=Number(dispatchDraft.selected[Number(line.orderItemId)]||0)
                          return <div key={line.orderItemId} style={{
                            display:'flex',alignItems:'center',gap:10,padding:'10px 0',
                            borderBottom:'1px solid var(--border-color,#e2e8f0)'}}>
                            <input type="checkbox" checked={value>0} disabled={!line.selectable||dispatchDraft.submitting}
                              aria-label={`Выбрать ${dispatchLineAccessibleName(line)}`}
                              onChange={event=>setDispatchDraft(d=>d?{...d,selected:{...d.selected,
                                [line.orderItemId]:event.target.checked?line.readyQuantity:0},error:''}:d)}/>
                            <div style={{flex:1,minWidth:0}}>
                              <strong>{line.productName}</strong>
                              <small style={{display:'block',opacity:.8}}>
                                {[line.color,line.size,line.material,line.length]
                                  .filter((part)=>String(part||'').trim() && String(part).trim().toUpperCase()!=='СТАНДАРТ').join(' · ')}
                                {[line.color,line.size,line.material,line.length]
                                  .some((part)=>String(part||'').trim() && String(part).trim().toUpperCase()!=='СТАНДАРТ') ? ' · ' : ''}
                                {line.sourceType==='workshop'?'Цех':line.sourceType==='boutique'?'Бутик':'Склад'}
                                {' · '}{line.dispatchPriorIssued
                                  ? 'По учёту уже выдан · отправка без повторного списания'
                                  : line.selectable?(line.needsStockConfirmation?`Доступно к отправке ${line.readyQuantity} шт. · понадобится подтверждение наличия`:`Готово ${line.readyQuantity} шт.`)
                                    : dispatchDraft.history.some((sent)=>Number(sent.orderItemId)===Number(line.orderItemId)
                                      && Number(sent.cancelledQuantity)<Number(sent.quantity))
                                      ? 'Уже отправлено — повторная отправка не нужна'
                                      : line.reason}
                              </small>
                            </div>
                            {line.selectable ? <input type="number" min={0} max={line.readyQuantity} step={1}
                              aria-label={`Количество ${dispatchLineAccessibleName(line)}`}
                              disabled={dispatchDraft.submitting||line.sourceType==='workshop'||line.dispatchPriorIssued} value={value}
                              style={{width:72,padding:6}}
                              onChange={event=>{const quantity=clampDispatchQuantity(event.target.value,line.readyQuantity,false)
                                setDispatchDraft(d=>d?{...d,error:'',selected:{...d.selected,
                                  [line.orderItemId]:quantity}}:d)}}/> : null}
                          </div>
                        })}
                        {(dispatchDraft.plan?.lines||[]).length===0 ? <p>В заказе нет товаров для отправки.</p> : null}
                        {dispatchDraft.plan?.canConfirmIssuedOnly ? (
                          <div style={{marginTop:16}}>
                            <p>По учётным записям товары ранее выдали со склада или отметили выданными при ревизии. Это само по себе не подтверждает отправку клиенту. Если товары действительно отправлены, отметьте отправку здесь; повторного списания не будет.</p>
                            <button className="primary" type="button"
                              disabled={dispatchDraft.submitting}
                              onClick={confirmIssuedOnlyDispatch}>
                              {dispatchDraft.submitting?'Сохраняю…':'Подтвердить отправку без повторного списания'}
                            </button>
                          </div>
                        ) : null}
                        {dispatchDraft.plan && !dispatchDraft.plan.canConfirmIssuedOnly
                          && !dispatchDraft.plan.selectedCount && dispatchDraft.plan.lines?.length ? (
                            <p role="status" aria-live="polite">
                              {dispatchDraft.history.some((sent)=>Number(sent.cancelledQuantity)<Number(sent.quantity))
                                ? 'По учёту отправка уже проведена. Повторно списывать эту вещь нельзя. Если отметка об отправке ошибочна и товар остался у вас, воспользуйтесь «Исправить ошибочную отправку» ниже. Если вещь действительно передали клиенту, ничего повторно делать не нужно.'
                                : 'Сейчас нет товаров, готовых к отправке. Посмотрите причину у каждой позиции. Система не позволит повторно списать уже выданную вещь.'}
                            </p>
                          ) : null}
                        {dispatchDraft.plan?.selectedCount ? (
                          <div className="toolbar-actions" style={{marginTop:16}}>
                            <button className="primary" type="button"
                              disabled={dispatchDraft.submitting||
                                Boolean(dispatchSelectionError(dispatchDraft.plan?.lines||[],dispatchDraft.selected))||
                                !(dispatchDraft.plan?.lines||[]).some((x)=>
                                  x.selectable&&Number(dispatchDraft.selected[x.orderItemId]||0)>0)}
                              onClick={submitSelectedDispatch}>
                              {dispatchDraft.submitting?'Сохраняю…':'Подтвердить отправку'}
                            </button>
                          </div>
                        ) : null}
                        {dispatchDraft.history.some((x)=>Number(x.cancelledQuantity)<Number(x.quantity)) ? (
                          <div style={{marginTop:24}}>
                            <h4>Ранее отправлено</h4>
                            {dispatchDraft.history.filter((x)=>Number(x.cancelledQuantity)<Number(x.quantity))
                              .map((x)=><div key={x.dispatchItemId}
                                style={{display:'flex',gap:12,alignItems:'center',padding:'8px 0'}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <strong>{x.productName}</strong>
                                  <small style={{display:'block',opacity:.8}}>
                                    {[x.color,x.size,x.material,x.length]
                                      .filter((part)=>String(part||'').trim() && String(part).trim().toUpperCase()!=='СТАНДАРТ').join(' · ')}
                                    {' · '}{x.quantity} шт. · Отправлено: {x.dispatchedAt
                                      ? new Date(x.dispatchedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
                                      : x.dispatchDate}
                                  </small>
                                </div>
                                {x.hasReturn||x.hasExchange ? (
                                  <small>{x.hasExchange?'Есть обмен':'Есть возврат'}</small>
                                ) : (
                                  <button type="button" className="secondary compact"
                                    disabled={dispatchDraft.submitting}
                                    onClick={()=>cancelDispatchedLine(x)}>Исправить ошибочную отправку</button>
                                )}
                              </div>)}
                          </div>
                        ) : null}
                        {dispatchDraft.error ? <p className="error" role="alert">{dispatchDraft.error}</p> : null}
                      </>
                    )}
                  </div>
                </div>
  )
}

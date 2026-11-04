import {useRef,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'

type Kind='product'|'execution'|'variant'
type DeleteInput={kind:Kind;watchProductId:number;watchVariantId?:number;
  movement?:string;braceletMaterial?:string}
type Preview={ok:boolean;message?:string;modelName?:string;count:number;
  canDelete:boolean;blockers?:string[];alreadyDeleted?:boolean;
  physicalQuantity?:number;activeReservations?:number;openOrders?:number;
  historicalOrderItems?:number;appliedPhysicalReturnExchangeCount?:number;inventoryWillBeRemoved?:boolean;
  reservationsWillBeReleased?:boolean}
export function WatchCatalogDeleteAction({brand,kind,watchProductId,watchVariantId,movement,
  braceletMaterial,label,onDeleted}:{
  brand:WatchBrand;kind:Kind;watchProductId:number;watchVariantId?:number;
  movement?:string;braceletMaterial?:string;label:string;onDeleted:()=>void
}){
  const [preview,setPreview]=useState<Preview|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const payload:DeleteInput={kind,watchProductId,watchVariantId,movement,braceletMaterial}
  const operationId=useRef<string>('')
  const call=async(path:string,body:Record<string,unknown>)=>{
    const response=await fetch('/api/client3/watches/catalog/'+path,{
      method:'POST',credentials:'include',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({brand,...body}),
    })
    const result=await response.json() as Preview
    if(!response.ok||!result.ok)throw new Error(result.message||'Операция не выполнена.')
    return result
  }
  const inspect=async()=>{
    setBusy(true);setError('');setNotice('')
    try{
      const next=await call('delete-preview',payload)
      if(next.alreadyDeleted){setNotice('Товар уже удалён. Обновите список.');return}
      operationId.current='watch-retire-'+crypto.randomUUID()
      setPreview(next)
    }catch(cause){setError(cause instanceof Error?cause.message:'Ошибка проверки удаления')}
    finally{setBusy(false)}
  }
  const confirm=async()=>{
    if(!preview||!preview.canDelete||busy)return
    setBusy(true);setError('')
    try{
      await call('delete',{...payload,expectedCount:preview.count,requestId:operationId.current})
      setPreview(null);operationId.current=''
      setNotice('Удалено из рабочего каталога. История заказов, складских движений и SKU сохранена.')
      onDeleted()
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Не удалось подтвердить удаление.')
    }finally{setBusy(false)}
  }
  return <>
    <span className="catalog-retirement-action">
      <button className="danger compact" type="button" disabled={busy}
        onClick={()=>void inspect()}>{busy?'Проверка…':label}</button>
      {notice&&<small role="status">{notice}</small>}
      {error&&!preview&&<small role="alert" className="catalog-retirement-error">{error}</small>}
    </span>
    {preview&&<div className="modal-backdrop catalog-retirement-backdrop" role="presentation"
      onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setPreview(null)}}>
      <section className="modal-card catalog-retirement-modal" role="dialog" aria-modal="true"
        aria-labelledby="watch-retirement-title">
        <div className="catalog-retirement-head">
          <span className="card-label">Проверка последствий · как в Main</span>
          <h3 id="watch-retirement-title">{label}?</h3>
          <p><strong>{preview.modelName}</strong> · затронуто позиций: {preview.count}.</p>
        </div>
        <div className="catalog-retirement-summary">
          <div><strong>{preview.count}</strong><span>активных комплектаций</span></div>
          <div><strong>{Number(preview.physicalQuantity||0)}</strong><span>физический остаток</span></div>
          <div><strong>{Number(preview.activeReservations||0)}</strong><span>активные резервы</span></div>
        </div>
        <div className="catalog-retirement-explanation">
          <p>Только выбранная позиция, исполнение или товар исчезнет из рабочего каталога.
            Старые заказы, идентификаторы SKU и складские движения сохраняются в истории.</p>
          {kind==='product'?<>
            <p>{preview.inventoryWillBeRemoved?
              'Main выведет существующий остаток из рабочего склада отдельной операцией с сохранением истории.':'Ненулевого остатка на рабочем складе нет.'}</p>
            <p>{preview.reservationsWillBeReleased?
              'Активные резервы будут освобождены. Заказы и их содержимое останутся в истории.':'Активных резервов у товара нет.'}</p>
          </>:<p>Для точной позиции и исполнения требуется нулевой остаток и отсутствие незавершённых операций. Физический склад, резервы и оплаты при таком удалении не изменяются.</p>}
          {Number(preview.historicalOrderItems||0)>0&&
            <p>Сохранится {preview.historicalOrderItems} исторических позиций заказов.</p>}
          {kind==='product'&&Number(preview.openOrders||0)>0&&
            <div className="catalog-retirement-modal-error" role="alert">
              <strong>Есть {preview.openOrders} позиций в незавершённых заказах.</strong>
              <p>При удалении товара складские резервы будут освобождены, но позиции останутся в заказах и логистике. Гравировку можно будет отметить готовой, а отправку — подтвердить в логистике после явного подтверждения физической передачи.</p>
              <p>В этом случае отправка фиксируется в журнале заказа <strong>без повторного складского списания и без восстановления удалённого SKU</strong>. Частичная отправка сохраняет оставшиеся часы отдельной позицией. Возврат в остаток удалённого SKU запрещён: полученные часы принимаются без зачисления в архивный склад.</p>
            </div>}
          {kind==='product'&&Number(preview.appliedPhysicalReturnExchangeCount||0)>0&&
            <div className="catalog-retirement-modal-error" role="alert">
              <strong>Есть {preview.appliedPhysicalReturnExchangeCount} ранее применённых складских движений возвратов или обменов.</strong>
              <p>История этих движений сохранится. При последующей отмене возврата или обмена Main отменит связанные денежные и коммерческие последствия, но <strong>не будет повторно менять закрытый складской остаток</strong>. Для этого система проверит завершённое удаление и нулевой архивный остаток. Если записи неполные или остатки расходятся, отмена остановится до сверки.</p>
            </div>}
          <p>Удалённые SKU не возвращаются автоматически в каталог. Повторное использование часов требует отдельной действующей комплектации и учётного прихода.</p>
          {preview.blockers?.length?<div className="catalog-retirement-modal-error" role="alert">
            <strong>Удаление запрещено:</strong> {preview.blockers.join('; ')}
          </div>:<strong>Блокирующих остатков и незавершённых операций не найдено.</strong>}
          {error&&<div role="alert" className="catalog-retirement-modal-error">{error}</div>}
        </div>
        <div className="modal-actions">
          <button type="button" className="danger" disabled={busy||!preview.canDelete}
            onClick={()=>void confirm()}>{busy?'Удаление…':'Подтвердить удаление'}</button>
          <button type="button" className="secondary" disabled={busy}
            onClick={()=>{setPreview(null);setError('')}}>Отмена</button>
        </div>
      </section>
    </div>}
  </>
}

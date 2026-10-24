import type { InventoryRenderContext } from './types'
import { InventoryUnifiedQuantityWorkspace } from './InventoryUnifiedQuantityWorkspace'

type PanelContext = Pick<InventoryRenderContext,
  | 'inventoryPanelStyle' | 'inventoryDraft' | 'inventoryMovementBusy' | 'inventoryMovementError'
  | 'movementSourceLoading' | 'movementSourceLoadError' | 'isAdmin'
  | 'arrivalWorkspace' | 'inventoryArrivalSummary' | 'inventoryOperationAllProductGroups'
  | 'selectInventoryOperationMode' | 'changeInventoryOperationSource'
  | 'swapInventoryTransferDirection' | 'getStockQuantityForVariant'
  | 'setInventoryDraft' | 'setInventoryCorrectionValue'
  | 'setInventoryVariantOperationQuantity' | 'saveInventoryMovement'
  | 'createEmptyInventoryItem' | 'resetInventoryArrivalForm'
  | 'resetInventoryOperationSelection' | 'setMovementSourceRefreshToken'
  | 'suggestionValues'
> & Record<string,unknown> & { stocktakeActiveSources:string[]; openStocktakeForOperation:(source:'warehouse'|'boutique')=>void; refreshActiveStocktakes:()=>Promise<void>; clearInventoryMovementError: () => void; onInlineArrivalVariant: (seed: {
  productId: number | string; productName: string; category: 'adult' | 'child';
  gender: string; material: string; length: string; color: string; size: string; quantity: number;
}) => void; onInlineCorrectionVariant: (seed: {
  productId: number | string; productName: string; category: 'adult'|'child';
  gender:string;material:string;length:string;color:string;size:string;quantity:number;
}) => void }

export function renderInventoryMovementPanel(ctx: PanelContext) {
  const mode = ctx.inventoryDraft.movementType as 'arrival' | 'writeoff' | 'manual_set' | 'transfer'
  const source = ctx.inventoryDraft.source as 'warehouse' | 'boutique'
  const target = ctx.inventoryDraft.targetSource as 'warehouse' | 'boutique'
  return <div className="inventory-movement-panel" style={ctx.inventoryPanelStyle('movement')}>
    <InventoryUnifiedQuantityWorkspace
      key={mode}
      mode={mode}
      source={source}
      targetSource={target}
      targetQuantity={variantId => Number(ctx.getStockQuantityForVariant(target, variantId) || 0)}
      onSwap={() => {
        ctx.clearInventoryMovementError()
        if(ctx.inventoryArrivalSummary.rows > 0 && mode==='arrival')return
        ctx.swapInventoryTransferDirection()
      }}
      groups={ctx.inventoryOperationAllProductGroups}
      draft={ctx.inventoryDraft.items}
      busy={ctx.inventoryMovementBusy}
      loading={ctx.movementSourceLoading}
      error={ctx.movementSourceLoadError || ''}
      saveError={ctx.inventoryMovementError || ''}
      blockedTransferSource={mode==='transfer'
        ? ([source,target].find(key=>ctx.stocktakeActiveSources.includes(key)) as 'warehouse'|'boutique'|undefined) || null
        : null}
      onOpenStocktake={ctx.openStocktakeForOperation}
      reason={ctx.inventoryDraft.comment || ''}
      isAdmin={ctx.isAdmin}
      newVariantWorkspace={ctx.arrivalWorkspace}
      colorSuggestions={ctx.suggestionValues.colors || []}
      sizeSuggestions={ctx.suggestionValues.sizes || []}
      childAgeSuggestions={ctx.suggestionValues.childAges || []}
      onInlineArrivalVariant={ctx.onInlineArrivalVariant}
      onInlineCorrectionVariant={ctx.onInlineCorrectionVariant}
      extraArrival={{ rows: ctx.inventoryArrivalSummary.rows, totalQuantity: ctx.inventoryArrivalSummary.totalQuantity }}
      onMode={next => {
        ctx.clearInventoryMovementError()
        ctx.resetInventoryArrivalForm()
        ctx.selectInventoryOperationMode(next)
      }}
      onSource={next => {
        ctx.clearInventoryMovementError()
        if(mode==='arrival'&&ctx.inventoryArrivalSummary.rows > 0)ctx.resetInventoryArrivalForm()
        ctx.changeInventoryOperationSource(next)
      }}
      onReason={value=>{ctx.clearInventoryMovementError();ctx.setInventoryDraft((current:any)=>({...current,comment:value}))}}
      onQuantity={(row,value)=>{
        ctx.clearInventoryMovementError()
        if(mode==='manual_set' && row.draftKey){
          ctx.setInventoryDraft((current:any) => ({
            ...current,
            items: value===''
              ? current.items.filter((item:any)=>item.draftKey!==row.draftKey)
              : current.items.map((item:any)=>item.draftKey===row.draftKey
                ? {...item,quantity:Math.max(0,Math.trunc(Number(value))),touched:true} : item),
          }))
        } else if(mode==='manual_set')ctx.setInventoryCorrectionValue(row,value)
        else ctx.setInventoryVariantOperationQuantity(row,Number(value||0))
      }}
      onSave={()=>ctx.saveInventoryMovement()}
      onClear={()=>{
        ctx.clearInventoryMovementError()
        ctx.setInventoryDraft((current:any)=>({...current,items:[ctx.createEmptyInventoryItem()],comment:''}))
        ctx.resetInventoryArrivalForm()
        ctx.resetInventoryOperationSelection()
      }}
      onRefresh={()=>{ctx.setMovementSourceRefreshToken((value:number)=>value+1);void ctx.refreshActiveStocktakes()}}
    />
  </div>
}

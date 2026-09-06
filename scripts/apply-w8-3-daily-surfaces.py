from pathlib import Path
import hashlib, json

ROOT = Path.cwd()

def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p, s):
    q=ROOT/p; q.parent.mkdir(parents=True, exist_ok=True); q.write_text(s, encoding='utf-8')
def ck(v,m):
    if not v: raise RuntimeError(m)
def rep(s,a,b,label):
    n=s.count(a); ck(n==1, f'{label}: expected 1 marker, found {n}'); return s.replace(a,b,1)
def blob(s):
    b=s.encode(); return hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()

H='src/features/inventory/views/renderInventoryHistoryPanel.tsx'
A='src/features/inventory/views/renderInventoryAttentionPanel.tsx'
I='scripts/test-step1906b-frontend-modularization.mjs'
P='package.json'
C='docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md'
h,a,index,pkg,ctx=map(read,[H,A,I,P,C])
before={H:h,A:a}
write('scripts/fixtures/renderInventoryHistoryPanel-w8-2-baseline.tsx',h)
write('scripts/fixtures/renderInventoryAttentionPanel-w8-2-baseline.tsx',a)

h=rep(h,"import type { InventoryRenderContext } from './types'\n","import type { InventoryRenderContext } from './types'\nimport '../../../styles/w8-3-daily-surfaces.css'\n",'history css')
h=rep(h,"  } = ctx\n\n  return (","""  } = ctx
  const historyVariantIdentity = historyVariantFilter
    ? [historyVariantFilter.productName, historyVariantFilter.color, historyVariantFilter.size].filter(Boolean).join(' · ')
    : ''

  return (""",'history identity')
h=rep(h,'{historyVariantFilter ? <button className="human-history-filter" type="button" onClick={() => setHistoryVariantFilter(null)}>Одна позиция · Сбросить ×</button> : null}','{historyVariantFilter ? <button className="human-history-filter inventory-history-focus" type="button" onClick={() => setHistoryVariantFilter(null)}><span>Позиция</span><strong>{historyVariantIdentity || \'Выбрана\'}</strong><em>Сбросить ×</em></button> : null}','history focus')
h=rep(h,'<div className="history-card-main"><strong>{historyCheckLabel(row)}</strong><span>{row.expectedQuantity !== undefined ? `По системе ${row.expectedQuantity} → фактически ${row.countedQuantity}` : `${row.itemCount} позиций · расхождений ${row.differenceCount}`}</span></div>','<div className="history-card-main"><strong>{historyCheckLabel(row)}</strong>{row.productName ? <span className="history-check-product">{[row.productName, row.color, row.size, row.material && row.material !== \'СТАНДАРТ\' ? row.material : \'\', row.length && row.length !== \'СТАНДАРТ\' ? row.length : \'\', row.gender].filter(Boolean).join(\' · \')}</span> : null}<span>{row.expectedQuantity !== undefined ? `По системе ${row.expectedQuantity} → фактически ${row.countedQuantity}` : `${row.itemCount} позиций · расхождений ${row.differenceCount}`}</span></div>','check identity')
h=rep(h,"{historyStocktakeDetail?.id === row.referenceId ? 'Детали открыты' : 'Расхождения'}","{historyStocktakeDetail?.id === row.referenceId ? 'Скрыть детали' : 'Расхождения'}",'detail wording')

a=rep(a,"import type { InventoryRenderContext } from './types'\n","import type { InventoryRenderContext } from './types'\nimport '../../../styles/w8-3-daily-surfaces.css'\n",'attention css')
a=rep(a,'            {(items.found || []).map((item: any) => (','''            {items.found?.length ? <section className="inventory-attention-subgroup">
              <div className="inventory-attention-subgroup-head"><div><strong>Найдено при проверке</strong><span>Физический факт уже сохранён. Осталось связать вещь с точным вариантом товара.</span></div><b>{items.found.length}</b></div>
              <div className="inventory-attention-sublist">
            {(items.found || []).map((item: any) => (''','found open')
a=rep(a,'            ))}\n            {(items.lifecycle || []).map((item: any) => (','''            ))}
              </div>
            </section> : null}
            {items.lifecycle.length ? <section className="inventory-attention-subgroup">
              <div className="inventory-attention-subgroup-head"><div><strong>Приёмка требует определения</strong><span>Есть физически значимое событие, но точный вариант товара пока неизвестен.</span></div><b>{items.lifecycle.length}</b></div>
              <div className="inventory-attention-sublist">
            {(items.lifecycle || []).map((item: any) => (''','lifecycle boundary')
a=rep(a,'            ))}\n            {(items.catalog || []).map((item: any) => (','''            ))}
              </div>
            </section> : null}
            {items.catalog.length ? <section className="inventory-attention-subgroup">
              <div className="inventory-attention-subgroup-head"><div><strong>Позиция заказа не определена</strong><span>Нужно уточнить характеристики позиции заказа, не меняя уже известный физический остаток.</span></div><b>{items.catalog.length}</b></div>
              <div className="inventory-attention-sublist">
            {(items.catalog || []).map((item: any) => (''','catalog boundary')
a=rep(a,'            ))}\n          </div> : <div className="empty-state">Неопределённых товаров сейчас нет.</div>}','''            ))}
              </div>
            </section> : null}
          </div> : <div className="empty-state">Неопределённых товаров сейчас нет.</div>}''','catalog close')
write(H,h); write(A,a)

write('src/styles/w8-3-daily-surfaces.css', '''/* W8.3 — History + recovery inbox clarity only. */
.inventory-history-focus{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;max-width:min(620px,100%);text-align:left}
.inventory-history-focus span,.inventory-history-focus em{font-size:.7rem;font-style:normal;opacity:.72}
.inventory-history-focus strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-check-product{font-weight:700;color:var(--text,inherit)}
.inventory-attention-group.is-identify>.inventory-attention-list{display:grid;gap:14px}
.inventory-attention-subgroup{border:1px solid rgba(80,96,120,.16);border-radius:14px;background:rgba(248,250,252,.72);padding:12px}
.inventory-attention-subgroup-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
.inventory-attention-subgroup-head>div{display:grid;gap:3px}.inventory-attention-subgroup-head span{font-size:.78rem;opacity:.72;line-height:1.35}
.inventory-attention-subgroup-head>b{min-width:30px;min-height:30px;display:grid;place-items:center;border-radius:999px;background:rgba(90,110,140,.1)}
.inventory-attention-sublist{display:grid;gap:8px}.inventory-attention-sublist>article{margin:0}
@media(max-width:760px){.inventory-history-focus{width:100%;grid-template-columns:auto minmax(0,1fr)}.inventory-history-focus em{grid-column:1/-1}.inventory-attention-subgroup{padding:10px}}
''')

manifest={'version':1,'revision':'w8-3-daily-surfaces-polish','files':{H:{'beforeGitBlob':blob(before[H]),'afterGitBlob':blob(h)},A:{'beforeGitBlob':blob(before[A]),'afterGitBlob':blob(a)}}}
write('scripts/w8-3-daily-surfaces-frontend-manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

write('scripts/test-step1906b-frontend-modularization-w8-3-layer.mjs',r'''import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process'
const root=process.cwd(); const files=['src/features/inventory/views/renderInventoryHistoryPanel.tsx','src/features/inventory/views/renderInventoryAttentionPanel.tsx'];
const baselines={'src/features/inventory/views/renderInventoryHistoryPanel.tsx':'scripts/fixtures/renderInventoryHistoryPanel-w8-2-baseline.tsx','src/features/inventory/views/renderInventoryAttentionPanel.tsx':'scripts/fixtures/renderInventoryAttentionPanel-w8-2-baseline.tsx'};
const prior=path.join(root,'scripts/test-step1906b-frontend-modularization-w8-2-layer.mjs'); const manifest=JSON.parse(fs.readFileSync(path.join(root,'scripts/w8-3-daily-surfaces-frontend-manifest.json'),'utf8'));
const sha=(t)=>{const b=Buffer.from(t);return crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex')}; const ck=(v,m)=>{if(!v)throw new Error(m)};
try{ck(manifest?.revision==='w8-3-daily-surfaces-polish','W8.3 manifest invalid');ck(JSON.stringify(Object.keys(manifest.files||{}))===JSON.stringify(files),'W8.3 allow-list widened');const current=new Map();for(const f of files){const c=fs.readFileSync(path.join(root,f),'utf8'),b=fs.readFileSync(path.join(root,baselines[f]),'utf8');current.set(f,c);ck(sha(b)===manifest.files[f].beforeGitBlob,`W8.3 baseline mismatch: ${f}`);ck(sha(c)===manifest.files[f].afterGitBlob,`W8.3 current mismatch: ${f}`);fs.writeFileSync(path.join(root,f),b)}let r;try{r=spawnSync(process.execPath,[prior],{cwd:root,stdio:'inherit',shell:false,windowsHide:true})}finally{for(const f of files)fs.writeFileSync(path.join(root,f),current.get(f))}ck(r?.status===0,'W8.2 preservation layer failed under W8.3 baseline');ck(current.get(files[0]).includes('inventory-history-focus'),'W8.3 History marker missing');ck(current.get(files[1]).includes('inventory-attention-subgroup'),'W8.3 Attention marker missing');console.log('W8.3 FRONTEND STRUCTURAL LAYER PASSED — W8.2 baseline preserved; exact History + Attention presentation delta accepted')}catch(e){console.error(`W8.3 FRONTEND STRUCTURAL LAYER FAILED: ${e?.message||e}`);process.exit(1)}
''')
write('scripts/test-w8-3-daily-surfaces-polish.mjs',r'''import fs from 'node:fs';import path from 'node:path';const root=process.cwd(),read=(p)=>fs.readFileSync(path.join(root,p),'utf8'),ck=(v,m)=>{if(!v)throw new Error(m)};try{const h=read('src/features/inventory/views/renderInventoryHistoryPanel.tsx'),a=read('src/features/inventory/views/renderInventoryAttentionPanel.tsx'),m=read('src/features/inventory/views/renderInventoryMovementPanel.tsx'),s=read('src/features/inventory/views/renderInventoryStocktakePanel.tsx'),css=read('src/styles/w8-3-daily-surfaces.css'),inv=read('src/features/sections/InventorySection.tsx');ck(h.includes('historyVariantIdentity')&&h.includes('history-check-product'),'History context missing');ck(a.includes('Найдено при проверке')&&a.includes('Приёмка требует определения')&&a.includes('Позиция заказа не определена'),'Attention types still mixed');ck(m.includes('data-step182-operations="human-workflow"')&&m.includes('Переместить товар'),'Operations changed unexpectedly');ck(s.includes('stocktake-counting-rule')&&s.includes('stocktake-outcome-card'),'Stocktake changed unexpectedly');ck(css.includes('@media(max-width:760px)'),'Mobile CSS missing');ck(inv.includes('<div className="inventory-arrival-legacy-workspace">'),'Arrival disappeared');ck(!/warehouse_tasks|warehouse_cases|case_owner|\bSLA\b/i.test(h+a+css),'Task system leaked into W8.3');console.log('W8.3 DAILY SURFACES POLISH PASSED — History is self-identifying; recovery identity questions are visually separated; Operations, Stocktake and Arrival remain unchanged')}catch(e){console.error(`W8.3 DAILY SURFACES POLISH FAILED: ${e?.message||e}`);process.exit(1)}
''')

index=rep(index,"// w8StockWorkspaceFinishPath — W8.2 stock workspace finish preservation layer\nawait import('./test-step1906b-frontend-modularization-w8-2-layer.mjs')","// w8StockWorkspaceFinishPath — W8.2 stock workspace finish preservation layer\n// w8DailySurfacesPolishPath — W8.3 remaining daily Warehouse surfaces preservation layer\nawait import('./test-step1906b-frontend-modularization-w8-3-layer.mjs')",'chain');write(I,index)
pkg=rep(pkg,'node scripts/test-w8-2-stock-workspace-finish.mjs",','node scripts/test-w8-2-stock-workspace-finish.mjs && node scripts/test-w8-3-daily-surfaces-polish.mjs",','package');write(P,pkg)
checkpoint='''## Checkpoint 2026-09-06 — W8.3 remaining daily Warehouse surfaces polish\n\nW8.3 is a narrow interface pass after W8.2, not the W9 full Warehouse audit. `История` keeps the selected exact SKU visible and exact physical-check rows now name the product/variant. `Нужно уточнить -> Товар` keeps the same derived data/actions but separates found-on-shelf, lifecycle intake identity and order-position identity into distinct visual groups. `Операции` and `Проверка` were reviewed and left unchanged because their accepted W4/W5 workflows already have clear primary actions and safety wording; Arrival remains frozen.\n\nNo Worker/API/D1/migration/business-truth change is part of W8.3. Next W8 pass is final cross-screen visual/mobile acceptance and only concrete defects found there. W9 remains reserved for the full Warehouse audit/discussion.\n\n---\n\n'''
ctx=rep(ctx,'## Checkpoint 2026-09-06 — W8.2 `Остатки` workspace finish\n',checkpoint+'## Checkpoint 2026-09-06 — W8.2 `Остатки` workspace finish\n','context');write(C,ctx)
write('docs/continuation/W8_3_DAILY_SURFACES_POLISH_20260906.md','''# W8.3 — remaining daily Warehouse surfaces polish\n\nBaseline: main `90d667d2c2d4e11bded93544e47cc540116c04c1` (W8.2). Branch: `w8-3-daily-surfaces-polish`.\n\nThis pass changes presentation only. History keeps exact-SKU context visible and identifies exact check rows. The recovery inbox keeps its existing derived data/actions but splits three identity-question origins visually. Operations and Stocktake were reviewed and intentionally left unchanged. Arrival is frozen.\n\nNo Worker/API/D1/migration, stock arithmetic, reservation, lifecycle or transfer runtime change. The Step1906B chain is extended with an exact W8.3 History+Attention manifest.\n\nNext: final W8 cross-screen visual/mobile acceptance, then W9 full Warehouse audit/discussion.\n''')
print('W8.3 apply complete')

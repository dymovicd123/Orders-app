from pathlib import Path
import json
import subprocess


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, got {count}')
    return text.replace(old, new, 1)

modal_path = Path('src/features/orders/OrderCatalogResolutionModal.tsx')
modal = modal_path.read_text(encoding='utf-8')

old_compound = '''function compoundRemainder(rawName: string, productName: string) {
  const cleanRaw = clean(rawName).replace(/[«»“”„"']/g, '').trim()
  const productKey = identityText(productName)
  if (!cleanRaw || !productKey) return ''
  const parts = cleanRaw.split(/\\s*[‐‑‒–—-]+\\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length > 1) {
    const rest = parts.filter((part) => identityText(part) !== productKey)
    if (rest.length !== parts.length) return rest.join(' · ')
  }
  return ''
}
'''
new_compound = '''function compoundRemainder(rawName: string, productName: string) {
  const rawKey = identityText(rawName)
  const productKey = identityText(productName)
  if (!rawKey || !productKey) return ''
  const rawTokens = rawKey.split(' ').filter(Boolean)
  const productTokens = productKey.split(' ').filter(Boolean)
  if (!productTokens.length || productTokens.length > rawTokens.length) return ''
  for (let start = 0; start <= rawTokens.length - productTokens.length; start += 1) {
    const matches = productTokens.every((token, offset) => rawTokens[start + offset] === token)
    if (!matches) continue
    return [...rawTokens.slice(0, start), ...rawTokens.slice(start + productTokens.length)].join(' ').trim()
  }
  return ''
}
'''
modal = replace_once(modal, old_compound, new_compound, 'generic compound remainder')

facts_anchor = "  const factsBlocked = productMissing || newProductIncomplete || genderMissing || explicitColorMissing || explicitSizeMissing || unconfirmedNewFields.length > 0\n"
facts_add = facts_anchor + '''  const pendingLabels = [
    productMissing ? 'выбрать товар' : '',
    newProductIncomplete ? 'заполнить новый товар' : '',
    genderMissing ? 'выбрать пол' : '',
    explicitColorMissing ? 'подтвердить цвет' : '',
    explicitSizeMissing ? 'подтвердить размер' : '',
    ...unconfirmedNewFields.map((field) => `подтвердить новое значение «${draft?.[field] || ''}»`),
  ].filter(Boolean)
  const saveButtonText = resolving
    ? 'Сохраняю…'
    : factsBlocked
      ? `Осталось: ${pendingLabels[0] || 'уточнить данные'}`
      : exactDraftVariant
        ? 'Подтвердить этот вариант'
        : context?.isWorkshop
          ? 'Подтвердить товар'
          : 'Сохранить характеристики'
  const compoundMaterialSelected = Boolean(compoundHint && normalize(draft?.material) === normalize(compoundHint))
  const compoundColorSelected = Boolean(compoundHint && normalize(draft?.color) === normalize(compoundHint))
'''
modal = replace_once(modal, facts_anchor, facts_add, 'pending resolver summary')

old_render_class = "      <label className={`order-catalog-resolution-field${needsCreation ? ' needs-create' : ''}`}>\n"
new_render_class = "      <label className={`order-catalog-resolution-field${needsCreation && !createFields[field] ? ' needs-create' : ''}${needsCreation && createFields[field] ? ' is-confirmed' : ''}`}>\n"
modal = replace_once(modal, old_render_class, new_render_class, 'confirmed field visual state')

old_create_copy = "            {createFields[field] ? `✓ Добавить «${value}» в справочник` : `Новое значение — добавить «${value}» в справочник`}\n"
new_create_copy = "            {createFields[field] ? `✓ «${value}» будет добавлено` : `Подтвердить новое значение «${value}»`}\n"
modal = replace_once(modal, old_create_copy, new_create_copy, 'human new value confirmation')

old_compound_ui = '''                  {compoundHint ? (
                    <div className="order-catalog-resolution-compound-hint">
                      <strong>В названии есть «{compoundHint}»</strong>
                      <span>Если это характеристика, можно сразу подставить:</span>
                      <div><button type="button" onClick={() => changeField('material', compoundHint)}>Материал</button><button type="button" onClick={() => changeField('color', compoundHint)}>Цвет</button></div>
                    </div>
                  ) : null}
'''
new_compound_ui = '''                  {compoundHint ? (
                    <div className={`order-catalog-resolution-compound-hint${compoundMaterialSelected || compoundColorSelected ? ' is-applied' : ''}`}>
                      <strong>Из названия отдельно найдено: «{compoundHint}»</strong>
                      {compoundMaterialSelected ? <span className="order-catalog-resolution-applied">✓ Выбрано как материал</span> : compoundColorSelected ? <span className="order-catalog-resolution-applied">✓ Выбрано как цвет</span> : <span>Что это за часть названия?</span>}
                      <div>
                        <button type="button" className={compoundMaterialSelected ? 'is-active' : ''} onClick={() => changeField('material', compoundHint)}>{compoundMaterialSelected ? '✓ Материал' : 'Материал'}</button>
                        <button type="button" className={compoundColorSelected ? 'is-active' : ''} onClick={() => changeField('color', compoundHint)}>{compoundColorSelected ? '✓ Цвет' : 'Цвет'}</button>
                      </div>
                    </div>
                  ) : null}
'''
modal = replace_once(modal, old_compound_ui, new_compound_ui, 'compound immediate feedback')

facts_title = '''                  <section className="order-catalog-resolution-facts">
                    <div className="order-catalog-resolution-compact-title"><strong>Характеристики</strong><span>Изменяйте только то, что нужно</span></div>
                    {context?.isWorkshop ? <div className="order-catalog-resolution-workshop-note">Для позиции Цеха достаточно выбрать базовый товар.</div> : (
'''
preview = '''                  <section className="order-catalog-resolution-facts">
                    <div className="order-catalog-resolution-compact-title"><strong>Характеристики</strong><span>Изменяйте только то, что нужно</span></div>
                    <div className="order-catalog-resolution-save-preview">
                      <div className="order-catalog-resolution-save-preview-head">
                        <span>Будет сохранено</span>
                        <strong>{draft.createProduct ? draft.productName : selectedProduct?.name || activeItem.productName}</strong>
                      </div>
                      <div className="order-catalog-resolution-save-preview-facts">
                        <span>{draft.category === 'child' ? 'Детский' : 'Взрослый'}</span>
                        <span className={genderMissing ? 'is-pending' : ''}>{clean(draft.gender) || 'Пол не выбран'}</span>
                        <span>{clean(draft.material) || 'СТАНДАРТ'}</span>
                        {normalize(draft.length) !== 'СТАНДАРТ' ? <span>{draft.length}</span> : null}
                        <span className={explicitColorMissing ? 'is-pending' : ''}>{clean(draft.color) || 'Цвет не подтверждён'}</span>
                        <span className={explicitSizeMissing ? 'is-pending' : ''}>{clean(draft.size) || 'Размер не подтверждён'}</span>
                      </div>
                      {pendingLabels.length ? (
                        <div className="order-catalog-resolution-pending"><strong>Осталось уточнить:</strong> {pendingLabels.join(' · ')}</div>
                      ) : <div className="order-catalog-resolution-ready">✓ Всё обязательное заполнено</div>}
                    </div>
                    {context?.isWorkshop ? <div className="order-catalog-resolution-workshop-note">Для позиции Цеха достаточно выбрать базовый товар.</div> : (
'''
modal = replace_once(modal, facts_title, preview, 'save preview')

old_gender = '''                          <label className={`order-catalog-resolution-field${genderMissing ? ' needs-create' : ''}`}><span>Пол</span><select value={draft.gender} onChange={(event) => changeField('gender', event.target.value)}><option value="">Не указан</option><option value="ЖЕН">ЖЕН</option><option value="МУЖ">МУЖ</option></select></label>
'''
new_gender = '''                          <label className={`order-catalog-resolution-field${genderMissing ? ' needs-create' : ''}${!genderMissing && clean(draft.gender) ? ' is-confirmed' : ''}`}><span>Пол {genderMissing ? '· нужно выбрать' : '· ✓'}</span><select value={draft.gender} onChange={(event) => changeField('gender', event.target.value)}><option value="">Не указан</option><option value="ЖЕН">Женский</option><option value="МУЖ">Мужской</option></select>{genderMissing ? <small className="order-catalog-resolution-required-note">Это обязательное поле для складской комбинации.</small> : null}</label>
'''
modal = replace_once(modal, old_gender, new_gender, 'gender explicit guidance')

old_actions = '''                    <div className="order-catalog-resolution-actions">
                      <button type="button" className="primary-button" disabled={factsBlocked || resolving} onClick={() => void resolveFacts()}>{resolving ? 'Сохраняю…' : exactDraftVariant ? 'Подтвердить этот вариант' : context?.isWorkshop ? 'Подтвердить товар' : 'Сохранить характеристики'}</button>
                    </div>
'''
modal = replace_once(modal, old_actions, '', 'remove buried facts action')

sticky_anchor = '''            </details>
            <div className="order-catalog-resolution-guard">Без уточнения отправить заказ нельзя.</div>
'''
sticky = '''            </details>
            {isAdmin && advancedOpen ? (
              <div className={`order-catalog-resolution-sticky-action${factsBlocked ? ' is-blocked' : ' is-ready'}`}>
                <div className="order-catalog-resolution-sticky-copy">
                  <strong>{factsBlocked ? `Осталось уточнить: ${pendingLabels.join(' · ')}` : 'Всё готово к сохранению'}</strong>
                  {genderMissing ? (
                    <div className="order-catalog-resolution-inline-choice"><span>Пол:</span><button type="button" onClick={() => changeField('gender', 'ЖЕН')}>Женский</button><button type="button" onClick={() => changeField('gender', 'МУЖ')}>Мужской</button></div>
                  ) : null}
                  {explicitColorMissing ? <button type="button" className="order-catalog-resolution-quick-choice" onClick={() => changeField('color', 'БЕЗ ЦВЕТА')}>Подтвердить: без цвета</button> : null}
                  {explicitSizeMissing ? <button type="button" className="order-catalog-resolution-quick-choice" onClick={() => changeField('size', 'БЕЗ РАЗМЕРА')}>Подтвердить: без размера</button> : null}
                  {unconfirmedNewFields.map((field) => <button key={`confirm-${field}`} type="button" className="order-catalog-resolution-quick-choice" onClick={() => setCreateFields((current) => ({ ...current, [field]: true }))}>Добавить «{draft[field]}» в справочник</button>)}
                </div>
                <button type="button" className="primary-button" disabled={factsBlocked || resolving} onClick={() => void resolveFacts()}>{saveButtonText}</button>
              </div>
            ) : null}
            <div className="order-catalog-resolution-guard">Без уточнения отправить заказ нельзя.</div>
'''
modal = replace_once(modal, sticky_anchor, sticky, 'sticky action bar')

modal_path.write_text(modal, encoding='utf-8')

css_path = Path('src/features/orders/OrderCatalogResolutionModal.css')
css = css_path.read_text(encoding='utf-8')
css = replace_once(css,
'''.order-catalog-resolution-field.needs-create {
  border-color: #efc86f;
  background: #fffaf0;
}
''',
'''.order-catalog-resolution-field.needs-create {
  border-color: #efb64d;
  background: #fff8e8;
  box-shadow: 0 0 0 1px rgba(239, 182, 77, .12);
}

.order-catalog-resolution-field.is-confirmed {
  border-color: #b7dfc2;
  background: #f5fbf6;
}
''', 'field confirmation colors')

css += '''

.order-catalog-resolution-save-preview {
  display: grid;
  gap: 9px;
  margin-bottom: 10px;
  padding: 11px 12px;
  border: 1px solid #d8e1ef;
  border-radius: 10px;
  background: #fff;
}

.order-catalog-resolution-save-preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.order-catalog-resolution-save-preview-head span {
  color: #667085;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.order-catalog-resolution-save-preview-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.order-catalog-resolution-save-preview-facts span {
  padding: 5px 8px;
  border-radius: 999px;
  background: #eef7f0;
  color: #245c32;
  font-size: 12px;
}

.order-catalog-resolution-save-preview-facts .is-pending {
  background: #fff0d8;
  color: #8a5100;
  font-weight: 700;
}

.order-catalog-resolution-pending {
  padding: 8px 9px;
  border-radius: 8px;
  background: #fff7e8;
  color: #7a4d00;
  font-size: 12px;
}

.order-catalog-resolution-ready {
  color: #18743a;
  font-size: 12px;
  font-weight: 700;
}

.order-catalog-resolution-required-note {
  color: #9a5d00 !important;
  font-weight: 600;
}

.order-catalog-resolution-compound-hint.is-applied {
  border-color: #b8dfc5;
  background: #f2fbf4;
}

.order-catalog-resolution-applied {
  color: #18743a;
  font-weight: 700;
}

.order-catalog-resolution-compound-hint button.is-active {
  border-color: #86c89a;
  background: #eaf8ee;
  color: #176b34;
  font-weight: 700;
}

.order-catalog-resolution-sticky-action {
  position: sticky;
  bottom: -1px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px -8px 0;
  padding: 11px 12px;
  border: 1px solid #dce3ee;
  border-radius: 12px;
  background: rgba(255, 255, 255, .97);
  box-shadow: 0 -8px 24px rgba(15, 23, 42, .10);
  backdrop-filter: blur(8px);
}

.order-catalog-resolution-sticky-action.is-blocked {
  border-color: #eed39b;
  background: rgba(255, 250, 239, .98);
}

.order-catalog-resolution-sticky-action.is-ready {
  border-color: #b8dfc5;
  background: rgba(244, 252, 246, .98);
}

.order-catalog-resolution-sticky-copy {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
}

.order-catalog-resolution-sticky-copy > strong {
  width: 100%;
  color: #344054;
}

.order-catalog-resolution-inline-choice,
.order-catalog-resolution-inline-choice {
  display: flex;
  align-items: center;
  gap: 5px;
}

.order-catalog-resolution-inline-choice button,
.order-catalog-resolution-quick-choice {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #fff;
  padding: 5px 8px;
  color: #344054;
  font: inherit;
  cursor: pointer;
}

@media (max-width: 640px) {
  .order-catalog-resolution-sticky-action,
  .order-catalog-resolution-save-preview-head {
    align-items: stretch;
    flex-direction: column;
  }

  .order-catalog-resolution-sticky-action > .primary-button {
    width: 100%;
  }
}
'''
css_path.write_text(css, encoding='utf-8')

test_path = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
test = test_path.read_text(encoding='utf-8')
test = replace_once(test,
"  check(modal.includes('В названии есть'), 'R3 must surface compound-name residue without technical wording')\n",
"  check(modal.includes('Из названия отдельно найдено'), 'R4 must surface compound-name residue with immediate human feedback')\n  check(modal.includes(\"const rawTokens = rawKey.split(' ')\") && modal.includes('productTokens.every'), 'R4 compound-name extraction must work for any embedded known base-product name, not only dash-separated input')\n  check(modal.includes('Будет сохранено') && modal.includes('Осталось уточнить:'), 'R4 must always show the current result and remaining required decisions')\n  check(modal.includes('order-catalog-resolution-sticky-action'), 'R4 must keep the primary action and blockers visible while the operator scrolls')\n  check(modal.includes('✓ Выбрано как материал'), 'R4 compound hypotheses must show immediate visible confirmation after selection')\n",
'R4 UX regression assertions')
test = test.replace('CONTEXTUAL CATALOG RESOLUTION R3 PASSED', 'CONTEXTUAL CATALOG RESOLUTION R4 PASSED')
test = test.replace('CONTEXTUAL CATALOG RESOLUTION R3 FAILED', 'CONTEXTUAL CATALOG RESOLUTION R4 FAILED')
test_path.write_text(test, encoding='utf-8')

manifest_path = Path('scripts/contextual-catalog-resolution-r1-frontend-manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for path in ['src/features/orders/OrderCatalogResolutionModal.tsx', 'src/features/orders/OrderCatalogResolutionModal.css']:
    text = Path(path).read_text(encoding='utf-8')
    manifest['files'][path]['afterGitBlob'] = subprocess.check_output(['git', 'hash-object', path], text=True).strip()
    manifest['files'][path]['afterLines'] = len(text.replace('\r\n', '\n').split('\n'))
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('catalog resolver UX R4 applied')

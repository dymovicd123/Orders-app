import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

type Option = { value: string; fromModel: boolean }

type Props = {
  label: string
  value: string
  modelOptions: string[]
  referenceOptions: string[]
  referenceStatus: 'loading' | 'ready' | 'error'
  onChange: (value: string) => void
}

const normalized = (value: string) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase()
const identity = (value: string) => normalized(value).replace(/[‐‑‒–—-]+/g,' ').replace(/\s+/g,' ')

export function KpiCharacteristicPicker({
  label, value, modelOptions, referenceOptions, referenceStatus, onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) setQuery(value)
  }, [value, open])

  const options = useMemo(() => {
    const prefix = normalized(query)
    const used = new Set<string>()
    const model: Option[] = []
    const elsewhere: Option[] = []

    for (const item of modelOptions) {
      const candidate = normalized(item)
      if (!candidate || used.has(candidate)) continue
      used.add(candidate)
      if (!prefix || identity(candidate).includes(identity(prefix))) model.push({ value: candidate, fromModel: true })
    }
    for (const item of referenceOptions) {
      const candidate = normalized(item)
      if (!candidate || used.has(candidate)) continue
      used.add(candidate)
      // Do not flood the user with every dictionary value until they search.
      if (prefix && identity(candidate).includes(identity(prefix))) elsewhere.push({ value: candidate, fromModel: false })
    }
    model.sort((a,b) => a.value.localeCompare(b.value,'ru',{numeric:true}))
    elsewhere.sort((a,b) => a.value.localeCompare(b.value,'ru',{numeric:true}))
    return [...model.slice(0, prefix ? 7 : 6), ...elsewhere.slice(0, prefix ? 5 : 0)]
      .slice(0, 9)
  }, [query, modelOptions, referenceOptions])

  const queryValue = normalized(query)
  const allKnown = useMemo(() =>
    new Set([...modelOptions, ...referenceOptions].map(identity).filter(Boolean)),
  [modelOptions, referenceOptions])
  const canUseCustom = queryValue.length > 0 && !allKnown.has(identity(queryValue)) && referenceStatus === 'ready'
  const showCustom = open && canUseCustom
  const showResults = open

  const commit = (next: string) => {
    onChange(next)
    setQuery(next)
    setOpen(false)
    setSelectedIndex(0)
  }
  const activeIndex = Math.max(0,Math.min(selectedIndex, options.length + (showCustom ? 1 : 0) - 1))

  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setQuery(value)
      input.current?.blur()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setSelectedIndex(i=>Math.min(i+1,Math.max(0, options.length + (showCustom ? 1 : 0) - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setSelectedIndex(i=>Math.max(0,i-1))
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (options.length && activeIndex < options.length) commit(options[Math.max(0,activeIndex)].value)
      else if (showCustom) commit(queryValue)
      else if (queryValue && allKnown.has(identity(queryValue))) commit(queryValue)
    }
  }

  return <div className={'pkpi-choice-field'+(open?' is-open':'')} onBlur={event=>{
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
      setQuery(value)
    }
  }}>
    <label>{label}
      <div className="pkpi-choice-input-wrap">
        <input ref={input} value={open?query:value} placeholder="Любой"
          autoComplete="off" role="combobox" aria-autocomplete="list"
          aria-expanded={showResults} aria-controls={'pkpi-option-'+label}
          onFocus={()=>{setOpen(true);setSelectedIndex(0)}}
          onChange={event=>{setQuery(event.target.value);setSelectedIndex(0);setOpen(true)}}
          onKeyDown={keyboard}/>
        {value ? <button type="button" className="pkpi-choice-clear" aria-label={'Сбросить '+label}
          onClick={()=>{commit(''); input.current?.focus()}}>×</button> : <span className="pkpi-choice-caret" aria-hidden="true">⌄</span>}
      </div>
    </label>
    {showResults ? <div className="pkpi-choice-menu" id={'pkpi-option-'+label} role="listbox">
      <button type="button" className="pkpi-choice-all" onClick={()=>commit('')}>Любой / не уточнять</button>
      {options.length ? <>
        {options.some(o=>o.fromModel) ? <div className="pkpi-choice-group">У этой модели</div> : null}
        {options.map((o,i)=><div key={o.value}>
          {i>0 && !o.fromModel && options[i-1].fromModel ? <div className="pkpi-choice-group">Из справочника</div> : null}
          {i===0 && !o.fromModel ? <div className="pkpi-choice-group">Из справочника</div> : null}
          <button type="button" role="option" aria-selected={i===activeIndex}
            className={i===activeIndex?'is-active':''} onClick={()=>commit(o.value)}>
            <span>{o.value}</span>{o.fromModel?<small>Есть в модели</small>:null}
          </button>
        </div>)}
      </> : !queryValue ? <div className="pkpi-choice-empty">Начните вводить значение</div> : null}
      {showCustom ? <button type="button" className="pkpi-choice-custom" onClick={()=>commit(queryValue)}>
        Использовать «{queryValue}» <small>Нет в справочнике — проверьте написание</small>
      </button> : null}
      {referenceStatus==='loading' && queryValue ? <div className="pkpi-choice-hint">Ищем в справочниках…</div> : null}
      {referenceStatus==='error' && queryValue ? <div className="pkpi-choice-hint">Справочник не загружен. Можно выбрать значение модели; остальные значения появятся после обновления.</div> : null}
    </div> : null}
  </div>
}

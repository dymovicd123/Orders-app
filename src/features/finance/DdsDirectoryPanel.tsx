import { useState, type FormEvent } from 'react'
import type { DdsDirectoryCategory } from './ddsTypes'

type Props={
  categories:DdsDirectoryCategory[]
  busy:boolean
  onAddCategory:(name:string)=>Promise<boolean>
  onAddArticle:(categoryId:number,name:string)=>Promise<boolean>
  onSetCategoryActive:(categoryId:number,active:boolean)=>Promise<boolean>
  onSetArticleActive:(articleId:number,active:boolean)=>Promise<boolean>
}

export function DdsDirectoryPanel({categories,busy,onAddCategory,onAddArticle,
  onSetCategoryActive,onSetArticleActive}:Props){
  const [categoryName,setCategoryName]=useState('')
  const [newArticles,setNewArticles]=useState<Record<number,string>>({})
  const [showArchived,setShowArchived]=useState(false)
  const visible=categories.filter(category=>showArchived||category.active)
  const activeCount=categories.filter(category=>category.active).length
  const archivedCount=categories.length-activeCount+
    categories.reduce((total,category)=>total+category.articles.filter(article=>!article.active).length,0)

  async function saveCategory(event:FormEvent){
    event.preventDefault()
    const name=categoryName.trim()
    if(name && await onAddCategory(name))setCategoryName('')
  }
  async function saveArticle(event:FormEvent,categoryId:number){
    event.preventDefault()
    const name=(newArticles[categoryId]||'').trim()
    if(name && await onAddArticle(categoryId,name))
      setNewArticles(current=>({...current,[categoryId]:''}))
  }
  return <section className="dds-directory">
    <div className="dds-directory-intro">
      <div><h3>Категории и статьи</h3>
        <p>Добавляйте статьи в нужную категорию — они сразу появятся в форме расхода.</p></div>
      <span className="dds-counter">{activeCount} категорий</span>
    </div>
    <form className="dds-directory-create" onSubmit={saveCategory}>
      <label htmlFor="dds-new-category">Новая категория</label>
      <div><input id="dds-new-category" value={categoryName} maxLength={80} required
        placeholder="Например, Командировки" onChange={event=>setCategoryName(event.target.value)}/>
        <button type="submit" className="primary" disabled={busy||!categoryName.trim()}>Добавить категорию</button>
      </div>
    </form>
    <div className="dds-directory-tools">
      <span>Откройте категорию, чтобы добавить или скрыть статью.</span>
      {archivedCount>0&&<label className="dds-directory-show-archived">
        <input type="checkbox" checked={showArchived} onChange={event=>setShowArchived(event.target.checked)}/>
        Показать скрытые
      </label>}
    </div>
    <div className="dds-directory-groups">
      {visible.map(category=>{
        const activeArticles=category.articles.filter(article=>article.active).length
        return <details className={'dds-directory-group'+(!category.active?' is-archived':'')} key={category.id}>
          <summary>
            <span className="dds-directory-name"><strong>{category.name}</strong>
              <small>{activeArticles} {activeArticles===1?'статья':activeArticles>=2&&activeArticles<=4?'статьи':'статей'}{category.active?'':' · скрыта'}</small>
            </span>
            <span className="dds-directory-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="dds-directory-inner">
            <div className="dds-directory-group-actions">
              <button className="dds-text-button" type="button" disabled={busy}
                onClick={()=>void onSetCategoryActive(category.id,!category.active)}>
                {category.active?'Скрыть категорию':'Вернуть категорию'}
              </button>
            </div>
            {category.articles.length===0&&<p className="dds-muted">Статей пока нет. Добавьте первую ниже.</p>}
            {category.articles.filter(article=>showArchived||article.active).map(article=><div
              className={'dds-directory-article'+(!article.active?' is-archived':'')} key={article.id}>
              <span>{article.name}{!article.active&&<small> · скрыта</small>}</span>
              <button type="button" className="dds-text-button" disabled={busy||(!category.active&&!article.active)}
                onClick={()=>void onSetArticleActive(article.id,!article.active)}>
                {article.active?'Скрыть':'Вернуть'}
              </button>
            </div>)}
            {category.active&&<form className="dds-directory-add-article" onSubmit={event=>void saveArticle(event,category.id)}>
              <input aria-label={'Новая статья в категории '+category.name}
                value={newArticles[category.id]||''} maxLength={100}
                placeholder="Название новой статьи" required
                onChange={event=>setNewArticles(current=>({...current,[category.id]:event.target.value}))}/>
              <button type="submit" className="secondary" disabled={busy||!(newArticles[category.id]||'').trim()}>
                + Добавить статью
              </button>
            </form>}
          </div>
        </details>
      })}
    </div>
    <p className="dds-directory-hint">Скрытие не удаляет расходы из истории и отчётов. Категорию или статью можно вернуть в любой момент.</p>
  </section>
}

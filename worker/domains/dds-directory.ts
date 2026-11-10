import type { AuthUser } from '../core/types.ts'

export type DdsDirectoryArticle={id:number;name:string;active:boolean}
export type DdsDirectoryCategory={id:number;name:string;active:boolean;articles:DdsDirectoryArticle[]}

type Row={id:number;name:string;is_active:number;category_id?:number}
function invalid(message:string,status=400){
  const error=new Error(message) as Error & {status:number}
  error.status=status
  return error
}
function requireAccess(actor:AuthUser|null,admin=false){
  if(!actor||(actor.role!=='admin'&&actor.role!=='manager'))
    throw invalid('Нет доступа к справочнику ДДС.',403)
  if(admin&&actor.role!=='admin')throw invalid('Изменять статьи и категории может только администратор.',403)
}
function nameField(value:unknown,max:number,label:string){
  const name=typeof value==='string'?value.trim().replace(/\s+/g,' '):''
  if(!name||name.length>max)throw invalid(label+' должен содержать от 1 до '+max+' символов.')
  return name
}
function positiveId(id:number){
  if(!Number.isSafeInteger(id)||id<1)throw invalid('Неверный идентификатор записи.')
  return id
}

export async function readDdsDirectory(db:D1Database,actor:AuthUser|null):Promise<DdsDirectoryCategory[]>{
  requireAccess(actor)
  const [categories,articles]=await Promise.all([
    db.prepare('SELECT id,name,is_active FROM dds_categories ORDER BY sort_order,id').bind().all<Row>(),
    db.prepare('SELECT id,category_id,name,is_active FROM dds_articles ORDER BY sort_order,id').bind().all<Row>()
  ])
  const grouped=new Map<number,DdsDirectoryCategory>()
  for(const row of categories.results||[])
    grouped.set(row.id,{id:row.id,name:row.name,active:Boolean(row.is_active),articles:[]})
  for(const row of articles.results||[]){
    const parent=grouped.get(Number(row.category_id))
    parent?.articles.push({id:row.id,name:row.name,active:Boolean(row.is_active)})
  }
  return [...grouped.values()]
}
export async function addDdsCategory(db:D1Database,nameInput:unknown,actor:AuthUser|null){
  requireAccess(actor,true)
  const name=nameField(nameInput,80,'Название категории')
  await db.prepare(`INSERT OR IGNORE INTO dds_categories(name,sort_order)
    VALUES(?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM dds_categories))`).bind(name).run()
  const category=await db.prepare('SELECT id,name,is_active FROM dds_categories WHERE name=?')
    .bind(name).first<Row>()
  if(!category)throw invalid('Не удалось создать категорию.')
  return {ok:true,id:category.id,name:category.name,active:Boolean(category.is_active)}
}
export async function addDdsArticle(db:D1Database,categoryId:number,nameInput:unknown,actor:AuthUser|null){
  requireAccess(actor,true)
  positiveId(categoryId)
  const name=nameField(nameInput,100,'Название статьи')
  const parent=await db.prepare('SELECT id,is_active FROM dds_categories WHERE id=?')
    .bind(categoryId).first<Row>()
  if(!parent)throw invalid('Категория не найдена.',404)
  if(!parent.is_active)throw invalid('Сначала восстановите скрытую категорию.',409)
  await db.prepare(`INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
    VALUES(?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM dds_articles WHERE category_id=?))`)
    .bind(categoryId,name,categoryId).run()
  const article=await db.prepare('SELECT id,name,is_active FROM dds_articles WHERE category_id=? AND name=?')
    .bind(categoryId,name).first<Row>()
  if(!article)throw invalid('Не удалось создать статью.')
  return {ok:true,id:article.id,name:article.name,active:Boolean(article.is_active)}
}
export async function setDdsCategoryActive(db:D1Database,categoryId:number,active:unknown,actor:AuthUser|null){
  requireAccess(actor,true)
  positiveId(categoryId)
  if(typeof active!=='boolean')throw invalid('Укажите правильное состояние категории.')
  const row=await db.prepare('SELECT id,name FROM dds_categories WHERE id=?').bind(categoryId).first<Row>()
  if(!row)throw invalid('Категория не найдена.',404)
  await db.prepare('UPDATE dds_categories SET is_active=? WHERE id=?')
    .bind(active?1:0,categoryId).run()
  return {ok:true,id:categoryId,active}
}
export async function setDdsArticleActive(db:D1Database,articleId:number,active:unknown,actor:AuthUser|null){
  requireAccess(actor,true)
  positiveId(articleId)
  if(typeof active!=='boolean')throw invalid('Укажите правильное состояние статьи.')
  const row=await db.prepare('SELECT id,category_id FROM dds_articles WHERE id=?')
    .bind(articleId).first<Row>()
  if(!row)throw invalid('Статья не найдена.',404)
  if(active){
    const category=await db.prepare('SELECT is_active FROM dds_categories WHERE id=?')
      .bind(row.category_id).first<Row>()
    if(!category?.is_active)throw invalid('Сначала восстановите категорию.',409)
  }
  await db.prepare('UPDATE dds_articles SET is_active=? WHERE id=?').bind(active?1:0,articleId).run()
  return {ok:true,id:articleId,active}
}
export async function activeDdsArticle(db:D1Database,category:string,article:string){
  const matched=await db.prepare(`SELECT a.id FROM dds_articles a
    JOIN dds_categories c ON c.id=a.category_id
    WHERE c.name=? AND a.name=? AND c.is_active=1 AND a.is_active=1`)
    .bind(category,article).first<{id:number}>()
  return Boolean(matched)
}

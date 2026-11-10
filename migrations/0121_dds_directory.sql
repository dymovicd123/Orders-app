-- DDS-only directory. Additive migration: previous DDS entries and all other tables stay unchanged.
-- Names in historical entries are preserved. "Hidden" items are not deleted or renamed.
CREATE TABLE IF NOT EXISTS dds_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  name_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dds_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES dds_categories(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  name_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id,name_key)
);
CREATE INDEX IF NOT EXISTS idx_dds_articles_category ON dds_articles(category_id,sort_order,id);

-- The 12 approved categories and 50 articles become editable records; not code-only constants.
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Доставка клиенту','доставка клиенту',1);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Курьер — Kaspi (Замлер)','курьер — kaspi (замлер)',1 FROM dds_categories WHERE name_key='доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Курьер — вокзал','курьер — вокзал',2 FROM dds_categories WHERE name_key='доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Курьер — авиа','курьер — авиа',3 FROM dds_categories WHERE name_key='доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Доставка по городу (клиенту)','доставка по городу (клиенту)',4 FROM dds_categories WHERE name_key='доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Доставка межгород (клиенту)','доставка межгород (клиенту)',5 FROM dds_categories WHERE name_key='доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'СДЭК (за границу)','сдэк (за границу)',6 FROM dds_categories WHERE name_key='доставка клиенту';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Доставка к нам','доставка к нам',2);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Карго (Китай, Кыргызстан)','карго (китай, кыргызстан)',1 FROM dds_categories WHERE name_key='доставка к нам';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Курьер — цех','курьер — цех',2 FROM dds_categories WHERE name_key='доставка к нам';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Курьер — базар (товар)','курьер — базар (товар)',3 FROM dds_categories WHERE name_key='доставка к нам';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Курьер — базар (упаковка)','курьер — базар (упаковка)',4 FROM dds_categories WHERE name_key='доставка к нам';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Упаковка','упаковка',3);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Скотч / стрейч','скотч / стрейч',1 FROM dds_categories WHERE name_key='упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Курьерский пакет','курьерский пакет',2 FROM dds_categories WHERE name_key='упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Зип-пакет','зип-пакет',3 FROM dds_categories WHERE name_key='упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Бренд-пакет','бренд-пакет',4 FROM dds_categories WHERE name_key='упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Коробки','коробки',5 FROM dds_categories WHERE name_key='упаковка';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Закуп товара','закуп товара',4);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — цех','закуп — цех',1 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — базар','закуп — базар',2 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — Кыргызстан','закуп — кыргызстан',3 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — Китай','закуп — китай',4 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — такия','закуп — такия',5 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — орамал','закуп — орамал',6 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — шарф','закуп — шарф',7 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Закуп — украшения','закуп — украшения',8 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Ателье (пошив, подгонка)','ателье (пошив, подгонка)',9 FROM dds_categories WHERE name_key='закуп товара';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Зарплата — менеджеры','зарплата — менеджеры',5);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Оклад','оклад',1 FROM dds_categories WHERE name_key='зарплата — менеджеры';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Премия за стандарты','премия за стандарты',2 FROM dds_categories WHERE name_key='зарплата — менеджеры';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Бонус KPI','бонус kpi',3 FROM dds_categories WHERE name_key='зарплата — менеджеры';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Зарплата — склад','зарплата — склад',6);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Оклад','оклад',1 FROM dds_categories WHERE name_key='зарплата — склад';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Бонус KPI','бонус kpi',2 FROM dds_categories WHERE name_key='зарплата — склад';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Зарплата — остальные','зарплата — остальные',7);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Упаковщик','упаковщик',1 FROM dds_categories WHERE name_key='зарплата — остальные';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'SMM','smm',2 FROM dds_categories WHERE name_key='зарплата — остальные';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Таргетолог','таргетолог',3 FROM dds_categories WHERE name_key='зарплата — остальные';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Маркетинг и контент','маркетинг и контент',8);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Таргет (рекламный бюджет)','таргет (рекламный бюджет)',1 FROM dds_categories WHERE name_key='маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Студия','студия',2 FROM dds_categories WHERE name_key='маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Модель','модель',3 FROM dds_categories WHERE name_key='маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Такси до студии','такси до студии',4 FROM dds_categories WHERE name_key='маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Мобилограф','мобилограф',5 FROM dds_categories WHERE name_key='маркетинг и контент';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Помещение','помещение',9);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Аренда','аренда',1 FROM dds_categories WHERE name_key='помещение';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Коммунальные услуги','коммунальные услуги',2 FROM dds_categories WHERE name_key='помещение';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Хозтовары','хозтовары',3 FROM dds_categories WHERE name_key='помещение';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Ремонт и оборудование','ремонт и оборудование',4 FROM dds_categories WHERE name_key='помещение';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Сервисы и связь','сервисы и связь',10);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'amoCRM','amocrm',1 FROM dds_categories WHERE name_key='сервисы и связь';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Whatcrm / Телфин','whatcrm / телфин',2 FROM dds_categories WHERE name_key='сервисы и связь';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'YouPlatform','youplatform',3 FROM dds_categories WHERE name_key='сервисы и связь';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Интернет и связь','интернет и связь',4 FROM dds_categories WHERE name_key='сервисы и связь';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Налоги и комиссии','налоги и комиссии',11);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Налоги','налоги',1 FROM dds_categories WHERE name_key='налоги и комиссии';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Комиссия Kaspi','комиссия kaspi',2 FROM dds_categories WHERE name_key='налоги и комиссии';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Комиссия банка / эквайринг','комиссия банка / эквайринг',3 FROM dds_categories WHERE name_key='налоги и комиссии';
INSERT OR IGNORE INTO dds_categories(name,name_key,sort_order) VALUES('Прочее','прочее',12);
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Возвраты клиентам','возвраты клиентам',1 FROM dds_categories WHERE name_key='прочее';
INSERT OR IGNORE INTO dds_articles(category_id,name,name_key,sort_order)
SELECT id,'Прочее','прочее',2 FROM dds_categories WHERE name_key='прочее';

-- Validation stays atomic when a category/article is archived concurrently with an expense.
-- This trigger applies only to NEW DDS expense writes; old rows, reversals and reports remain intact.
CREATE TRIGGER IF NOT EXISTS dds_expense_active_article_guard
BEFORE INSERT ON dds_entries
WHEN NEW.kind = 'expense' AND NOT EXISTS (
  SELECT 1 FROM dds_articles a
    JOIN dds_categories c ON c.id=a.category_id
  WHERE c.name=NEW.category COLLATE NOCASE AND a.name=NEW.article COLLATE NOCASE
    AND c.is_active=1 AND a.is_active=1
)
BEGIN
  SELECT RAISE(ABORT,'DDS_INVALID_ARTICLE');
END;

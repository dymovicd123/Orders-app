-- DDS-only directory. Additive migration: previous DDS entries and all other tables stay unchanged.
-- Names in historical entries are preserved. "Hidden" items are not deleted or renamed.
CREATE TABLE IF NOT EXISTS dds_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dds_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES dds_categories(id),
  name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 100),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id,name)
);
CREATE INDEX IF NOT EXISTS idx_dds_articles_category ON dds_articles(category_id,sort_order,id);

-- The 12 approved categories and 50 articles become editable records; not code-only constants.
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Доставка клиенту',1);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Курьер — Kaspi (Замлер)',1 FROM dds_categories WHERE name='Доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Курьер — вокзал',2 FROM dds_categories WHERE name='Доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Курьер — авиа',3 FROM dds_categories WHERE name='Доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Доставка по городу (клиенту)',4 FROM dds_categories WHERE name='Доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Доставка межгород (клиенту)',5 FROM dds_categories WHERE name='Доставка клиенту';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'СДЭК (за границу)',6 FROM dds_categories WHERE name='Доставка клиенту';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Доставка к нам',2);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Карго (Китай, Кыргызстан)',1 FROM dds_categories WHERE name='Доставка к нам';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Курьер — цех',2 FROM dds_categories WHERE name='Доставка к нам';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Курьер — базар (товар)',3 FROM dds_categories WHERE name='Доставка к нам';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Курьер — базар (упаковка)',4 FROM dds_categories WHERE name='Доставка к нам';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Упаковка',3);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Скотч / стрейч',1 FROM dds_categories WHERE name='Упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Курьерский пакет',2 FROM dds_categories WHERE name='Упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Зип-пакет',3 FROM dds_categories WHERE name='Упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Бренд-пакет',4 FROM dds_categories WHERE name='Упаковка';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Коробки',5 FROM dds_categories WHERE name='Упаковка';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Закуп товара',4);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — цех',1 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — базар',2 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — Кыргызстан',3 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — Китай',4 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — такия',5 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — орамал',6 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — шарф',7 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Закуп — украшения',8 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Ателье (пошив, подгонка)',9 FROM dds_categories WHERE name='Закуп товара';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Зарплата — менеджеры',5);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Оклад',1 FROM dds_categories WHERE name='Зарплата — менеджеры';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Премия за стандарты',2 FROM dds_categories WHERE name='Зарплата — менеджеры';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Бонус KPI',3 FROM dds_categories WHERE name='Зарплата — менеджеры';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Зарплата — склад',6);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Оклад',1 FROM dds_categories WHERE name='Зарплата — склад';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Бонус KPI',2 FROM dds_categories WHERE name='Зарплата — склад';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Зарплата — остальные',7);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Упаковщик',1 FROM dds_categories WHERE name='Зарплата — остальные';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'SMM',2 FROM dds_categories WHERE name='Зарплата — остальные';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Таргетолог',3 FROM dds_categories WHERE name='Зарплата — остальные';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Маркетинг и контент',8);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Таргет (рекламный бюджет)',1 FROM dds_categories WHERE name='Маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Студия',2 FROM dds_categories WHERE name='Маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Модель',3 FROM dds_categories WHERE name='Маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Такси до студии',4 FROM dds_categories WHERE name='Маркетинг и контент';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Мобилограф',5 FROM dds_categories WHERE name='Маркетинг и контент';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Помещение',9);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Аренда',1 FROM dds_categories WHERE name='Помещение';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Коммунальные услуги',2 FROM dds_categories WHERE name='Помещение';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Хозтовары',3 FROM dds_categories WHERE name='Помещение';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Ремонт и оборудование',4 FROM dds_categories WHERE name='Помещение';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Сервисы и связь',10);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'amoCRM',1 FROM dds_categories WHERE name='Сервисы и связь';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Whatcrm / Телфин',2 FROM dds_categories WHERE name='Сервисы и связь';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'YouPlatform',3 FROM dds_categories WHERE name='Сервисы и связь';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Интернет и связь',4 FROM dds_categories WHERE name='Сервисы и связь';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Налоги и комиссии',11);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Налоги',1 FROM dds_categories WHERE name='Налоги и комиссии';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Комиссия Kaspi',2 FROM dds_categories WHERE name='Налоги и комиссии';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Комиссия банка / эквайринг',3 FROM dds_categories WHERE name='Налоги и комиссии';
INSERT OR IGNORE INTO dds_categories(name,sort_order) VALUES('Прочее',12);
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Возвраты клиентам',1 FROM dds_categories WHERE name='Прочее';
INSERT OR IGNORE INTO dds_articles(category_id,name,sort_order)
SELECT id,'Прочее',2 FROM dds_categories WHERE name='Прочее';

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

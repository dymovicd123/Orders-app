// Approved 02.11.2026 KAZAKWA AISO expense categories.
// Independent from orders, office cash register, staff and payment methods.
export const DDS_CATEGORIES = [
  { name: 'Доставка клиенту', articles: [
    'Курьер — Kaspi (Замлер)', 'Курьер — вокзал', 'Курьер — авиа',
    'Доставка по городу (клиенту)', 'Доставка межгород (клиенту)', 'СДЭК (за границу)',
  ] },
  { name: 'Доставка к нам', articles: [
    'Карго (Китай, Кыргызстан)', 'Курьер — цех', 'Курьер — базар (товар)', 'Курьер — базар (упаковка)',
  ] },
  { name: 'Упаковка', articles: [
    'Скотч / стрейч', 'Курьерский пакет', 'Зип-пакет', 'Бренд-пакет', 'Коробки',
  ] },
  { name: 'Закуп товара', articles: [
    'Закуп — цех', 'Закуп — базар', 'Закуп — Кыргызстан', 'Закуп — Китай',
    'Закуп — такия', 'Закуп — орамал', 'Закуп — шарф', 'Закуп — украшения',
    'Ателье (пошив, подгонка)',
  ] },
  { name: 'Зарплата — менеджеры', articles: ['Оклад', 'Премия за стандарты', 'Бонус KPI'] },
  { name: 'Зарплата — склад', articles: ['Оклад', 'Бонус KPI'] },
  { name: 'Зарплата — остальные', articles: ['Упаковщик', 'SMM', 'Таргетолог'] },
  { name: 'Маркетинг и контент', articles: [
    'Таргет (рекламный бюджет)', 'Студия', 'Модель', 'Такси до студии', 'Мобилограф',
  ] },
  { name: 'Помещение', articles: ['Аренда', 'Коммунальные услуги', 'Хозтовары', 'Ремонт и оборудование'] },
  { name: 'Сервисы и связь', articles: ['amoCRM', 'Whatcrm / Телфин', 'YouPlatform', 'Интернет и связь'] },
  { name: 'Налоги и комиссии', articles: ['Налоги', 'Комиссия Kaspi', 'Комиссия банка / эквайринг'] },
  { name: 'Прочее', articles: ['Возвраты клиентам', 'Прочее'] },
] as const

export function validDdsArticle(category: string, article: string) {
  const group = DDS_CATEGORIES.find(item => item.name === category)
  return Boolean(group && group.articles.some(item => item === article))
}

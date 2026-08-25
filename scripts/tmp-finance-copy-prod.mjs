import fs from 'node:fs'

const path = 'src/features/renderers/FinanceDashboardRenderer.tsx'
let source = fs.readFileSync(path, 'utf8')
const replacements = [
  ['Это не расхождение само по себе: деньги входят в выбранный период по дате операции, а продажа — по дате заказа. Закрытие долга здесь является обычной операцией; необычные случаи отдельно объясняются в проверке дат.', 'Здесь показаны оплаты, которые поступили в выбранном периоде, но относятся к заказам из другого периода.'],
  ['Это объяснимые различия дат, а не ошибки. Они нужны, чтобы можно было проследить происхождение суммы без тревожного статуса.', 'Проверьте эти заказы. Если дата оплаты указана неверно, исправьте её, чтобы оплата попала в правильный период.'],
]
for (const [before, after] of replacements) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`Expected one marker, found ${count}`)
  source = source.replace(before, after)
}
fs.writeFileSync(path, source)
console.log('Finance summary copy updated.')

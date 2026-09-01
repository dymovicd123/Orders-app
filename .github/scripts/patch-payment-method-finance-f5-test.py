from pathlib import Path

# Keep the existing operator explanation about the shared debt-close path, while making
# the new method-only correction behavior explicit.
editor_path = Path('src/features/sections/OrderEditorSection.tsx')
editor = editor_path.read_text()
old_note = "                        Если первичную оплату забыли внести, добавьте её явно — она всегда относится к дате заказа. Любая обычная оплата позже создания заказа оформляется как «Закрытие долга». У уже проведённой оплаты можно исправить способ оплаты; сумма, дата и смысл операции останутся прежними, а исправление сохранится в денежной истории."
new_note = "                        Если первичную оплату забыли внести, добавьте её явно — она всегда относится к дате заказа. Любая обычная оплата позже создания заказа оформляется как «Закрытие долга» и проходит через тот же серверный механизм, что и отдельная кнопка закрытия долга. У уже проведённой оплаты можно исправить способ оплаты; сумма, дата и смысл операции останутся прежними, а исправление сохранится в денежной истории."
if editor.count(old_note) != 1:
    raise SystemExit('patched OrderEditor finance note anchor changed')
editor_path.write_text(editor.replace(old_note, new_note, 1))

p = Path('scripts/test-finance-f5-entry-semantics.mjs')
text = p.read_text()
old = """  check(editor.includes('Уже проведённые оплаты здесь не переписываются'), 'Editor does not explain immutable persisted payments')
  check(app.includes('if (paymentIndex !== index || payment.id) return payment'), 'Controller can still mutate a persisted payment row')
  check(app.includes('if (!current || current.payments[index]?.id) return current'), 'Controller can still delete a persisted payment row')
"""
new = """  check(editor.includes('У уже проведённой оплаты можно исправить способ оплаты'), 'Editor does not explain method-only persisted payment correction')
  check(app.includes(\"if (payment.id && field !== 'method') return payment\"), 'Controller does not restrict persisted payment edits to method only')
  check(app.includes('if (!current || current.payments[index]?.id) return current'), 'Controller can still delete a persisted payment row')
"""
if text.count(old) != 1:
    raise SystemExit('Finance F5 persisted-payment immutability guard anchor changed')
p.write_text(text.replace(old, new, 1))
print('Finance F5 updated for method-only persisted payment correction')

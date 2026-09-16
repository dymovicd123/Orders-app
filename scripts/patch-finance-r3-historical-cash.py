from pathlib import Path
import hashlib
import json
import re
import subprocess

root = Path('.')
app_path = root / 'src/App.tsx'
renderer_path = root / 'src/features/renderers/FinanceDashboardRenderer.tsx'
cash_path = root / 'worker/domains/cash.ts'
test_path = root / 'scripts/test-finance-day-transparency.mjs'
wrapper_path = root / 'scripts/test-step1906a-worker-modularization.mjs'
frontend_manifest_path = root / 'scripts/finance-day-transparency-manifest.json'
worker_manifest_path = root / 'scripts/finance-r3-historical-cash-worker-manifest.json'


def declaration_hash(source: str, name: str) -> str:
    match = re.search(rf'^export async function {re.escape(name)}\([\s\S]*?^\}}$', source, re.M)
    if not match:
        raise SystemExit(f'declaration not found: {name}')
    normalized = re.sub(r'^export\s+', '', match.group(0), count=1)
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


# Frontend controller: a past date is explicit and admin-only in the UI.
app = app_path.read_text(encoding='utf-8')
old_state = "  const [cashMovementDraft, setCashMovementDraft] = useState<{ direction: 'in' | 'out'; amount: number; comment: string }>({ direction: 'out', amount: 0, comment: '' })"
new_state = "  const [cashMovementDraft, setCashMovementDraft] = useState<{ direction: 'in' | 'out'; amount: number; comment: string; businessDate: string }>({ direction: 'out', amount: 0, comment: '', businessDate: '' })"
if old_state not in app:
    raise SystemExit('cashMovementDraft state anchor missing')
app = app.replace(old_state, new_state, 1)

confirm_pattern = re.compile(r"    if \(cashMovementDraft\.direction === 'out' && !window\.confirm\(`Выдать из кассы .*?\)\) return\n    const requestId = makeCashRequestId\('manual'\)", re.S)
confirm_replacement = """    const historicalBusinessDate = isAdmin ? cashMovementDraft.businessDate.trim() : ''
    if (historicalBusinessDate && !/^\\d{4}-\\d{2}-\\d{2}$/.test(historicalBusinessDate)) {
      setError('Укажите корректную дату пропущенной операции.')
      return
    }
    if (historicalBusinessDate) {
      const directionLabel = cashMovementDraft.direction === 'in' ? 'внесение' : 'выдачу'
      if (!window.confirm(`Добавить пропущенное ${directionLabel} ${formatMoney(amount)} за ${formatDateShort(historicalBusinessDate)}?\\n\\nДата операции будет сохранена отдельно от сегодняшнего времени внесения.\\n${comment}`)) return
    } else if (cashMovementDraft.direction === 'out' && !window.confirm(`Выдать из кассы ${formatMoney(amount)}?\\n\\n${comment}`)) return
    const requestId = makeCashRequestId('manual')"""
app, count = confirm_pattern.subn(lambda _: confirm_replacement, app, count=1)
if count != 1:
    raise SystemExit('cash movement confirmation anchor missing')

old_request = "          body: JSON.stringify({ direction: cashMovementDraft.direction, amount, comment, requestId }),"
new_request = "          body: JSON.stringify({ direction: cashMovementDraft.direction, amount, comment, requestId, ...(historicalBusinessDate ? { businessDate: historicalBusinessDate } : {}) }),"
if old_request not in app:
    raise SystemExit('cash movement request anchor missing')
app = app.replace(old_request, new_request, 1)

old_success = "        setCashMovementDraft((current) => ({ ...current, amount: 0, comment: '' }))\n        setMessage(cashMovementDraft.direction === 'in' ? 'Внесение наличных записано.' : 'Выдача наличных записана.')"
new_success = "        setCashMovementDraft((current) => ({ ...current, amount: 0, comment: '', businessDate: '' }))\n        setMessage(historicalBusinessDate\n          ? `Пропущенная операция добавлена за ${formatDateShort(historicalBusinessDate)}. Время внесения сохранено отдельно.`\n          : cashMovementDraft.direction === 'in' ? 'Внесение наличных записано.' : 'Выдача наличных записана.')"
if old_success not in app:
    raise SystemExit('cash movement success anchor missing')
app = app.replace(old_success, new_success, 1)
app_path.write_text(app, encoding='utf-8')


# Cash UI: past business date is optional, visible only to admins.
renderer = renderer_path.read_text(encoding='utf-8')
old_copy = "<div className=\"mini-panel-head\"><div><h3>Ручная операция</h3><p className=\"mini-panel-note\">Комментарий обязателен. Новая операция записывается сегодняшней датой, а не выбранным прошлым днём.</p></div></div>"
new_copy = "<div className=\"mini-panel-head\"><div><h3>Ручная операция</h3><p className=\"mini-panel-note\">Комментарий обязателен. Обычная операция записывается сегодня. Администратор может отдельно указать прошлую дату только для действительно пропущенного движения текущего цикла.</p></div></div>"
if old_copy not in renderer:
    raise SystemExit('cash manual copy anchor missing')
renderer = renderer.replace(old_copy, new_copy, 1)

old_form = "                    <label><span>Сумма</span><FriendlyNumberInput type=\"number\" min=\"0\" value={cashMovementDraft.amount || ''} onChange={(event) => setCashMovementDraft((current) => ({ ...current, amount: Math.max(0, Number(event.target.value || 0)) }))} /></label>\n                    <label className=\"wide-field\"><span>Комментарий</span><input value={cashMovementDraft.comment} onChange={(event) => setCashMovementDraft((current) => ({ ...current, comment: event.target.value }))} /></label>"
new_form = "                    <label><span>Сумма</span><FriendlyNumberInput type=\"number\" min=\"0\" value={cashMovementDraft.amount || ''} onChange={(event) => setCashMovementDraft((current) => ({ ...current, amount: Math.max(0, Number(event.target.value || 0)) }))} /></label>\n                    {isAdmin ? <label><span>Прошлая дата — только если запись забыли</span><input type=\"date\" value={cashMovementDraft.businessDate || ''} onChange={(event) => setCashMovementDraft((current) => ({ ...current, businessDate: event.target.value }))} /><small className=\"cash-entry-meta\">Оставьте пустым для обычной операции сегодня. Дата не может быть раньше начала текущего цикла кассы.</small></label> : null}\n                    <label className=\"wide-field\"><span>Комментарий</span><input value={cashMovementDraft.comment} onChange={(event) => setCashMovementDraft((current) => ({ ...current, comment: event.target.value }))} /></label>"
if old_form not in renderer:
    raise SystemExit('cash manual form anchor missing')
renderer = renderer.replace(old_form, new_form, 1)
renderer_path.write_text(renderer, encoding='utf-8')


# Domain mutation: preserve router exactly. Store business_date separately from insertion time.
cash_before = cash_path.read_text(encoding='utf-8')
before_add = declaration_hash(cash_before, 'addManualCashRegisterMovement')
before_reverse = declaration_hash(cash_before, 'reverseManualCashRegisterMovement')

old_add = re.search(r'^export async function addManualCashRegisterMovement\([\s\S]*?^\}$', cash_before, re.M)
if not old_add:
    raise SystemExit('addManualCashRegisterMovement block missing')
new_add = r'''export async function addManualCashRegisterMovement(
  db: D1Database,
  input: { direction?: unknown; amount?: number; comment?: string; requestId?: unknown; businessDate?: unknown },
  actor?: AuthUser | null,
) {
  const state = await getCashRegisterState(db);
  if (!state.initialized) throw new Error('Сначала установите начальный остаток наличных.');
  const direction = cleanText(input.direction).toLowerCase() === 'in' ? 'in' : cleanText(input.direction).toLowerCase() === 'out' ? 'out' : '';
  const amount = Math.max(0, Math.trunc(Number(input.amount || 0)));
  const comment = cleanText(input.comment);
  if (!direction) throw new Error('Выберите: внесение или выдача наличных.');
  if (amount <= 0) throw new Error('Укажите сумму больше нуля.');
  if (!comment) throw new Error('Комментарий обязателен: укажите, откуда пришли или куда ушли деньги.');
  if (direction === 'out' && amount > state.currentBalance) throw new Error(`Нельзя выдать ${amount}: в кассе по учёту ${state.currentBalance}.`);

  const timestamp = new Date().toISOString();
  const todayBusinessDate = kazakhstanBusinessDate();
  const requestedBusinessDate = cleanText(input.businessDate);
  let businessDate = todayBusinessDate;
  if (requestedBusinessDate) {
    if (actor?.role !== 'admin') throw new Error('Добавлять пропущенные операции кассы может только администратор.');
    const parsedBusinessDate = new Date(`${requestedBusinessDate}T00:00:00.000Z`);
    const validBusinessDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedBusinessDate)
      && Number.isFinite(parsedBusinessDate.getTime())
      && parsedBusinessDate.toISOString().slice(0, 10) === requestedBusinessDate;
    if (!validBusinessDate) throw new Error('Укажите корректную дату пропущенной операции.');
    if (requestedBusinessDate > todayBusinessDate) throw new Error('Нельзя добавить операцию будущей датой.');
    const cycleAnchor = cleanText(state.currentCycleStartedAt || state.initializedAt);
    const cycleStartDate = cycleAnchor ? normalizeDate(cycleAnchor) : '';
    if (cycleStartDate && requestedBusinessDate < cycleStartDate) {
      throw new Error(`Дата ${requestedBusinessDate} раньше начала текущего цикла кассы (${cycleStartDate}). Такая операция уже должна быть учтена в начальном остатке или прошлом цикле.`);
    }
    businessDate = requestedBusinessDate;
  }

  const createdBy = cleanText(actor?.displayName || actor?.email) || 'Пользователь';
  const normalizedRequestId = normalizeCashRequestId(input.requestId);
  if (requestedBusinessDate && !normalizedRequestId) throw new Error('Не удалось сформировать безопасный идентификатор пропущенной операции. Повторите действие.');
  const requestId = normalizedRequestId || `server-${Date.now()}-${randomToken(8)}`;
  const sourceKey = `manual:${requestId}`;
  if (requestedBusinessDate) {
    const existing = await db.prepare(
      'SELECT business_date FROM cash_register_entries WHERE source_key = ? LIMIT 1'
    ).bind(sourceKey).first<any>();
    if (existing && cleanText(existing.business_date) !== businessDate) {
      throw new Error('Эта операция уже записана с другой датой. Обновите кассу перед повтором.');
    }
  }
  const insertResult = await db.prepare(
    `INSERT OR IGNORE INTO cash_register_entries (
       occurred_at, business_date, direction, amount, entry_type,
       source_type, source_id, source_key, order_id, external_order_id,
       payment_method, comment, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, 'manual', NULL, ?, NULL, NULL, NULL, ?, ?, ?)`
  ).bind(timestamp, businessDate, direction, amount, direction === 'in' ? 'manual_in' : 'manual_out', sourceKey, comment, createdBy, timestamp).run();

  if (toInt((insertResult.meta as any)?.changes, 0) > 0) {
    await writeActivityLog(db, {
      eventType: direction === 'in' ? 'cash_manual_in' : 'cash_manual_out', entityType: 'cash_register',
      title: direction === 'in' ? 'Ручное внесение наличных' : 'Ручная выдача наличных',
      details: businessDate === todayBusinessDate ? comment : `${comment}; относится к ${businessDate}`,
      amount, createdAt: timestamp,
    });
  }
  return getCashRegisterState(db);
}'''
cash = cash_before[:old_add.start()] + new_add + cash_before[old_add.end():]

old_reverse = re.search(r'^export async function reverseManualCashRegisterMovement\([\s\S]*?^\}$', cash, re.M)
if not old_reverse:
    raise SystemExit('reverseManualCashRegisterMovement block missing')
new_reverse = r'''export async function reverseManualCashRegisterMovement(db: D1Database, entryId: number, actor?: AuthUser | null) {
  const original = await db.prepare(
    `SELECT id, direction, amount, comment, source_type, business_date
     FROM cash_register_entries WHERE id = ?`
  ).bind(entryId).first<any>();
  if (!original || cleanText(original.source_type) !== 'manual') throw new Error('Можно отменить только ручное внесение или выдачу.');
  const sourceKey = `manual-reversal:${entryId}`;
  const existing = await db.prepare('SELECT id FROM cash_register_entries WHERE source_key = ?').bind(sourceKey).first<any>();
  if (existing) return getCashRegisterState(db);
  const timestamp = new Date().toISOString();
  const direction = cleanText(original.direction) === 'out' ? 'in' : 'out';
  const businessDate = cleanText(original.business_date) || kazakhstanBusinessDate();
  const createdBy = cleanText(actor?.displayName || actor?.email) || 'Пользователь';
  const comment = `Отмена ручной операции: ${cleanText(original.comment) || `#${entryId}`}`;
  await db.prepare(
    `INSERT INTO cash_register_entries (
       occurred_at, business_date, direction, amount, entry_type,
       source_type, source_id, source_key, order_id, external_order_id,
       payment_method, comment, created_by, created_at
     ) VALUES (?, ?, ?, ?, 'manual_reversal', 'manual_reversal', ?, ?, NULL, NULL, NULL, ?, ?, ?)`
  ).bind(timestamp, businessDate, direction, Math.max(0, toInt(original.amount, 0)), String(entryId), sourceKey, comment, createdBy, timestamp).run();
  await writeActivityLog(db, {
    eventType: 'cash_manual_reversed', entityType: 'cash_register', entityId: entryId,
    title: 'Отменена ручная операция кассы', details: comment, amount: Math.max(0, toInt(original.amount, 0)), createdAt: timestamp,
  });
  return getCashRegisterState(db);
}'''
cash = cash[:old_reverse.start()] + new_reverse + cash[old_reverse.end():]
cash_path.write_text(cash, encoding='utf-8')

after_add = declaration_hash(cash, 'addManualCashRegisterMovement')
after_reverse = declaration_hash(cash, 'reverseManualCashRegisterMovement')
worker_manifest = {
  'version': 1,
  'revision': 'finance-r3-historical-cash',
  'changes': {
    'addManualCashRegisterMovement': {'before': before_add, 'after': after_add},
    'reverseManualCashRegisterMovement': {'before': before_reverse, 'after': after_reverse},
  },
}
worker_manifest_path.write_text(json.dumps(worker_manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


# Teach 1906A exactly these two declaration deltas; router remains frozen.
wrapper = wrapper_path.read_text(encoding='utf-8')
prepend_anchor = "patched = 'const financeDayChanges = ' + JSON.stringify(financeDay.changes) + '\\nconst financeDayAdded = ' + JSON.stringify(financeDay.added) + '\\n' + patched"
if prepend_anchor not in wrapper:
    raise SystemExit('1906A finance day prepend anchor missing')
prepend_replacement = "const financeR3HistoricalCash = JSON.parse(fs.readFileSync(path.join(root, 'scripts/finance-r3-historical-cash-worker-manifest.json'), 'utf8'))\nif (financeR3HistoricalCash.version !== 1 || financeR3HistoricalCash.revision !== 'finance-r3-historical-cash' || Object.keys(financeR3HistoricalCash.changes).join(',') !== 'addManualCashRegisterMovement,reverseManualCashRegisterMovement') throw new Error('Finance R3 historical cash Worker allow-list changed')\npatched = 'const financeR3HistoricalCashChanges = ' + JSON.stringify(financeR3HistoricalCash.changes) + '\\nconst financeDayChanges = ' + JSON.stringify(financeDay.changes) + '\\nconst financeDayAdded = ' + JSON.stringify(financeDay.added) + '\\n' + patched"
wrapper = wrapper.replace(prepend_anchor, prepend_replacement, 1)

hash_anchor = "  '        return sha(declarations.get(name)) === acceptedFinanceDayHash',"
if hash_anchor not in wrapper:
    raise SystemExit('1906A finance day final hash anchor missing')
hash_replacement = "\n".join([
  "  '        const financeR3HistoricalCashChanged = financeR3HistoricalCashChanges[name]',",
  "  '        let acceptedFinanceR3HistoricalCashHash = acceptedFinanceDayHash',",
  "  '        if (financeR3HistoricalCashChanged) {',",
  "  \"          check(financeR3HistoricalCashChanged.before === acceptedFinanceDayHash, 'Finance R3 historical cash predecessor drifted: ' + name)\",",
  "  '          acceptedFinanceR3HistoricalCashHash = financeR3HistoricalCashChanged.after',",
  "  '        }',",
  "  '        return sha(declarations.get(name)) === acceptedFinanceR3HistoricalCashHash',",
])
wrapper = wrapper.replace(hash_anchor, hash_replacement, 1)
wrapper_path.write_text(wrapper, encoding='utf-8')


# Focused regression: semantic markers and safety invariants.
test = test_path.read_text(encoding='utf-8')
needle = "assert.ok(rendererSource.includes('Внесено позже'), 'late-recorded cash must be secondary annotation')\n"
if needle not in test:
    raise SystemExit('finance R3 test anchor missing')
extra = needle + "assert.ok(rendererSource.includes('Прошлая дата — только если запись забыли'), 'admin historical cash date control missing')\nassert.ok(rendererSource.includes('Дата не может быть раньше начала текущего цикла кассы'), 'historical cash safety copy missing')\nassert.ok(appSource.includes('historicalBusinessDate'), 'historical cash date must be sent intentionally, not inferred')\nassert.ok(appSource.includes('businessDate: historicalBusinessDate'), 'historical cash business date missing from mutation payload')\nconst cashDomainSource = fs.readFileSync('worker/domains/cash.ts', 'utf8')\nassert.ok(cashDomainSource.includes(\"actor?.role !== 'admin'\"), 'historical cash mutation must be admin-only')\nassert.ok(cashDomainSource.includes('requestedBusinessDate < cycleStartDate'), 'historical cash must not cross the current-cycle baseline')\nassert.ok(cashDomainSource.includes('Нельзя добавить операцию будущей датой'), 'future cash business dates must be rejected')\nassert.ok(cashDomainSource.includes('.bind(timestamp, businessDate, direction'), 'historical cash must persist business_date separately from insertion time')\nassert.ok(cashDomainSource.includes('source_type, business_date'), 'manual reversal must read original business date')\nassert.ok(cashDomainSource.includes('.bind(timestamp, businessDate, direction, Math.max(0, toInt(original.amount, 0))'), 'manual reversal must preserve the original business date')\n"
test = test.replace(needle, extra, 1)
test_path.write_text(test, encoding='utf-8')


# Existing exact frontend preservation layer advances to the R3 UI blobs.
frontend_manifest = json.loads(frontend_manifest_path.read_text(encoding='utf-8'))
def blob(path: Path) -> str:
    return subprocess.check_output(['git', 'hash-object', str(path)], text=True).strip()
def lines(path: Path) -> int:
    return len(path.read_text(encoding='utf-8').split('\n'))
frontend_manifest['files']['src/App.tsx']['afterGitBlob'] = blob(app_path)
frontend_manifest['files']['src/App.tsx']['afterLines'] = lines(app_path)
frontend_manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterGitBlob'] = blob(renderer_path)
frontend_manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterLines'] = lines(renderer_path)
frontend_manifest_path.write_text(json.dumps(frontend_manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('Finance R3 historical cash domain patch applied')

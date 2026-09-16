from pathlib import Path
import json
import re
import subprocess

root = Path('.')
app_path = root / 'src/App.tsx'
renderer_path = root / 'src/features/renderers/FinanceDashboardRenderer.tsx'
worker_path = root / 'worker/index.ts'
test_path = root / 'scripts/test-finance-day-transparency.mjs'
manifest_path = root / 'scripts/finance-day-transparency-manifest.json'

app = app_path.read_text(encoding='utf-8')
old_state = "  const [cashMovementDraft, setCashMovementDraft] = useState<{ direction: 'in' | 'out'; amount: number; comment: string }>({ direction: 'out', amount: 0, comment: '' })"
new_state = "  const [cashMovementDraft, setCashMovementDraft] = useState<{ direction: 'in' | 'out'; amount: number; comment: string; businessDate: string }>({ direction: 'out', amount: 0, comment: '', businessDate: '' })"
if old_state not in app:
    raise SystemExit('cashMovementDraft state anchor missing')
app = app.replace(old_state, new_state, 1)

pattern = re.compile(r"    if \(cashMovementDraft\.direction === 'out' && !window\.confirm\(`Выдать из кассы .*?\)\) return\n    const requestId = makeCashRequestId\('manual'\)", re.S)
replacement = """    const historicalBusinessDate = isAdmin ? cashMovementDraft.businessDate.trim() : ''
    if (historicalBusinessDate && !/^\\d{4}-\\d{2}-\\d{2}$/.test(historicalBusinessDate)) {
      setError('Укажите корректную дату пропущенной операции.')
      return
    }
    if (historicalBusinessDate) {
      const directionLabel = cashMovementDraft.direction === 'in' ? 'внесение' : 'выдачу'
      if (!window.confirm(`Добавить пропущенное ${directionLabel} ${formatMoney(amount)} за ${formatDateShort(historicalBusinessDate)}?\\
\\
Дата операции будет сохранена отдельно от сегодняшнего времени внесения.\\
${comment}`)) return
    } else if (cashMovementDraft.direction === 'out' && !window.confirm(`Выдать из кассы ${formatMoney(amount)}?\\
\\
${comment}`)) return
    const requestId = makeCashRequestId('manual')"""
app, count = pattern.subn(lambda _: replacement, app, count=1)
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

worker = worker_path.read_text(encoding='utf-8')
old_route = """      if (url.pathname === '/api/finance/cash-register/movements' && request.method === 'POST') {
        const input = await readJson<{ direction?: unknown; amount?: number; comment?: string; requestId?: unknown }>(request);
        return json(await addManualCashRegisterMovement(env.DB, input, authUser), { status: 201 });
      }
"""
new_route = """      if (url.pathname === '/api/finance/cash-register/movements' && request.method === 'POST') {
        const input = await readJson<{ direction?: unknown; amount?: number; comment?: string; requestId?: unknown; businessDate?: unknown }>(request);
        const requestedBusinessDate = cleanText(input.businessDate);
        if (requestedBusinessDate) {
          const denied = requireAdminUser(authUser, 'Добавлять пропущенные операции кассы может только администратор.');
          if (denied) return denied;
          const validDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(requestedBusinessDate)
            && new Date(`${requestedBusinessDate}T00:00:00.000Z`).toISOString().slice(0, 10) === requestedBusinessDate;
          if (!validDate) return json({ ok: false, message: 'Укажите корректную дату пропущенной операции.' }, { status: 400 });
          const today = normalizeDate(new Date());
          if (requestedBusinessDate > today) return json({ ok: false, message: 'Нельзя добавить операцию будущей датой.' }, { status: 400 });
          const stateBefore = await getCashRegisterState(env.DB);
          if (!stateBefore.initialized) return json({ ok: false, message: 'Сначала установите начальный остаток наличных.' }, { status: 400 });
          const cycleAnchor = cleanText(stateBefore.currentCycleStartedAt || stateBefore.initializedAt);
          const cycleStartDate = cycleAnchor ? normalizeDate(cycleAnchor) : '';
          if (cycleStartDate && requestedBusinessDate < cycleStartDate) {
            return json({ ok: false, message: `Дата ${requestedBusinessDate} относится к периоду до начала текущего цикла кассы (${cycleStartDate}). Такая операция уже должна быть учтена в начальном остатке или прошлом цикле.` }, { status: 400 });
          }
          const requestId = cleanText(input.requestId).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 120);
          if (requestId.length < 8) return json({ ok: false, message: 'Не удалось сформировать безопасный идентификатор операции. Повторите действие.' }, { status: 400 });
          const sourceKey = `manual:${requestId}`;
          const existing = await env.DB.prepare('SELECT business_date FROM cash_register_entries WHERE source_key = ? LIMIT 1').bind(sourceKey).first<{ business_date?: string }>();
          if (existing && cleanText(existing.business_date) !== requestedBusinessDate) {
            return json({ ok: false, message: 'Эта операция уже была записана с другой датой. Обновите кассу перед повтором.' }, { status: 409 });
          }
          await addManualCashRegisterMovement(env.DB, { ...input, requestId }, authUser);
          await env.DB.prepare(
            `UPDATE cash_register_entries
             SET business_date = ?
             WHERE source_key = ? AND source_type = 'manual'`
          ).bind(requestedBusinessDate, sourceKey).run();
          return json(await getCashRegisterState(env.DB), { status: 201 });
        }
        return json(await addManualCashRegisterMovement(env.DB, input, authUser), { status: 201 });
      }
"""
if old_route not in worker:
    raise SystemExit('cash movement worker route anchor missing')
worker = worker.replace(old_route, new_route, 1)
worker_path.write_text(worker, encoding='utf-8')

test = test_path.read_text(encoding='utf-8')
needle = "assert.ok(rendererSource.includes('Внесено позже'), 'late-recorded cash must be secondary annotation')\n"
if needle not in test:
    raise SystemExit('finance R3 test anchor missing')
extra = needle + "assert.ok(rendererSource.includes('Прошлая дата — только если запись забыли'), 'admin historical cash date control missing')\nassert.ok(rendererSource.includes('Дата не может быть раньше начала текущего цикла кассы'), 'historical cash safety copy missing')\nassert.ok(appSource.includes('historicalBusinessDate'), 'historical cash date must be sent intentionally, not inferred')\nassert.ok(appSource.includes('businessDate: historicalBusinessDate'), 'historical cash business date missing from mutation payload')\nconst workerIndexSource = fs.readFileSync('worker/index.ts', 'utf8')\nassert.ok(workerIndexSource.includes('Добавлять пропущенные операции кассы может только администратор'), 'historical cash mutation must be admin-only')\nassert.ok(workerIndexSource.includes('requestedBusinessDate < cycleStartDate'), 'historical cash must not cross the current-cycle baseline')\nassert.ok(workerIndexSource.includes('Нельзя добавить операцию будущей датой'), 'future cash business dates must be rejected')\nassert.ok(workerIndexSource.includes('SET business_date = ?'), 'historical cash must persist business_date separately from insertion time')\n"
test = test.replace(needle, extra, 1)
test_path.write_text(test, encoding='utf-8')

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
def blob(path: Path) -> str:
    return subprocess.check_output(['git', 'hash-object', str(path)], text=True).strip()
def lines(path: Path) -> int:
    return len(path.read_text(encoding='utf-8').split('\n'))
manifest['files']['src/App.tsx']['afterGitBlob'] = blob(app_path)
manifest['files']['src/App.tsx']['afterLines'] = lines(app_path)
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterGitBlob'] = blob(renderer_path)
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterLines'] = lines(renderer_path)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('Finance R3 historical cash patch applied')

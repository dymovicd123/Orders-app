from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8', newline='\n')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Browser transport: opt only audited stocktake/check mutations into the
# existing durable sessionStorage request-id machinery.
api_path = 'src/app/controllers/useApiClient.ts'
api = read(api_path)
api = replace_once(api, """function criticalRequestStorageKey(key: string) {
  return `orders-app:critical-request:${key}`
}

type ApiClientArgs = {
""", """function criticalRequestStorageKey(key: string) {
  return `orders-app:critical-request:${key}`
}

function managedInventoryWriteMode(method: string, path: string): 'json' | 'empty' | null {
  if (method === 'POST' && (
    path === '/api/inventory/stocktakes'
    || path === '/api/inventory/stocktakes/quick'
    || path === '/api/inventory/stocktakes/quick-batch'
    || path === '/api/inventory/cycle-counts/apply'
  )) return 'json'
  if (method === 'PATCH' && /^\\/api\\/inventory\\/stocktakes\\/[^/]+\\/items\\/\\d+$/.test(path)) return 'json'
  if (method === 'POST' && /^\\/api\\/inventory\\/stocktakes\\/[^/]+\\/(?:complete|cancel)$/.test(path)) return 'empty'
  return null
}

type ApiClientArgs = {
""", 'api managed matcher')

api = replace_once(api, """    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const safeRead = method === 'GET' || method === 'HEAD'
    const idempotentWrite = !safeRead && Boolean(headers.get('X-Idempotency-Key'))
    const retryableRequest = safeRead || idempotentWrite
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const cacheKey = `${accessRole}:${method}:${url}`
""", """    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const safeRead = method === 'GET' || method === 'HEAD'
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const apiPath = url.split('?')[0].replace(/^https?:\\/\\/[^/]+/i, '')
    const managedInventoryMode = managedInventoryWriteMode(method, apiPath)
    let requestBody = init.body
    let managedInventoryRequestKey = ''
    let managedInventoryRequestId = ''

    if (!safeRead && managedInventoryMode && !headers.get('X-Idempotency-Key')) {
      try {
        const basePayload = managedInventoryMode === 'json' && typeof init.body === 'string'
          ? JSON.parse(init.body) as Record<string, unknown>
          : {}
        if (!basePayload || Array.isArray(basePayload) || typeof basePayload !== 'object') throw new Error('Invalid managed request payload')
        managedInventoryRequestKey = `inventory-write:${method}:${apiPath}`
        const prepared = prepareCriticalRequest(managedInventoryRequestKey, basePayload)
        managedInventoryRequestId = prepared.requestId
        headers.set('X-Idempotency-Key', prepared.requestId)
        if (managedInventoryMode === 'json') requestBody = JSON.stringify(prepared.payload)
      } catch {
        managedInventoryRequestKey = ''
        managedInventoryRequestId = ''
        requestBody = init.body
      }
    }

    const idempotentWrite = !safeRead && Boolean(headers.get('X-Idempotency-Key'))
    const retryableRequest = safeRead || idempotentWrite
    const cacheKey = `${accessRole}:${method}:${url}`
""", 'api managed request setup')

api = replace_once(
    api,
    "const response = await fetch(input, { ...init, headers, credentials: 'include' })",
    "const response = await fetch(input, { ...init, body: requestBody, headers, credentials: 'include' })",
    'api managed request body',
)

api = replace_once(api, """        const transientResponse = TRANSIENT_API_STATUSES.has(response.status)
          || responseLooksLikeHtml(response, bodyText)
          || (idempotentWrite && response.ok && !bodyText.replace(/^\\uFEFF/, '').trim())
""", """        const transientResponse = TRANSIENT_API_STATUSES.has(response.status)
          || responseLooksLikeHtml(response, bodyText)
          || (idempotentWrite && response.ok && !bodyText.replace(/^\\uFEFF/, '').trim())
          || (Boolean(managedInventoryRequestKey) && response.status >= 500)
""", 'api managed 5xx retry')

api = replace_once(
    api,
    "        if (!transientResponse) return response\n",
    """        if (!transientResponse) {
          if (managedInventoryRequestKey && managedInventoryRequestId) {
            completeCriticalRequest(managedInventoryRequestKey, managedInventoryRequestId)
          }
          return response
        }
""",
    'api managed request completion',
)
write(api_path, api)


stock_path = 'worker/domains/inventory-stocktake.ts'
stock = read(stock_path)

# Starting while this source already has an active revision safely resumes it.
stock = replace_once(
    stock,
    "  if (existing?.id) return { ok: false, code: 'active_stocktake_exists', message: 'По этой точке уже идёт незавершённая ревизия. Продолжите или отмените её перед началом новой.', sessionId: existing.id };\n",
    """  if (existing?.id) {
    return {
      ok: true,
      resumed: true,
      sessionId: existing.id,
      session: await serializeInventoryStocktakeSession(db, existing.id),
    };
  }
""",
    'stocktake create resume',
)

# An identical replay is a no-op so counted_at remains the original evidence time.
save_start = stock.index('export async function saveInventoryStocktakeCount(')
save_end = stock.index('export async function addInventoryStocktakeVariant(', save_start)
if save_start < 0 or save_end < 0:
    raise SystemExit('save stocktake section not found')
save = stock[save_start:save_end]
save = replace_once(
    save,
    "`SELECT id, stock_id, variant_id, baseline_quantity, status FROM inventory_stocktake_items WHERE id = ? AND session_id = ? LIMIT 1`",
    "`SELECT id, stock_id, variant_id, baseline_quantity, counted_quantity, counted_at, status, conflict_quantity FROM inventory_stocktake_items WHERE id = ? AND session_id = ? LIMIT 1`",
    'save replay item fields',
)
save = replace_once(
    save,
    "`SELECT id, quantity FROM inventory_stock WHERE id = ? AND inventory_source = ? LIMIT 1`",
    "`SELECT id, quantity, reserved_quantity FROM inventory_stock WHERE id = ? AND inventory_source = ? LIMIT 1`",
    'save stock by id reserved',
)
save = replace_once(
    save,
    "`SELECT id, quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? LIMIT 1`",
    "`SELECT id, quantity, reserved_quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? LIMIT 1`",
    'save stock by variant reserved',
)
save = replace_once(save, """  const now = new Date().toISOString();
  const previousBaseline = toInt(item.baseline_quantity, 0);

  if (clearCount) {
""", """  const now = new Date().toISOString();
  const previousBaseline = toInt(item.baseline_quantity, 0);
  const persistedCount = item.counted_quantity === null || item.counted_quantity === undefined
    ? null
    : Math.max(0, toInt(item.counted_quantity, 0));
  const persistedStatus = cleanText(item.status);
  const alreadyPersisted = currentQuantity === previousBaseline && (
    (clearCount && persistedCount === null && persistedStatus === 'pending')
    || (!clearCount && persistedCount === counted && persistedStatus === 'counted')
  );
  if (alreadyPersisted) {
    return {
      ok: true,
      item: {
        id: itemId,
        stockId: toInt(stock?.id, 0) || toInt(item.stock_id, 0) || null,
        baselineQuantity: previousBaseline,
        countedQuantity: persistedCount,
        countedAt: cleanText(item.counted_at) || null,
        status: persistedStatus,
        conflictQuantity: item.conflict_quantity === null || item.conflict_quantity === undefined ? null : toInt(item.conflict_quantity, 0),
        currentQuantity,
        reservedQuantity: Math.max(0, toInt(stock?.reserved_quantity, 0)),
      },
    };
  }

  if (clearCount) {
""", 'save identical replay no-op')
stock = stock[:save_start] + save + stock[save_end:]

# Quick/cycle checks use the existing UNIQUE check key as durable replay proof.
quick_start = stock.index('export async function quickInventoryStocktakeBatch(')
quick_marker = stock.index('  const variantIds = items.map(item => item.variantId);', quick_start)
quick_end = stock.index('export async function quickInventoryStocktake(', quick_marker)
if quick_start < 0 or quick_marker < 0 or quick_end < 0:
    raise SystemExit('quick stocktake boundaries not found')
old_prefix = stock[quick_start:quick_marker]
if "const activeSession = await db.prepare" not in old_prefix or "const rawItems = Array.isArray(input.items)" not in old_prefix:
    raise SystemExit('quick stocktake prefix changed unexpectedly')
new_prefix = """export async function quickInventoryStocktakeBatch(
  db: D1Database,
  input: { source?: unknown; items?: unknown; requestId?: unknown },
  options: { actor?: string; checkType?: string; referenceType?: string } = {},
): Promise<InventoryCycleCountApplyResponse> {
  const source = normalizeSourceType(input.source);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) throw new Error('Выберите хотя бы одну позицию для сверки.');
  if (rawItems.length > 30) throw new Error('За одну быструю сверку можно проверить не больше 30 позиций.');

  const items = rawItems.map((raw: any) => ({
    variantId: Math.max(0, toInt(raw?.variantId, 0)),
    expectedQuantity: toInt(raw?.expectedQuantity, 0),
    countedQuantity: raw?.countedQuantity,
  }));
  if (items.some(item => !item.variantId)) throw new Error('В сверке есть позиция без варианта товара.');
  if (new Set(items.map(item => item.variantId)).size !== items.length) throw new Error('Одна и та же позиция выбрана для сверки несколько раз.');
  for (const item of items) {
    const counted = Number(item.countedQuantity);
    if (item.countedQuantity === null || item.countedQuantity === undefined || cleanText(item.countedQuantity) === '' || !Number.isFinite(counted) || counted < 0 || !Number.isInteger(counted)) {
      throw new Error('Для каждой выбранной позиции укажите целое фактическое количество 0 или больше.');
    }
  }

  const checkType = cleanText(options.checkType) || 'quick_stocktake';
  const checkReferenceType = cleanText(options.referenceType) || (checkType === 'cycle_count' ? 'cycle_count' : 'quick_stocktake');
  const requestId = cleanText(input.requestId).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 96);
  const requestReferenceId = requestId ? `stock-check:${checkType}:${source}:${requestId}` : '';

  const loadReplay = async (): Promise<InventoryCycleCountApplyResponse | null> => {
    if (!requestReferenceId) return null;
    const previous = await db.prepare(
      `SELECT variant_id, expected_quantity, counted_quantity, difference_quantity, reserved_quantity
       FROM inventory_stock_checks
       WHERE inventory_source = ? AND check_type = ? AND reference_type = ? AND reference_id = ?
       ORDER BY variant_id`
    ).bind(source, checkType, checkReferenceType, requestReferenceId).all<Record<string, unknown>>();
    const previousRows = previous.results || [];
    if (!previousRows.length) return null;
    const expectedByVariant = new Map(items.map(item => [item.variantId, item]));
    const replayMismatch = previousRows.length !== items.length || previousRows.some(row => {
      const expected = expectedByVariant.get(toInt(row.variant_id, 0));
      return !expected
        || toInt(row.expected_quantity, 0) !== expected.expectedQuantity
        || toInt(row.counted_quantity, 0) !== Math.trunc(Number(expected.countedQuantity));
    });
    if (replayMismatch) throw new Error('Ключ повтора уже использован для другой сверки. Обновите страницу и повторите действие.');
    const results = previousRows.map(row => {
      const previousQuantity = toInt(row.expected_quantity, 0);
      const physical = Math.max(0, toInt(row.counted_quantity, 0));
      const reserved = Math.max(0, toInt(row.reserved_quantity, 0));
      return { variantId: toInt(row.variant_id, 0), previousQuantity, physical, reserved, free: physical - reserved, changed: physical !== previousQuantity };
    });
    return { ok: true, changedCount: results.filter(row => row.changed).length, results };
  };

  const replay = await loadReplay();
  if (replay) return replay;

  const activeSession = await db.prepare(
    `SELECT id FROM inventory_stocktake_sessions WHERE inventory_source = ? AND status = 'active' LIMIT 1`
  ).bind(source).first<{ id: string }>();
  if (activeSession?.id) {
    return { ok: false, code: 'stocktake_active', message: 'Сейчас по этой точке идёт ревизия. Завершите или отмените её перед быстрой сверкой.', sessionId: activeSession.id };
  }

"""
stock = stock[:quick_start] + new_prefix + stock[quick_marker:]

quick_start = stock.index('export async function quickInventoryStocktakeBatch(')
quick_end = stock.index('export async function quickInventoryStocktake(', quick_start)
quick = stock[quick_start:quick_end]
quick = replace_once(
    quick,
    "  const batchId = `quick-stocktake-batch:${source}:${Date.now()}`;\n",
    "  const batchId = requestReferenceId || `quick-stocktake-batch:${source}:${Date.now()}`;\n",
    'quick stable batch id',
)
old_meta = """  const checkType = cleanText(options.checkType) || 'quick_stocktake';
  const checkReferenceType = cleanText(options.referenceType) || (checkType === 'cycle_count' ? 'cycle_count' : 'quick_stocktake');
"""
meta_pos = quick.find(old_meta, quick.find('  const batchId = '))
if meta_pos < 0:
    raise SystemExit('old quick check metadata block not found after batch id')
quick = quick[:meta_pos] + quick[meta_pos + len(old_meta):]
quick = replace_once(
    quick,
    '     INSERT OR IGNORE INTO inventory_stock_checks (',
    "     ${requestReferenceId ? 'INSERT' : 'INSERT OR IGNORE'} INTO inventory_stock_checks (",
    'quick duplicate check transactional guard',
)
quick = replace_once(quick, """  } catch (error) {
    const currentStock = await db.prepare(
""", """  } catch (error) {
    const replayAfterRace = await loadReplay();
    if (replayAfterRace) return replayAfterRace;
    const currentStock = await db.prepare(
""", 'quick replay after race')
stock = stock[:quick_start] + quick + stock[quick_end:]

stock = replace_once(
    stock,
    "  input: { source?: unknown; variantId?: unknown; expectedQuantity?: unknown; countedQuantity?: unknown },\n",
    "  input: { source?: unknown; variantId?: unknown; expectedQuantity?: unknown; countedQuantity?: unknown; requestId?: unknown },\n",
    'single quick request id type',
)
stock = replace_once(stock, """    source: input.source,
    items: [{ variantId: input.variantId, expectedQuantity: input.expectedQuantity, countedQuantity: input.countedQuantity }],
""", """    source: input.source,
    items: [{ variantId: input.variantId, expectedQuantity: input.expectedQuantity, countedQuantity: input.countedQuantity }],
    requestId: input.requestId,
""", 'single quick request id forwarding')

# A retry after the atomic completion committed is a successful replay.
complete_start = stock.index('export async function completeInventoryStocktakeSession(')
complete_source = stock.index('  const source = normalizeSourceType(session.inventory_source);', complete_start)
if complete_start < 0 or complete_source < 0:
    raise SystemExit('complete stocktake boundaries not found')
old_complete_prefix = stock[complete_start:complete_source]
if "if (cleanText(session.status) !== 'active')" not in old_complete_prefix:
    raise SystemExit('complete stocktake prefix changed unexpectedly')
new_complete_prefix = """export async function completeInventoryStocktakeSession(db: D1Database, sessionId: string) {
  const session = await db.prepare(
    `SELECT id, inventory_source, status FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (!session?.id) throw new Error('Ревизия не найдена.');
  const sessionStatus = cleanText(session.status);
  if (sessionStatus === 'completed') {
    const completed = await serializeInventoryStocktakeSession(db, sessionId);
    const changed = completed.items.filter((item: any) => item.appliedQuantity !== null && Number(item.appliedQuantity) !== Number(item.baselineQuantity)).length;
    const shortages = completed.items
      .filter((item: any) => item.appliedQuantity !== null && Number(item.appliedQuantity) - Number(item.reservedQuantity || 0) < 0)
      .map((item: any) => ({
        itemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.productName,
        color: item.color,
        size: item.size,
        reservedQuantity: item.reservedQuantity,
        physicalQuantity: item.appliedQuantity,
        shortageQuantity: Math.abs(Number(item.appliedQuantity) - Number(item.reservedQuantity || 0)),
      }));
    return {
      ok: true,
      changed,
      message: shortages.length
        ? `Ревизия уже завершена. Исправлено ${changed} позиций. По ${shortages.length} позициям товара не хватает для текущих заказов.`
        : `Ревизия уже завершена. Исправлено ${changed} позиций.`,
      shortages,
      session: completed,
    };
  }
  if (sessionStatus !== 'active') throw new Error('Эта ревизия уже завершена или отменена.');
"""
stock = stock[:complete_start] + new_complete_prefix + stock[complete_source:]
write(stock_path, stock)


# Permanent regression guards live in the already-mandatory 192A1 suite.
test_path = 'scripts/test-step192a1-warehouse-truth-freshness.mjs'
test = read(test_path)
test = replace_once(test, """  const lifecycleMigration = read('migrations/0051_v72_inventory_lifecycle_gate.sql')
  const worker = read('worker/index.ts')
""", """  const lifecycleMigration = read('migrations/0051_v72_inventory_lifecycle_gate.sql')
  const cycleCountMigration = read('migrations/0053_v72_inventory_cycle_counts.sql')
  const stocktake = read('worker/domains/inventory-stocktake.ts')
  const apiClient = read('src/app/controllers/useApiClient.ts')
  const worker = read('worker/index.ts')
""", '192A1 replay sources')
marker = "  console.log('STEP 192A1 WAREHOUSE TRUTH / FRESHNESS TESTS PASSED"
pos = test.index(marker)
guards = """  // Lost-response integrity for stocktake and quick physical checks.
  check(cycleCountMigration.includes('check_key TEXT UNIQUE'), 'Physical-check replay proof is no longer unique')
  check(stocktake.includes('resumed: true'), 'Existing active stocktake is no longer resumed safely')
  check(stocktake.includes('const alreadyPersisted = currentQuantity === previousBaseline'), 'Repeated saved stocktake fact may rewrite evidence time')
  check(stocktake.includes('const requestReferenceId = requestId ? `stock-check:${checkType}:${source}:${requestId}`'), 'Quick check lost-response key is not durable')
  check(stocktake.includes('const replayAfterRace = await loadReplay()'), 'Concurrent quick-check replay cannot recover after the transaction race')
  check(stocktake.includes("${requestReferenceId ? 'INSERT' : 'INSERT OR IGNORE'} INTO inventory_stock_checks"), 'Quick-check duplicate key no longer rolls back a repeated mutation')
  check(stocktake.includes("if (sessionStatus === 'completed')"), 'Completed stocktake retry can become a false failure')
  check(apiClient.includes('managedInventoryWriteMode'), 'Stocktake writes are not opted into managed retry transport')
  check(apiClient.includes('prepareCriticalRequest(managedInventoryRequestKey, basePayload)'), 'Stocktake request id is not persisted across reload')
  check(apiClient.includes("headers.set('X-Idempotency-Key', prepared.requestId)"), 'Stocktake managed writes do not enable safe transport retry')
  check(apiClient.includes('Boolean(managedInventoryRequestKey) && response.status >= 500'), 'Audited stocktake writes cannot recover from a post-commit 5xx')

"""
test = test[:pos] + guards + test[pos:]
write(test_path, test)
